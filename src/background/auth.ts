import { GITHUB_CLIENT_ID } from "../config.js";
import type { AuthState, DeviceSession } from "../shared/model.js";

const oauthHeaders = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded",
};

export class DeviceFlowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

function assertClientId(clientId: string): void {
  if (!clientId || clientId === "__GITHUB_CLIENT_ID__") {
    throw new DeviceFlowError("client_id_missing", "확장 프로그램에 GitHub OAuth Client ID가 설정되지 않았습니다.");
  }
}

export async function startDeviceFlow(
  fetchImpl: typeof fetch = fetch,
  clientId = GITHUB_CLIENT_ID,
): Promise<DeviceSession> {
  assertClientId(clientId);
  const response = await fetchImpl("https://github.com/login/device/code", {
    method: "POST",
    headers: oauthHeaders,
    body: new URLSearchParams({ client_id: clientId, scope: "public_repo" }),
  });
  const body = await response.json();
  if (!response.ok || typeof body.device_code !== "string") {
    throw new DeviceFlowError("device_code_failed", "GitHub 로그인 코드를 발급하지 못했습니다.");
  }
  const now = Date.now();
  const intervalSeconds = Math.max(5, Number(body.interval) || 5);
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresAt: new Date(now + Number(body.expires_in) * 1000).toISOString(),
    intervalSeconds,
    nextPollAt: new Date(now + intervalSeconds * 1000).toISOString(),
  };
}

export interface DevicePollResult {
  auth?: AuthState;
  session?: DeviceSession;
}

export async function pollDeviceFlow(
  session: DeviceSession,
  fetchImpl: typeof fetch = fetch,
  clientId = GITHUB_CLIENT_ID,
): Promise<DevicePollResult> {
  assertClientId(clientId);
  if (Date.now() >= Date.parse(session.expiresAt)) {
    throw new DeviceFlowError("expired_token", "GitHub 로그인 코드가 만료되었습니다.");
  }
  if (Date.now() < Date.parse(session.nextPollAt)) return { session };

  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: oauthHeaders,
    body: new URLSearchParams({
      client_id: clientId,
      device_code: session.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new DeviceFlowError("token_request_failed", "GitHub 로그인을 확인하지 못했습니다.");

  if (body.error === "authorization_pending") {
    return {
      session: {
        ...session,
        nextPollAt: new Date(Date.now() + session.intervalSeconds * 1000).toISOString(),
      },
    };
  }
  if (body.error === "slow_down") {
    const intervalSeconds = session.intervalSeconds + 5;
    return {
      session: {
        ...session,
        intervalSeconds,
        nextPollAt: new Date(Date.now() + intervalSeconds * 1000).toISOString(),
      },
    };
  }
  if (body.error) throw new DeviceFlowError(body.error, "GitHub 로그인이 취소되었거나 만료되었습니다.");
  if (typeof body.access_token !== "string") {
    throw new DeviceFlowError("token_missing", "GitHub가 유효한 access token을 반환하지 않았습니다.");
  }
  const scopes = String(body.scope ?? "").split(",").map((scope) => scope.trim());
  if (!scopes.includes("public_repo")) {
    throw new DeviceFlowError("scope_missing", "GitHub public_repo 권한이 승인되지 않았습니다.");
  }

  const userResponse = await fetchImpl("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${body.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  const user = await userResponse.json();
  if (!userResponse.ok || typeof user.login !== "string") {
    throw new DeviceFlowError("identity_failed", "GitHub 사용자 정보를 확인하지 못했습니다.");
  }
  return {
    auth: {
      token: body.access_token,
      login: user.login,
      avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : undefined,
    },
  };
}
