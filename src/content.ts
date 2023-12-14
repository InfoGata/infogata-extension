import browser from "webextension-polyfill";
import {
  ContentMessage,
  NetworkRequest,
  HookMessage,
  HandleRequestResponse,
  HookRequest,
  BackgroundMessage,
  HookOpenLogin,
  TabMessage,
  HookGetVersion,
} from "./types";

console.log("InfoGata extension initialized");

const sendMessageToBackground = async (
  message: BackgroundMessage
): Promise<any> => {
  return await browser.runtime.sendMessage(message);
};

const injectScript = () => {
  sendMessageToBackground({ type: "execute-hook" });
};

injectScript();

const sendMessageToHook = (message: ContentMessage) => {
  window.postMessage(message);
};

const base64ToBlob = async (base64: string): Promise<Blob> => {
  const response = await fetch(base64);
  return await response.blob();
};

const makeNetworkRequest = async (request: HookRequest) => {
  const response: HandleRequestResponse = await sendMessageToBackground({
    type: "network-request",
    input: request.input,
    init: request.init,
    options: request.options,
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

  sendMessageToHook({
    type: "infogata-extension-response",
    result,
    uid: request.uid,
  });
};

const openWindow = (request: HookOpenLogin) => {
  sendMessageToBackground({
    type: "open-login",
    auth: request.auth,
    pluginId: request.pluginId,
  });
};

const getVersion = (request: HookGetVersion) => {
  sendMessageToHook({
    type: "infogata-extension-getversion-content",
    uid: request.uid,
    result: browser.runtime.getManifest().version,
  });
};

window.addEventListener("message", async (e: MessageEvent<HookMessage>) => {
  if (e.source !== window || !e.data) {
    return;
  }

  switch (e.data.type) {
    case "infogata-extension-openlogin-hook":
      openWindow(e.data);
      break;
    case "infogata-extension-request":
      await makeNetworkRequest(e.data);
      break;
    case "infogata-extension-getversion-hook":
      getVersion(e.data);
      break;
  }
});

browser.runtime.onMessage.addListener((message: TabMessage) => {
  if (message.type === "notify-login") {
    window.postMessage({
      type: "infogata-extension-notify-login",
      pluginId: message.pluginId,
      headers: message.headers,
    });
  }
});
