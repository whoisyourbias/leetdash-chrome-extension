import { describe, expect, it, vi } from "vitest";

import { pollDeviceFlow, startDeviceFlow } from "../src/background/auth";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("GitHub Device Flow", () => {
  it("requests only public repository access", async () => {
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init: RequestInit = {}) => {
      const params = new URLSearchParams(String(init.body));
      expect(params.get("client_id")).toBe("client-id");
      expect(params.get("scope")).toBe("public_repo");
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

  it("validates the authenticated identity before persisting the token", async () => {
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
      .mockResolvedValueOnce(response({ access_token: "secret-token", scope: "public_repo" }))
      .mockResolvedValueOnce(response({ login: "ada", avatar_url: "https://avatars.example/ada" }));
    await expect(pollDeviceFlow(session, fetchImpl as typeof fetch, "client-id")).resolves.toEqual({
      auth: { token: "secret-token", login: "ada", avatarUrl: "https://avatars.example/ada" },
    });
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
