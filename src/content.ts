import { browser } from "webextension-polyfill-ts";
import { ContentMessageType, HookMessageType } from "./types";

console.log("InfoGata extension initialized");

const hook = browser.extension.getURL("src/hook.js");

const injectScript = (file: string) => {
  let script = document.createElement("script");
  script.setAttribute("type", "text/javascript");
  script.setAttribute("src", file);
  document.documentElement.appendChild(script);
};

injectScript(hook);

window.addEventListener("message", async (e: MessageEvent) => {
  if (e.source !== window || !e.data) {
    return;
  }

  if (e.data.type === HookMessageType.Request) {
    const response = await browser.runtime.sendMessage({
      type: ContentMessageType.NetworkRequest,
      input: e.data.input,
      init: e.data.init,
    });
    window.postMessage({ type: HookMessageType.Response, result: response });
  }
});

// Add listener so that browser.tabs.sendMessage no longer errors
browser.runtime.onMessage.addListener(() => {});
