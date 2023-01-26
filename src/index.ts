import { DEFAULT_ORIGIN_LIST } from "./defaultOrigns";
import browser from "webextension-polyfill";

import { ContentMessageType, HandleRequestResponse } from "./types";

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
        if (chrome.scripting) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["up_/src/content.js"],
          });
        } else {
          browser.tabs.executeScript(tab.id, {
            file: "up_/src/content.js",
          });
        }
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

const loadHook = (tabId: number) => {
  if (chrome.scripting) {
    chrome.scripting.executeScript({
      target: {
        tabId: tabId,
      },
      files: ["up_/src/hook.js"],
      world: "MAIN",
    });
  } else {
    browser.tabs.executeScript(tabId, {
      file: "up_/src/hook.js",
    });
  }
};

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.type) {
    case ContentMessageType.NetworkRequest:
      return handleRequest(message.input, message.init);
    case ContentMessageType.ExecuteHook:
      if (sender.tab.id) {
        loadHook(sender.tab.id);
      }
      break;
  }
});

init();
