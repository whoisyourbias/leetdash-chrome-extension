(() => {
  const source = "leetdash-swea-page-hook";
  const submitPath = "/main/commonCompileRun/submit.do";

  function pageUrl() {
    if (/^https?:/.test(location.href)) return location.href;
    try {
      if (window.top?.location.href) return window.top.location.href;
    } catch {
      // Fall through to the embedding document URL.
    }
    return document.referrer || location.href;
  }

  function isSubmitRequest(input) {
    try {
      const value = typeof input === "string" ? input : input?.url ?? String(input);
      return new URL(value, pageUrl()).pathname === submitPath;
    } catch {
      return false;
    }
  }

  function emit(type) {
    window.postMessage({ source, type }, new URL(pageUrl()).origin);
  }

  function isAccepted(payload) {
    const value = payload?.vo?.runVaue
      ?? payload?.vo?.runValue
      ?? payload?.runVaue
      ?? payload?.runValue;
    return String(value ?? "")
      .replaceAll("&nbsp;", " ")
      .trim()
      .toLowerCase() === "pass";
  }

  function inspectPayload(payload) {
    if (isAccepted(payload)) emit("submission-accepted");
  }

  const xhrUrls = new WeakMap();
  const originalOpen = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.open = function (method, requestUrl, ...rest) {
    xhrUrls.set(this, requestUrl);
    return originalOpen.call(this, method, requestUrl, ...rest);
  };
  window.XMLHttpRequest.prototype.send = function (...args) {
    if (isSubmitRequest(xhrUrls.get(this))) {
      emit("submission-started");
      this.addEventListener("load", () => {
        try {
          const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
          inspectPayload(payload);
        } catch {
          // SWEA may return a non-JSON error page; it must never count as Pass.
        }
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function (...args) {
      const submit = isSubmitRequest(args[0]);
      if (submit) emit("submission-started");
      const responsePromise = originalFetch.apply(this, args);
      if (submit) {
        void responsePromise.then((response) => response.clone().json())
          .then(inspectPayload)
          .catch(() => undefined);
      }
      return responsePromise;
    };
  }
})();
