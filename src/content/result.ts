export type ResultProvider = "leetcode" | "programmers" | "swea";

const failurePattern = /실패|오답|틀렸|시간\s*초과|메모리\s*초과|런타임\s*에러|컴파일\s*에러|통과하지\s*못|failed|wrong\s+answer|time\s+limit|memory\s+limit|runtime\s+error|compile\s+error/i;

export function hasAcceptedResult(provider: ResultProvider | undefined, text: string): boolean {
  if (!provider || failurePattern.test(text)) return false;
  if (provider === "leetcode") return /\bAccepted\b|정답입니다|통과했습니다/i.test(text);
  if (provider === "programmers") {
    // A 100-point correctness section alone is not a successful submission.
    // The total score (or an explicit all-tests-passed message) must be present.
    return /합계\s*:\s*100(?:\.0+)?|모든\s*테스트케이스를\s*통과|테스트를\s*통과했습니다|정답입니다/i.test(text);
  }
  return /\bAccepted\b|\bPass\b|정답입니다|모든\s*테스트케이스를\s*통과/i.test(text);
}
