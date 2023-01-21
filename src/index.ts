import { browser } from "webextension-polyfill-ts";
import { DEFAULT_ORIGIN_LIST } from "./defaultOrigns";
import {
  ContentMessageType,
  HandleRequestResponse,
  NetworkRequest,
} from "./types";

let origins: string[] = [];
const defaultOrigins = DEFAULT_ORIGIN_LIST;

const init = async () => {
  const items = await browser.storage.local.get();
  const strOrigins = items["origins"];
  if (strOrigins) {
    origins = JSON.parse(strOrigins);
  }
};

browser.storage.onChanged.addListener((changes) => {
  if (changes.origins && changes.origins.newValue) {
    origins = JSON.parse(changes.origins.newValue);
  }
});

browser.runtime.onInstalled.addListener(async () => {
  await browser.storage.local.set({ origins: JSON.stringify(defaultOrigins) });
});

browser.tabs.onUpdated.addListener(async (_id, _info, tab) => {
  if (tab.status !== "loading") {
    const url = new URL(tab.url);
    if (origins.includes(url.origin)) {
      browser.tabs.sendMessage(tab.id, { action: "ping" }).catch(() => {
        // Doesn't contain content script
        // so inject it
        browser.tabs.executeScript(tab.id, { file: "src/content.js" });
      });
    }
  }
});

const convertBlobToBase64 = (blob: Blob): Promise<string | ArrayBuffer> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = reader.result;
      resolve(base64data);
    };
  });

const handleRequest = async (
  input: RequestInfo,
  init?: RequestInit
): Promise<HandleRequestResponse> => {
  const newInit = init || {};
  newInit.credentials = "omit";
  const response = await fetch(input, newInit);
  const blob = await response.blob();
  const responseHeaders = Object.fromEntries(response.headers.entries());
  const result = {
    base64: await convertBlobToBase64(blob),
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  };

  return Promise.resolve(result);
};

browser.runtime.onMessage.addListener((message) => {
  if (message.type === ContentMessageType.NetworkRequest) {
    return handleRequest(message.input, message.init);
  }
});

init();
