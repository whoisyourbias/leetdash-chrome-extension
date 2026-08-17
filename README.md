# Leetdash Submission Sync

LeetCode, Programmers, SWEA에서 Accepted된 코드를 `whoisyourbias/leetdash`의 날짜별 Draft PR에 자동으로 누적하는 Manifest V3 Chrome 확장 프로그램입니다.

## 필수 참가자 등록

확장에서 GitHub에 로그인할 계정은 **중앙 [`whoisyourbias/leetdash` 저장소의 `data/users.json`](https://github.com/whoisyourbias/leetdash/blob/master/data/users.json)**에 등록되어 있어야 합니다. 확장 프로그램 소스 저장소인 `whoisyourbias/leetdash-chrome-extension`의 파일을 뜻하지 않습니다.

등록되지 않은 사용자는 중앙 저장소에서 `data/users.json`을 수정하는 PR을 먼저 만들어야 합니다. 등록이 기본 브랜치 `master`에 반영된 다음 확장 프로그램에 로그인할 수 있습니다.

## OAuth App 준비

관리자는 GitHub `Settings > Developer settings > OAuth Apps`에서 팀용 OAuth App을 한 번 등록합니다.

- Homepage URL: `https://whoisyourbias.github.io/leetdash/`
- Authorization callback URL: `https://whoisyourbias.github.io/leetdash/` (Device Flow에서는 사용하지 않음)
- `Enable Device Flow` 활성화

Client ID는 공개 식별자이므로 빌드 환경 변수로 넣습니다. Client secret은 생성하거나 확장 프로그램에 포함하지 않습니다.

```bash
EXTENSION_GITHUB_CLIENT_ID=<oauth-client-id> npm run package
```

빌드 결과는 `dist/`, 내부 배포 zip은 `artifacts/leetdash-extension.zip`에 생성됩니다.

문제 카탈로그와 사용자 목록은 확장 프로그램에 포함하지 않습니다. 실행 중 중앙 GitHub 저장소의 `master`에서 읽으며, 진행도 데이터는 확장 프로그램이 사용하지 않습니다.

## 내부 설치

1. `chrome://extensions`에서 개발자 모드를 켭니다.
2. 로컬 개발은 `압축해제된 확장 프로그램을 로드합니다`에서 `dist`를 선택합니다.
3. 팀 배포는 zip을 전달하고, 사용자가 압축을 푼 디렉터리를 같은 방법으로 로드합니다.
4. 툴바의 Leetdash 아이콘을 열어 GitHub 로그인 버튼을 누르고 GitHub Device Flow 코드를 입력합니다.

OAuth token은 `chrome.storage.local`의 service worker 전용 영역에 저장됩니다. 미동기화 풀이 코드는 `pendingQueue`에만 임시 보관하며, GitHub 동기화가 완료되면 큐에서 제거합니다. 완료 결과는 코드 본문이 없는 `syncHistory`에 최대 100개만 보관합니다. 로그아웃할 때 `pendingQueue`에 미동기화 코드가 있으면 삭제 확인을 받습니다.

확장이 처리하는 데이터와 공개 GitHub PR 전송 범위는 [개인정보 안내](PRIVACY.md)를 먼저 확인하세요.

## GitHub 공개 배포

소스 저장소에는 `src`, `static`, `tests`와 빌드 스크립트만 커밋합니다. `dist`와 `artifacts`는 재생성 가능한 산출물이므로 커밋하지 않습니다.

1. 공개 릴리스용 버전이라면 `static/manifest.json`의 `version`을 올립니다.
2. OAuth Client ID를 환경 변수로 전달해 패키지를 생성합니다.
3. 생성된 `artifacts/leetdash-extension.zip`의 압축 무결성을 검사합니다.
4. GitHub Release에 ZIP만 첨부하고, 설치자는 압축을 푼 뒤 `chrome://extensions`에서 로드합니다.

```bash
EXTENSION_GITHUB_CLIENT_ID=<oauth-client-id> npm run package
unzip -t artifacts/leetdash-extension.zip
```

OAuth Client ID는 공개 식별자이므로 릴리스 파일에 포함될 수 있습니다. Client secret, GitHub access token, `.env` 파일은 저장소나 릴리스에 포함하면 안 됩니다. GitHub Release 설치는 자동 업데이트를 제공하지 않으므로 새 버전마다 ZIP을 다시 배포해야 합니다.

## 동작

- 제출 버튼 또는 `Ctrl/Cmd+Enter` 시점의 코드와 언어를 캡처하고 10분 안에 Accepted 결과가 나타날 때만 큐에 넣습니다.
- GitHub 계정은 중앙 [`whoisyourbias/leetdash`의 `data/users.json`](https://github.com/whoisyourbias/leetdash/blob/master/data/users.json)에 등록되어 있어야 하며, 문제는 같은 저장소의 `data/problem-catalog.json`에 존재해야 합니다.
- 경로는 provider별 canonical source인 `leetcode`, `programmers`, `swea`를 사용합니다.
- 팝업의 미동기화 제출에는 자동 감지된 provider와 문제 번호가 표시됩니다. `pending` 또는 `blocked` 항목에서 이를 수정하면 중앙 카탈로그 검증을 통과한 값이 `problemOverride`로 저장되고 즉시 다시 동기화됩니다.
- 사용자가 저장한 `problemOverride`는 자동 재감지, 중복 Accepted 캡처, 재시도보다 항상 우선합니다. 팝업에서 명시적으로 `자동 감지로 되돌리기`를 선택해야만 제거됩니다.
- 일반 참가자는 fork가 없으면 `<githubUsername>/leetdash`를 자동 생성합니다. 원본 저장소 소유자는 fork 대신 `submissions/<githubUsername>/YYMMDD` upstream branch를 사용하되 항상 Draft PR을 거칩니다.
- Accepted 시각의 Asia/Seoul 날짜 `YYMMDD`를 branch와 Draft PR 제목으로 사용합니다.
- 같은 문제를 다른 언어로 다시 통과하면 기존 `Solution.*`를 제거하고 최신 코드를 한 커밋으로 기록합니다.
- 기본 설정에서는 KST 자정 이후 미동기화 큐가 없으면 Draft를 Ready로 바꿉니다. 팝업의 `자정 이후 자동 Ready 전환`을 끄면 Draft를 그대로 유지하며, 다시 켜면 다음 동기화에서 지난 날짜 Draft를 처리합니다. Chrome이 꺼져 있었다면 다음 시작이나 15분 주기 복구 작업에서 처리합니다.

팝업의 `다시 동기화`는 네트워크 실패뿐 아니라 카탈로그 갱신 후 보류된 제출도 다시 검사합니다. 이미 Ready/closed/merged된 날짜 branch에는 새 커밋을 만들지 않고 확인 필요 상태로 남깁니다.

## 상태 관리 아키텍처

PR의 실제 상태는 GitHub를 단일 source of truth로 사용합니다. 확장 프로그램은 로컬 스냅샷의 `draft` 값을 믿고 커밋하지 않으며, 날짜 branch에 쓰기 전에 GitHub API에서 해당 PR을 `state=all`로 조회해 다음 상태를 구분합니다.

- `draft`: 새 풀이를 누적할 수 있습니다.
- `ready`: 새 커밋을 차단하고 사용자 확인을 요청합니다.
- `closed`: 새 PR을 중복 생성하지 않고 GitHub에서 기존 PR을 다시 열도록 안내합니다.
- `merged`: 해당 날짜 작업이 종료된 것으로 보고 새 커밋을 차단합니다.

GitHub 상태 폴링은 팝업을 열 때, 확장 프로그램 시작 시, 제출 동기화 전, 15분 주기 alarm, KST 자정 처리 시점에 실행됩니다. 배경 폴링은 오늘·어제, 미동기화 제출이 있는 날짜, 아직 Draft/closed로 캐시된 날짜를 조회합니다. `pullSnapshots`는 GitHub 조회가 실패했을 때 마지막 확인 상태를 보여주기 위한 캐시일 뿐, 커밋·PR 생성 여부를 결정하는 원본이 아닙니다. 과거 Ready/merged 스냅샷은 추가 폴링이 필요 없으므로 캐시에서 제거합니다.

로컬 저장소의 역할은 다음과 같습니다.

- `pendingAttempts`: 제출 코드를 캡처한 후 Accepted 결과를 기다리는 10분 이내의 임시 데이터
- `pendingQueue`: Accepted는 확인됐지만 GitHub 동기화가 완료되지 않은 코드와 문제 자동 감지값. 사용자가 문제 정보를 수정한 경우 카탈로그 검증을 마친 `problemOverride`도 함께 보관하며, 동기화 시 `problemOverride > 자동 감지값` 순서로 해석합니다. 동기화 성공 시 즉시 제거
- `syncHistory`: 최근 동기화 완료 내역. 소스 코드 없이 최대 100개 보관
- `pullSnapshots`: GitHub PR 상태의 비권위적 캐시
- `branchClaims`: PR이 아직 없는 branch가 확장 프로그램이 생성한 branch인지 확인하기 위한 로컬 소유 기록

닫힌 PR을 Draft로 다시 열면 다음 폴링에서 이를 감지하고, `pull_closed` 또는 `pull_ready` 사유로만 보류된 같은 날짜의 제출을 다시 `pending`으로 전환합니다. 인증, 카탈로그, 지원 언어 오류로 보류된 제출은 PR 상태 변경만으로 자동 재시도하지 않습니다.
