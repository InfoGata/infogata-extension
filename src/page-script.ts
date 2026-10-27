/**
 * Runs script source as the page itself on Firefox MV2.
 *
 * MV2 has no `scripting` API and no MAIN world. Injecting into the content
 * script is not enough: globals there resolve to the sandbox's own, so a
 * `fetch` goes out under the extension principal rather than as the page, and
 * the page's own globals are out of reach. So the source is written into a real
 * <script> element, which does run as the page, and the result comes back
 * through postMessage. The page must allow inline scripts: either it serves no
 * CSP, or the extension removed it for this document. When the CSP blocks the
 * script this resolves undefined straight away rather than at the timeout.
 *
 * `expression` is JavaScript that evaluates to the result or a promise of it.
 * `prelude` is run first in the same script, for code that sets up globals.
 * Resolves undefined if the page never answers within `timeoutMs`.
 */
export const runPageScriptMv2 = async <T>(
  tabId: number,
  options: {
    expression: string;
    prelude?: string;
    frameId?: number;
    timeoutMs: number;
  }
): Promise<T | undefined> => {
  const id = `ps_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pageScript =
    `${options.prelude ?? ""}\n;` +
    `Promise.resolve().then(function () { return (${options.expression}); })` +
    `.then(function (r) { window.postMessage({ __pageScriptId: ${JSON.stringify(id)}, result: r }, "*"); })` +
    `.catch(function (e) { window.postMessage({ __pageScriptId: ${JSON.stringify(id)},` +
    ` result: { error: String(e && e.message ? e.message : e) } }, "*"); });`;

  const code = `(function () {
    return new Promise(function (resolve) {
      var settle = function (value) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        document.removeEventListener("securitypolicyviolation", onViolation);
        resolve(value);
      };
      var timer = setTimeout(function () { settle(undefined); }, ${options.timeoutMs});
      var onMessage = function (event) {
        if (event.source !== window) return;
        if (!event.data || event.data.__pageScriptId !== ${JSON.stringify(id)}) return;
        settle(event.data.result);
      };
      window.addEventListener("message", onMessage);
      // A page CSP that forbids inline scripts blocks the element silently;
      // without this the caller would wait out the whole timeout.
      var onViolation = function (event) {
        if (/^script-src/.test(event.violatedDirective || "")) settle(undefined);
      };
      document.addEventListener("securitypolicyviolation", onViolation);
      var script = document.createElement("script");
      script.textContent = ${JSON.stringify(pageScript)};
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    });
  })()`;

  const results = (await browser.tabs.executeScript(tabId, {
    code,
    ...(options.frameId !== undefined ? { frameId: options.frameId } : {}),
  })) as (T | undefined)[] | undefined;
  return results?.[0];
};
