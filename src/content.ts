import { browser } from "webextension-polyfill-ts";
import {
  ContentMessage,
  ContentMessageType,
  NetworkRequest,
  HookMessage,
  HandleRequestResponse,
} from "./types";

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

const base64ToBlob = async (base64: string): Promise<Blob> => {
  const response = await fetch(base64);
  return await response.blob();
};

window.addEventListener("message", async (e: MessageEvent<HookMessage>) => {
  if (e.source !== window || !e.data) {
    return;
  }

  if (e.data.type === "infogata-extension-request") {
    const response: HandleRequestResponse = await browser.runtime.sendMessage({
      type: ContentMessageType.NetworkRequest,
      input: e.data.input,
      init: e.data.init,
    });

    let body =
      typeof response.base64 === "string"
        ? await base64ToBlob(response.base64)
        : response.base64;

    let result: NetworkRequest = {
      body: body,
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
    };

    sendMessage({
      type: "infogata-extension-response",
      result,
      uid: e.data.uid,
    });
  }
});

// Add listener so that browser.tabs.sendMessage no longer errors
browser.runtime.onMessage.addListener(() => {});
