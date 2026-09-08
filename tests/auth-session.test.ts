import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionManager, ReauthenticationRequiredError, toPublicAuthState } from "../src/background/auth-session";
import type { ActiveAuthSession } from "../src/shared/model";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function active(overrides: Partial<ActiveAuthSession> = {}): ActiveAuthSession {
  return {
    schemaVersion: 2,
    status: "active",
    accessToken: "old-access",
    accessTokenExpiresAt: "2026-09-08T08:00:00.000Z",
    refreshToken: "old-refresh",
    refreshTokenExpiresAt: "2027-03-11T00:00:00.000Z",
    login: "ada",
    avatarUrl: "https://avatars.example/ada",
    ...overrides,
  };
}

describe("OAuth session lifecycle", () => {
  let stored: Record<string, any>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T07:56:00.000Z"));
    stored = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const selected = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(selected.filter((key) => key in stored).map((key) => [key, stored[key]]));
          }),
          set: vi.fn(async (updates: Record<string, unknown>) => Object.assign(stored, updates)),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
          }),
        },
      },
    };
  });

  it("never exposes access or refresh credentials to the popup", () => {
    expect(toPublicAuthState(active())).toEqual({
      auth: { login: "ada", avatarUrl: "https://avatars.example/ada" },
      reauthRequired: undefined,
    });
    expect(JSON.stringify(toPublicAuthState(active()))).not.toContain("old-access");
    expect(JSON.stringify(toPublicAuthState(active()))).not.toContain("old-refresh");
  });

  it("migrates legacy credentials to reauthentication without deleting pending work", async () => {
    stored = {
      auth: { token: "legacy-token", login: "ada", avatarUrl: "https://avatars.example/ada" },
      pendingQueue: [{ id: "queued", code: "secret" }],
      pendingAttempts: { attempt: { code: "secret" } },
      branchClaims: { "ada:2026-09-08": "260908" },
      pullSnapshots: { "2026-09-08": { number: 1 } },
      syncActivity: { status: "running" },
    };

    await expect(new AuthSessionManager().getState()).resolves.toEqual({
      schemaVersion: 2,
      status: "reauth_required",
      login: "ada",
      avatarUrl: "https://avatars.example/ada",
      reason: "upgrade",
    });
    expect(stored.pendingQueue).toEqual([{ id: "queued", code: "secret" }]);
    expect(stored.pendingAttempts).toEqual({ attempt: { code: "secret" } });
    expect(stored).not.toHaveProperty("branchClaims");
    expect(stored).not.toHaveProperty("pullSnapshots");
    expect(stored).not.toHaveProperty("syncActivity");
  });

  it("coalesces concurrent proactive refreshes and atomically stores the rotated pair", async () => {
    stored.auth = active();
    const fetchImpl = vi.fn(async () => response({
      access_token: "new-access",
      expires_in: 28_800,
      refresh_token: "new-refresh",
      refresh_token_expires_in: 15_897_600,
      scope: "public_repo,offline_access",
    }));
    const manager = new AuthSessionManager(fetchImpl as typeof fetch, "client-id");

    await expect(Promise.all([manager.getAccessToken(), manager.getAccessToken()]))
      .resolves.toEqual(["new-access", "new-access"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored.auth).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresAt: "2026-09-08T15:56:00.000Z",
      refreshTokenExpiresAt: "2027-03-11T07:56:00.000Z",
    });
  });

  it("keeps a still-valid session when proactive refresh has a network failure", async () => {
    stored.auth = active();
    const manager = new AuthSessionManager(vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch);

    await expect(manager.getAccessToken()).resolves.toBe("old-access");
    expect(stored.auth).toEqual(active());
  });

  it("preserves credentials on an expired-session network failure for a later retry", async () => {
    stored.auth = active({ accessTokenExpiresAt: "2026-09-08T07:55:00.000Z" });
    const manager = new AuthSessionManager(vi.fn(async () => { throw new TypeError("offline"); }) as typeof fetch);

    await expect(manager.getAccessToken()).rejects.toThrow("offline");
    expect(stored.auth).toEqual(active({ accessTokenExpiresAt: "2026-09-08T07:55:00.000Z" }));
  });

  it("moves to reauthentication when GitHub rejects the refresh token", async () => {
    stored.auth = active({ accessTokenExpiresAt: "2026-09-08T07:55:00.000Z" });
    const manager = new AuthSessionManager(vi.fn(async () => response({ error: "bad_refresh_token" })) as typeof fetch);

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(ReauthenticationRequiredError);
    expect(stored.auth).toEqual({
      schemaVersion: 2,
      status: "reauth_required",
      login: "ada",
      avatarUrl: "https://avatars.example/ada",
      reason: "refresh_rejected",
    });
  });

  it("does not attempt to use a refresh token whose recorded expiry has passed", async () => {
    stored.auth = active({
      accessTokenExpiresAt: "2026-09-08T07:55:00.000Z",
      refreshTokenExpiresAt: "2026-09-08T07:55:00.000Z",
    });
    const fetchImpl = vi.fn(async () => response({}));
    const manager = new AuthSessionManager(fetchImpl as typeof fetch);

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(ReauthenticationRequiredError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stored.auth).toMatchObject({ status: "reauth_required", reason: "refresh_rejected" });
  });

  it("requires the same account while pending source code is preserved", async () => {
    stored.auth = {
      schemaVersion: 2,
      status: "reauth_required",
      login: "ada",
      reason: "unauthorized",
    };
    stored.pendingQueue = [{ id: "queued", code: "secret" }];
    const manager = new AuthSessionManager();

    await expect(manager.acceptLogin(active({ login: "grace" }))).rejects.toThrow("ada 계정");
    expect(stored.auth.status).toBe("reauth_required");
    await expect(manager.acceptLogin(active())).resolves.toBeUndefined();
    expect(stored.auth.status).toBe("active");
  });

  it("also protects captured source code that is still awaiting an Accepted result", async () => {
    stored.auth = {
      schemaVersion: 2,
      status: "reauth_required",
      login: "ada",
      reason: "unauthorized",
    };
    stored.pendingAttempts = { attempt: { code: "secret" } };

    await expect(new AuthSessionManager().acceptLogin(active({ login: "grace" })))
      .rejects.toThrow("ada 계정");
    expect(stored.auth.status).toBe("reauth_required");
  });
});
