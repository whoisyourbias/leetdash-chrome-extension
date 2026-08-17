# Leetdash Submission Sync 개인정보 안내

최종 업데이트: 2026-08-17

Leetdash Submission Sync는 LeetCode, Programmers, SWEA에서 사용자가 제출해 통과한 풀이를 사용자의 GitHub fork와 중앙 Leetdash 저장소의 Draft Pull Request로 전송하는 Chrome 확장 프로그램입니다.

## 처리하는 데이터

- GitHub OAuth access token, GitHub 로그인 ID와 프로필 이미지 URL
- 지원 사이트의 문제 페이지 URL과 제목
- 제출 시점의 소스 코드와 선택된 프로그래밍 언어
- Accepted 시각, 동기화 상태, 생성된 Pull Request 주소

확장 프로그램은 광고 식별자, 결제 정보, 사이트 로그인 비밀번호 또는 SWEA 세션 쿠키를 수집하지 않습니다.

## 이용 목적과 전송 대상

위 데이터는 사용자를 확인하고 Accepted 풀이를 날짜별 GitHub Draft Pull Request에 누적하기 위해서만 사용합니다. 사용자 목록과 문제 카탈로그는 중앙 `whoisyourbias/leetdash` 저장소의 `data/users.json`과 `data/problem-catalog.json`에서 읽으며, GitHub 로그인 ID, 문제 정보와 소스 코드는 GitHub API를 통해 GitHub로 전송됩니다.

중앙 저장소와 사용자 fork가 공개 저장소이므로 동기화된 소스 코드, 커밋과 Pull Request는 인터넷에 공개됩니다. 사용자는 이 공개 범위를 이해한 뒤 GitHub 로그인을 진행하고 풀이를 제출해야 합니다.

LeetCode, Programmers, SWEA 페이지에서 읽은 코드는 Accepted 판정과 GitHub 동기화 이외의 목적으로 사용하거나 별도의 Leetdash 서버로 전송하지 않습니다. 확장 프로그램은 사용량 분석, 광고 또는 사용자 추적 서비스를 사용하지 않습니다.

## 저장과 삭제

- GitHub OAuth access token은 `chrome.storage.local`에 저장되며 웹 페이지에 노출하지 않습니다.
- 동기화 대기 중인 코드는 로컬 큐에 저장되고 GitHub 업로드가 완료되면 로컬 코드 본문을 제거합니다.
- 로그아웃하면 인증 정보가 제거됩니다. 미동기화 코드가 있으면 삭제 여부를 먼저 확인합니다.
- GitHub에 올라간 커밋과 Pull Request의 보관 및 삭제는 GitHub와 각 저장소의 정책 및 권한을 따릅니다.
- 확장 프로그램을 제거하면 Chrome이 해당 확장의 로컬 저장 데이터를 제거합니다.

## 제3자 서비스

확장 프로그램은 기능 제공을 위해 GitHub OAuth와 GitHub API를 사용합니다. GitHub에서 처리되는 데이터에는 [GitHub 개인정보처리방침](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)이 적용됩니다.

## 문의

데이터 처리 또는 삭제에 관한 문의는 [whoisyourbias/leetdash 이슈](https://github.com/whoisyourbias/leetdash/issues)에 남길 수 있습니다.
