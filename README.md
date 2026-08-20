# Leetdash Submission Sync

LeetCode, Programmers, SWEA에서 Accepted된 코드를 `whoisyourbias/leetdash`의 날짜별 Draft PR에 자동으로 누적하는 Manifest V3 Chrome 확장 프로그램입니다.

## 요구사항

- Chrome 또는 Chromium 기반 브라우저
- 소스에서 빌드할 경우 Node.js 20 이상과 npm
- 중앙 [`whoisyourbias/leetdash` 저장소의 `data/users.json`](https://github.com/whoisyourbias/leetdash/blob/master/data/users.json)에 등록된 GitHub 계정

참가자 등록은 확장 프로그램 저장소가 아니라 중앙 `whoisyourbias/leetdash` 저장소에서 관리합니다. 등록되지 않은 사용자는 `data/users.json`을 수정하는 PR을 만들고, 해당 변경이 `master`에 반영된 뒤 확장 프로그램에 로그인해야 합니다.

문제 카탈로그와 사용자 목록은 확장 프로그램에 번들하지 않습니다. 실행 중 중앙 저장소의 `master`에 있는 `data/problem-catalog.json`과 `data/users.json`을 GitHub API로 읽습니다.

## 빌드

의존성을 설치하고 테스트, 타입 검사, 개발용 빌드를 실행합니다.

```bash
npm ci
npm test
npm run typecheck
npm run build
```

빌드 결과는 `dist/`에 생성됩니다. GitHub OAuth Client ID는 공개 식별자로 소스에 포함되어 있으므로 별도 환경 변수나 `.env` 파일이 필요하지 않습니다. Client secret은 사용하지 않으며 소스, 빌드 또는 릴리스 파일에 추가하면 안 됩니다.

## 확장 프로그램 실행

1. Chrome 주소창에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위의 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 저장소의 `dist/` 디렉터리를 선택합니다.
5. 코드를 수정한 경우 `npm run build`를 다시 실행하고 확장 프로그램 카드의 새로고침 버튼을 누릅니다.

GitHub Release의 ZIP으로 설치할 때는 먼저 압축을 푼 다음, 압축을 푼 디렉터리를 같은 방식으로 선택합니다. ZIP 자체를 `압축해제된 확장 프로그램`으로 선택할 수는 없습니다.

## 사용법

1. LeetCode, Programmers 또는 SWEA의 문제 페이지를 엽니다.
2. 툴바에서 Leetdash 아이콘을 누르고 `GitHub 로그인`을 선택합니다.
3. 표시된 Device Flow 코드를 GitHub 인증 페이지에 입력하고 `public_repo` 권한을 승인합니다.
4. 팝업의 `현재 열린 문제`에서 감지된 공급자와 문제 번호를 확인합니다.
5. 감지 결과가 틀렸다면 `현재 문제 수정`에서 올바른 공급자와 번호를 저장합니다. 사용자 지정 값은 같은 문제를 새로고침하거나 다시 방문해도 유지되며 `자동 감지로 되돌리기`를 눌러야 해제됩니다.
6. 문제 사이트에서 코드를 제출해 Accepted를 받습니다. 제출 시점에 캡처한 코드는 Accepted가 10분 안에 확인된 경우에만 동기화 큐에 들어갑니다.
7. 팝업에서 동기화 단계와 결과를 확인합니다. 성공한 코드는 GitHub의 날짜별 브랜치와 Draft PR에 누적되고 로컬 미동기화 큐에서는 제거됩니다.
8. 네트워크나 카탈로그 문제로 실패했다면 오류를 수정한 뒤 `다시 동기화`를 누릅니다.

같은 문제를 다른 문제 번호로 다시 동기화하려면 현재 문제 번호를 수정한 뒤 다시 Accepted 제출해야 합니다. 이미 GitHub에 올라간 이전 번호의 파일은 자동으로 삭제되지 않습니다.

OAuth token은 `chrome.storage.local`의 service worker 영역에 저장됩니다. 미동기화 코드는 `pendingQueue`에만 임시 보관하고, 완료 기록은 코드 본문 없이 `syncHistory`에 최대 100개 저장합니다. 로그아웃할 때 미동기화 코드가 있으면 삭제 여부를 먼저 확인합니다. 자세한 데이터 처리 범위는 [개인정보 안내](PRIVACY.md)를 확인하세요.

## 릴리스 패키지 생성

```bash
npm run package
unzip -t artifacts/leetdash-extension.zip
```

`npm run package`는 빌드를 다시 실행하고 `artifacts/leetdash-extension.zip`을 생성합니다. ZIP 내부 최상위에 `manifest.json`이 있으므로 Chrome Web Store와 GitHub Release에 그대로 업로드할 수 있습니다.

새 버전을 배포할 때는 다음 순서를 따릅니다.

1. `package.json`, `package-lock.json`, `static/manifest.json`의 버전을 동일하게 올립니다.
2. 테스트와 타입 검사를 통과시킵니다.
3. `npm run package`와 `unzip -t`로 최종 ZIP을 검증합니다.
4. 기본 브랜치에 병합된 커밋에 `v<version>` annotated tag를 만들고 GitHub Release에 ZIP을 첨부합니다.

`dist/`와 `artifacts/`는 재생성 가능한 산출물이므로 저장소에는 커밋하지 않습니다. GitHub Release 설치는 자동 업데이트를 제공하지 않으므로 새 버전마다 ZIP을 다시 받아 설치해야 합니다.

## GitHub OAuth

확장 프로그램은 GitHub OAuth Device Flow를 사용하며 공개 Client ID만 포함합니다. OAuth App에는 `Enable Device Flow`가 활성화되어 있습니다. Client ID는 앱을 식별할 뿐 인증 비밀로 사용하지 않습니다. GitHub access token은 사용자가 Device Flow를 승인한 뒤에만 발급됩니다.

GitHub가 만료되거나 취소된 token에 `401 Unauthorized`를 반환하면 저장된 인증만 해제하고 재로그인을 안내합니다. 아직 업로드하지 않은 풀이는 로컬 큐에 보존되며, 재로그인 후 자동으로 동기화를 다시 시도합니다.

## 동작

- 제출 버튼 또는 `Ctrl/Cmd+Enter` 시점의 코드와 언어를 캡처하고 10분 안에 Accepted 결과가 나타날 때만 큐에 넣습니다.
- GitHub 계정은 중앙 [`whoisyourbias/leetdash`의 `data/users.json`](https://github.com/whoisyourbias/leetdash/blob/master/data/users.json)에 등록되어 있어야 하며, 문제는 같은 저장소의 `data/problem-catalog.json`에 존재해야 합니다.
- 경로는 provider별 canonical source인 `leetcode`, `programmers`, `swea`를 사용합니다.
- 팝업의 `현재 열린 문제`에는 제출 전부터 자동 감지된 provider와 문제 번호가 표시됩니다. 이를 수정하면 중앙 카탈로그 검증을 통과한 값이 문제 화면별 `problemOverride`로 저장되며, 같은 화면의 기존 `pending` 또는 `blocked` 제출에도 즉시 반영됩니다.
- 사용자가 한 번 저장한 `problemOverride`는 같은 문제의 새로고침·재방문·재제출에서 유지되고 자동 재감지, 중복 Accepted 캡처, 재시도보다 항상 우선합니다. 팝업에서 명시적으로 `자동 감지로 되돌리기`를 선택해야만 제거됩니다.
- 일반 참가자는 fork가 없으면 `<githubUsername>/leetdash`를 자동 생성합니다. 원본 저장소 소유자는 fork 대신 `submissions/<githubUsername>/YYMMDD` upstream branch를 사용하되 항상 Draft PR을 거칩니다.
- Accepted 시각의 Asia/Seoul 날짜 `YYMMDD`를 branch와 Draft PR 제목으로 사용합니다. 같은 날짜 PR이 이미 병합되었다면 `YYMMDD-2`, `YYMMDD-3` 순서로 후속 branch와 Draft PR을 자동 생성합니다.
- 같은 문제를 다른 언어로 다시 통과하면 기존 `Solution.*`를 제거하고 최신 코드를 한 커밋으로 기록합니다.
- 기본 설정에서는 KST 자정 이후 미동기화 큐가 없으면 Draft를 Ready로 바꿉니다. 팝업의 `자정 이후 자동 Ready 전환`을 끄면 Draft를 그대로 유지하며, 다시 켜면 다음 동기화에서 지난 날짜 Draft를 처리합니다. Chrome이 꺼져 있었다면 다음 시작이나 15분 주기 복구 작업에서 처리합니다.

팝업의 `다시 동기화`는 네트워크 실패뿐 아니라 카탈로그 갱신 후 보류된 제출도 다시 검사합니다. Ready/closed 날짜 branch는 새 커밋을 만들지 않고 확인 필요 상태로 남기며, merged 날짜 branch는 다음 번호의 후속 Draft PR로 이어서 제출합니다.

## 상태 관리 아키텍처

PR의 실제 상태는 GitHub를 단일 source of truth로 사용합니다. 확장 프로그램은 로컬 스냅샷의 `draft` 값을 믿고 커밋하지 않으며, 날짜 branch에 쓰기 전에 GitHub API에서 해당 PR을 `state=all`로 조회해 다음 상태를 구분합니다.

- `draft`: 새 풀이를 누적할 수 있습니다.
- `ready`: 새 커밋을 차단하고 사용자 확인을 요청합니다.
- `closed`: 새 PR을 중복 생성하지 않고 GitHub에서 기존 PR을 다시 열도록 안내합니다.
- `merged`: 다음 번호의 날짜 branch를 직전 PR head에서 생성하고 새 Draft PR에 제출을 이어갑니다.

GitHub 상태 폴링은 팝업을 열 때, 확장 프로그램 시작 시, 제출 동기화 전, 15분 주기 alarm, KST 자정 처리 시점에 실행됩니다. 배경 폴링은 오늘·어제, 미동기화 제출이 있는 날짜, 아직 Draft/closed로 캐시된 날짜를 조회합니다. `pullSnapshots`는 GitHub 조회가 실패했을 때 마지막 확인 상태를 보여주기 위한 캐시일 뿐, 커밋·PR 생성 여부를 결정하는 원본이 아닙니다. 과거 Ready/merged 스냅샷은 추가 폴링이 필요 없으므로 캐시에서 제거합니다.

로컬 저장소의 역할은 다음과 같습니다.

- `pendingAttempts`: 제출 코드를 캡처한 후 Accepted 결과를 기다리는 10분 이내의 임시 데이터
- `pendingQueue`: Accepted는 확인됐지만 GitHub 동기화가 완료되지 않은 코드와 문제 자동 감지값. 사용자가 문제 정보를 수정한 경우 카탈로그 검증을 마친 `problemOverride`도 함께 보관하며, 동기화 시 `problemOverride > 자동 감지값` 순서로 해석합니다. 동기화 성공 시 즉시 제거
- `problemOverrides`: 문제 화면 식별 키별로 사용자가 확정한 provider와 문제 번호. 수동 해제 전에는 해당 문제를 자동 매핑 대상으로 되돌리지 않습니다.
- `syncHistory`: 최근 동기화 완료 내역. 소스 코드 없이 최대 100개 보관
- `pullSnapshots`: GitHub PR 상태의 비권위적 캐시
- `branchClaims`: PR이 아직 없는 branch가 확장 프로그램이 생성한 branch인지 확인하기 위한 로컬 소유 기록

닫힌 PR을 Draft로 다시 열면 다음 폴링에서 이를 감지하고, `pull_closed` 또는 `pull_ready` 사유로 보류된 같은 날짜의 제출을 다시 `pending`으로 전환합니다. 이전 버전에서 `pull_merged`로 보류된 제출도 후속 Draft PR을 사용할 수 있게 자동 복구합니다. 인증, 카탈로그, 지원 언어 오류로 보류된 제출은 PR 상태 변경만으로 자동 재시도하지 않습니다.
