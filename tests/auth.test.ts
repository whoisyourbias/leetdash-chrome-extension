import { describe, expect, it, vi } from "vitest";

import { pollDeviceFlow, refreshAccessToken, startDeviceFlow } from "../src/background/auth";
import { GITHUB_CLIENT_ID } from "../src/config";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("GitHub Device Flow", () => {
  it("ships the public OAuth client ID without requiring build-time configuration", () => {
    expect(GITHUB_CLIENT_ID).toBe("Ov23liucGtf8zZHCwYq9");
  });

  it("requests public repository access with offline refresh support", async () => {
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init: RequestInit = {}) => {
      const params = new URLSearchParams(String(init.body));
      expect(params.get("client_id")).toBe("client-id");
      expect(params.get("scope")).toBe("public_repo offline_access");
      return response({
        device_code: "device",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      });
    });
    await expect(startDeviceFlow(fetchImpl as typeof fetch, "client-id")).resolves.toMatchObject({
      deviceCode: "device",
      userCode: "ABCD-EFGH",
      intervalSeconds: 5,
    });
  });

  it("backs off when GitHub returns slow_down", async () => {
    const now = Date.now();
    const session = {
      deviceCode: "device",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresAt: new Date(now + 900_000).toISOString(),
      intervalSeconds: 5,
      nextPollAt: new Date(now - 1000).toISOString(),
    };
    const result = await pollDeviceFlow(session, vi.fn(async () => response({ error: "slow_down" })) as typeof fetch, "client-id");
    expect(result.session?.intervalSeconds).toBe(10);
    expect(Date.parse(result.session!.nextPollAt)).toBeGreaterThan(now);
  });

  it("returns the complete expiring token session after validating identity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T00:00:00.000Z"));
    const now = Date.now();
    const session = {
      deviceCode: "device",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresAt: new Date(now + 900_000).toISOString(),
      intervalSeconds: 5,
      nextPollAt: new Date(now - 1000).toISOString(),
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({
        access_token: "secret-token",
        expires_in: 28_800,
        refresh_token: "secret-refresh-token",
        refresh_token_expires_in: 15_897_600,
        scope: "public_repo,offline_access",
      }))
      .mockResolvedValueOnce(response({ login: "ada", avatar_url: "https://avatars.example/ada" }));
    await expect(pollDeviceFlow(session, fetchImpl as typeof fetch, "client-id")).resolves.toEqual({
      auth: {
        schemaVersion: 2,
        status: "active",
        accessToken: "secret-token",
        accessTokenExpiresAt: "2026-09-08T08:00:00.000Z",
        refreshToken: "secret-refresh-token",
        refreshTokenExpiresAt: "2027-03-11T00:00:00.000Z",
        login: "ada",
        avatarUrl: "https://avatars.example/ada",
      },
    });
    vi.useRealTimers();
  });

  it("rejects a login response that cannot be refreshed", async () => {
    const now = Date.now();
    const session = {
      deviceCode: "device",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresAt: new Date(now + 900_000).toISOString(),
      intervalSeconds: 5,
      nextPollAt: new Date(now - 1000).toISOString(),
    };
    await expect(pollDeviceFlow(
      session,
      vi.fn(async () => response({ access_token: "secret-token", scope: "public_repo" })) as typeof fetch,
      "client-id",
    )).rejects.toMatchObject({ code: "refresh_token_missing" });
  });

  it("rotates an expiring token pair without a client secret", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T00:00:00.000Z"));
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init: RequestInit = {}) => {
      const params = new URLSearchParams(String(init.body));
      expect(params.get("client_id")).toBe("client-id");
      expect(params.get("client_secret")).toBeNull();
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("old-refresh-token");
      return response({
        access_token: "new-access-token",
        expires_in: 28_800,
        refresh_token: "new-refresh-token",
        refresh_token_expires_in: 15_897_600,
        scope: "public_repo,offline_access",
      });
    });

    await expect(refreshAccessToken("old-refresh-token", fetchImpl as typeof fetch, "client-id"))
      .resolves.toEqual({
        accessToken: "new-access-token",
        accessTokenExpiresAt: "2026-09-08T08:00:00.000Z",
        refreshToken: "new-refresh-token",
        refreshTokenExpiresAt: "2027-03-11T00:00:00.000Z",
      });
    vi.useRealTimers();
  });

  it("rejects a token when public_repo was not granted", async () => {
    const now = Date.now();
    const session = {
      deviceCode: "device",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresAt: new Date(now + 900_000).toISOString(),
      intervalSeconds: 5,
      nextPollAt: new Date(now - 1000).toISOString(),
    };
    await expect(pollDeviceFlow(
      session,
      vi.fn(async () => response({ access_token: "secret-token", scope: "read:user" })) as typeof fetch,
      "client-id",
    )).rejects.toThrow("public_repo");
  });
});
