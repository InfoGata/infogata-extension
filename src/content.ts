import { browser } from "webextension-polyfill-ts";
import { ContentMessage, ContentMessageType, HookMessage } from "./types";

console.log("InfoGata extension initialized");

const hook = browser.extension.getURL("src/hook.js");

const injectScript = (file: string) => {
  let script = document.createElement("script");
  script.setAttribute("type", "text/javascript");
  script.setAttribute("src", file);
  document.documentElement.appendChild(script);
};

injectScript(hook);

const sendMessage = (message: ContentMessage) => {
  window.postMessage(message);
};

window.addEventListener("message", async (e: MessageEvent<HookMessage>) => {
  if (e.source !== window || !e.data) {
    return;
  }

  if (e.data.type === "infogata-extension-request") {
    const response = await browser.runtime.sendMessage({
      type: ContentMessageType.NetworkRequest,
      input: e.data.input,
      init: e.data.init,
    });
    sendMessage({
      type: "infogata-extension-response",
      result: response,
      uid: e.data.uid,
    });
  }
});

// Add listener so that browser.tabs.sendMessage no longer errors
browser.runtime.onMessage.addListener(() => {});
