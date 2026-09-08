import { describe, expect, it } from "vitest";

import { buildReauthPrompt } from "../src/popup/auth-state";

describe("popup reauthentication prompt", () => {
  it("explains the one-time upgrade login without claiming work was deleted", () => {
    expect(buildReauthPrompt({ login: "ada", reason: "upgrade" }, true)).toEqual({
      title: "GitHub 연결을 다시 확인해 주세요",
      message: "자동 로그인 갱신을 설정하려면 ada 계정으로 한 번 다시 로그인해야 합니다. 미동기화 코드는 안전하게 보관되어 있습니다.",
      requiredLogin: "ada",
      allowDiscardAndSwitch: true,
    });
  });

  it("allows ordinary account selection when there is no pending source code", () => {
    expect(buildReauthPrompt({ login: "ada", reason: "refresh_rejected" }, false)).toMatchObject({
      message: "GitHub 로그인 갱신이 만료되었거나 취소되었습니다. 다시 로그인해 주세요.",
      allowDiscardAndSwitch: false,
    });
  });
});
