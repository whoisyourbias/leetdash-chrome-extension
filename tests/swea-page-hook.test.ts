import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const hookSource = readFileSync(fileURLToPath(new URL("../static/content/swea-page-hook.js", import.meta.url)), "utf8");

function installHook(inAboutBlankFrame = false) {
  const messages: any[] = [];
  class FakeXhr {
    responseType = "";
    responseText = "";
    response: unknown;
    private listeners = new Map<string, Array<() => void>>();

    open(_method?: string, _url?: string): void {}
    send(_body?: unknown): void {}
    addEventListener(type: string, listener: () => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    finish(payload: unknown): void {
      this.responseText = JSON.stringify(payload);
      for (const listener of this.listeners.get("load") ?? []) listener.call(this);
    }
  }
  const problemUrl = "https://swexpertacademy.com/main/code/problem/problemDetail.do?contestProbId=opaque";
  const location = inAboutBlankFrame
    ? { href: "about:blank", origin: "null" }
    : { href: problemUrl, origin: "https://swexpertacademy.com" };
  const window = {
    XMLHttpRequest: FakeXhr,
    fetch: undefined,
    top: { location: { href: problemUrl } },
    postMessage: (message: unknown, origin: string) => messages.push({ message, origin }),
  };
  runInNewContext(hookSource, { window, location, URL, WeakMap, JSON, String });
  return { FakeXhr, messages };
}

describe("SWEA page-world submission hook", () => {
  it("reports submit start and the real runVaue Pass response", () => {
    const { FakeXhr, messages } = installHook();
    const xhr = new FakeXhr();
    xhr.open("POST", "https://swexpertacademy.com/main/commonCompileRun/submit.do");
    xhr.send();
    xhr.finish({ result: "success", vo: { runVaue: "Pass" } });

    expect(messages.map(({ message }) => message.type)).toEqual([
      "submission-started",
      "submission-accepted",
    ]);
    expect(messages.every(({ origin }) => origin === "https://swexpertacademy.com")).toBe(true);
  });

  it("does not report a failed SWEA result as accepted", () => {
    const { FakeXhr, messages } = installHook();
    const xhr = new FakeXhr();
    xhr.open("POST", "/main/commonCompileRun/submit.do");
    xhr.send();
    xhr.finish({ result: "success", vo: { runVaue: "Fail" } });

    expect(messages.map(({ message }) => message.type)).toEqual(["submission-started"]);
  });

  it("detects relative submit requests made by an about:blank runner iframe", () => {
    const { FakeXhr, messages } = installHook(true);
    const xhr = new FakeXhr();
    xhr.open("POST", "/main/commonCompileRun/submit.do");
    xhr.send();
    xhr.finish({ result: "success", vo: { runValue: "Pass" } });

    expect(messages.map(({ message }) => message.type)).toEqual([
      "submission-started",
      "submission-accepted",
    ]);
  });
});
