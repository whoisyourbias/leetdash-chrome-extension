import { DeviceFlowError, refreshAccessToken } from "./auth.js";
import { getStored, setStored, storageKeys } from "./storage.js";
import type { ActiveAuthSession, ReauthRequiredState, StoredAuthState } from "../shared/model.js";

const refreshSkewMs = 5 * 60 * 1000;

export function toPublicAuthState(state: StoredAuthState | undefined): {
  auth?: { login: string; avatarUrl?: string };
  reauthRequired?: { login: string; reason: ReauthRequiredState["reason"] };
} {
  return state?.status === "active"
    ? { auth: { login: state.login, avatarUrl: state.avatarUrl }, reauthRequired: undefined }
    : {
        auth: undefined,
        reauthRequired: state?.status === "reauth_required"
          ? { login: state.login, reason: state.reason }
          : undefined,
      };
}

export class ReauthenticationRequiredError extends Error {
  constructor(public readonly state: ReauthRequiredState) {
    super("GitHub 연결을 다시 확인해 주세요.");
    this.name = "ReauthenticationRequiredError";
  }
}

function isActive(value: unknown): value is ActiveAuthSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ActiveAuthSession;
  return candidate.schemaVersion === 2
    && candidate.status === "active"
    && typeof candidate.accessToken === "string"
    && typeof candidate.refreshToken === "string"
    && Number.isFinite(Date.parse(candidate.accessTokenExpiresAt))
    && Number.isFinite(Date.parse(candidate.refreshTokenExpiresAt))
    && typeof candidate.login === "string";
}

function isReauth(value: unknown): value is ReauthRequiredState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ReauthRequiredState;
  return candidate.schemaVersion === 2
    && candidate.status === "reauth_required"
    && typeof candidate.login === "string"
    && ["upgrade", "refresh_rejected", "unauthorized"].includes(candidate.reason);
}

async function clearAccountCaches(): Promise<void> {
  await chrome.storage.local.remove([
    storageKeys.branchClaims,
    storageKeys.pullSnapshots,
    storageKeys.syncActivity,
  ]);
}

export class AuthSessionManager {
  private refreshPromise?: Promise<ActiveAuthSession>;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clientId?: string,
  ) {}

  async getState(): Promise<StoredAuthState | undefined> {
    const stored = await getStored<unknown>(storageKeys.auth, undefined);
    if (isActive(stored) || isReauth(stored)) return stored;
    if (stored && typeof stored === "object") {
      const legacy = stored as { login?: unknown; avatarUrl?: unknown };
      if (typeof legacy.login === "string") {
        const reauth: ReauthRequiredState = {
          schemaVersion: 2,
          status: "reauth_required",
          login: legacy.login,
          avatarUrl: typeof legacy.avatarUrl === "string" ? legacy.avatarUrl : undefined,
          reason: "upgrade",
        };
        await Promise.all([setStored(storageKeys.auth, reauth), clearAccountCaches()]);
        return reauth;
      }
    }
    return undefined;
  }

  async getActiveSession(): Promise<ActiveAuthSession | undefined> {
    const state = await this.getState();
    return state?.status === "active" ? state : undefined;
  }

  async getAccessToken(): Promise<string> {
    const session = await this.requireActive();
    if (Date.parse(session.accessTokenExpiresAt) - Date.now() > refreshSkewMs) return session.accessToken;
    try {
      return (await this.refresh(session)).accessToken;
    } catch (error) {
      if (Date.now() < Date.parse(session.accessTokenExpiresAt) && !(error instanceof ReauthenticationRequiredError)) {
        return session.accessToken;
      }
      throw error;
    }
  }

  async recoverUnauthorized(failedToken: string): Promise<string> {
    const current = await this.requireActive();
    if (current.accessToken !== failedToken) return current.accessToken;
    return (await this.refresh(current)).accessToken;
  }

  async markUnauthorized(failedToken: string): Promise<void> {
    const current = await this.getActiveSession();
    if (current?.accessToken === failedToken) await this.requireReauthentication(current, "unauthorized");
  }

  async acceptLogin(session: ActiveAuthSession): Promise<void> {
    const previous = await this.getState();
    if (previous?.status === "reauth_required" && previous.login.toLowerCase() !== session.login.toLowerCase()) {
      const [queue, attempts] = await Promise.all([
        getStored<unknown>(storageKeys.pendingQueue, []),
        getStored<unknown>(storageKeys.pendingAttempts, {}),
      ]);
      const hasPending = (Array.isArray(queue) && queue.length > 0)
        || (!!attempts && typeof attempts === "object" && Object.keys(attempts).length > 0);
      if (hasPending) {
        throw new DeviceFlowError(
          "account_mismatch",
          `보존된 풀이를 동기화하려면 ${previous.login} 계정으로 로그인해 주세요.`,
        );
      }
    }
    await setStored(storageKeys.auth, session);
  }

  private async requireActive(): Promise<ActiveAuthSession> {
    const state = await this.getState();
    if (state?.status === "active") return state;
    if (state?.status === "reauth_required") throw new ReauthenticationRequiredError(state);
    throw new Error("GitHub 로그인이 필요합니다.");
  }

  private refresh(session: ActiveAuthSession): Promise<ActiveAuthSession> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const tokens = await refreshAccessToken(session.refreshToken, this.fetchImpl, this.clientId);
        const latest = await this.requireActive();
        if (latest.accessToken !== session.accessToken) return latest;
        const refreshed: ActiveAuthSession = { ...latest, ...tokens };
        await setStored(storageKeys.auth, refreshed);
        return refreshed;
      } catch (error) {
        if (error instanceof DeviceFlowError && error.code === "bad_refresh_token") {
          await this.requireReauthentication(session, "refresh_rejected");
        }
        throw error;
      }
    })().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async requireReauthentication(
    session: ActiveAuthSession,
    reason: ReauthRequiredState["reason"],
  ): Promise<never> {
    const state: ReauthRequiredState = {
      schemaVersion: 2,
      status: "reauth_required",
      login: session.login,
      avatarUrl: session.avatarUrl,
      reason,
    };
    await Promise.all([setStored(storageKeys.auth, state), clearAccountCaches()]);
    throw new ReauthenticationRequiredError(state);
  }
}
