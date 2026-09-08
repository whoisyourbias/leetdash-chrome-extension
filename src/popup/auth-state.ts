import type { ReauthRequiredState } from "../shared/model.js";

export interface ReauthPrompt {
  title: string;
  message: string;
  requiredLogin: string;
  allowDiscardAndSwitch: boolean;
}

export function buildReauthPrompt(
  state: Pick<ReauthRequiredState, "login" | "reason">,
  hasPendingWork: boolean,
): ReauthPrompt {
  const preserved = hasPendingWork ? " 미동기화 코드는 안전하게 보관되어 있습니다." : "";
  const message = state.reason === "upgrade"
    ? `자동 로그인 갱신을 설정하려면 ${state.login} 계정으로 한 번 다시 로그인해야 합니다.${preserved}`
    : state.reason === "refresh_rejected"
      ? `GitHub 로그인 갱신이 만료되었거나 취소되었습니다. 다시 로그인해 주세요.${preserved}`
      : `GitHub 인증이 만료되었거나 취소되었습니다. 다시 로그인해 주세요.${preserved}`;
  return {
    title: "GitHub 연결을 다시 확인해 주세요",
    message,
    requiredLogin: state.login,
    allowDiscardAndSwitch: hasPendingWork,
  };
}
