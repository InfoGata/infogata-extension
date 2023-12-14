import { DEFAULT_ORIGIN_LIST } from "./defaultOrigns";
import browser, { Tabs } from "webextension-polyfill";
import {
  BackgroundMessage,
  ExecuteScriptOptions,
  HandleRequestResponse,
  LoginMessage,
  LoginTab,
  ManifestAuthentication,
  NetworkRequestOptions,
  TabMessage,
} from "./types";

let origins: string[] = [];
const defaultOrigins = DEFAULT_ORIGIN_LIST;
let loginTab: LoginTab | undefined;

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

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await browser.storage.local.set({
      origins: JSON.stringify(defaultOrigins),
    });
  }
});

const executeScript = (tabId: number, options: ExecuteScriptOptions) => {
  // Chrome
  if (chrome.scripting) {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [options.file],
      world: options.world,
    });
  } else {
    // Firefox
    return browser.tabs.executeScript(tabId, { file: options.file });
  }
};

browser.tabs.onUpdated.addListener(async (_id, _info, tab) => {
  if (tab.status !== "loading") {
    const url = new URL(tab.url);
    if (origins.includes(url.origin)) {
      browser.tabs.sendMessage(tab.id, { action: "ping" }).catch(() => {
        // Doesn't contain content script
        // so inject it
        executeScript(tab.id, { file: "up_/src/content.js" });
      });
    }
  }
});

const sendTabMessage = (message: TabMessage) => {
  browser.tabs.sendMessage(loginTab.senderTab.id, message);
};

const sendLoginMessage = (message: LoginMessage) => {
  browser.tabs.sendMessage(loginTab.windowTab.id, message);
};

const convertBlobToBase64 = (blob: Blob): Promise<string | ArrayBuffer> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64data = reader.result;
      resolve(base64data);
    };
  });

const isAuthorizedDomain = (input: RequestInfo, url?: string): boolean => {
  if (!url) return false;

  let inputHost: string;
  const allowedHost = new URL(url).host;
  if (typeof input === "string") {
    inputHost = new URL(input).host;
  } else {
    // Request
    inputHost = new URL(input.url).host;
  }
  return allowedHost === inputHost;
};

const handleRequest = async (
  input: RequestInfo,
  init?: RequestInit,
  options?: NetworkRequestOptions
): Promise<HandleRequestResponse> => {
  const newInit = init || {};
  // Check if input and domain
  if (!isAuthorizedDomain(input, options?.auth?.loginUrl)) {
    newInit.credentials = "omit";
  }
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
  executeScript(tabId, { file: "up_/src/hook.js", world: "MAIN" });
};

const openWindow = async (
  auth: ManifestAuthentication,
  pluginId: string,
  senderTab?: Tabs.Tab
) => {
  const win = await browser.windows.create({
    url: auth.loginUrl,
  });
  const tab = win.tabs[0];
  loginTab = {
    windowTab: tab,
    auth: auth,
    senderTab,
    pluginId,
    foundCompletionUrl: !auth.completionUrl,
    foundHeaders: !auth.headersToFind,
    foundDomainHeaders: !auth.domainHeadersToFind,
    foundCookies: !auth.cookiesToFind,
    headers: {},
    domainHeaders: {},
  };
  if (auth.loginButton && tab.id) {
    await executeScript(tab.id, { file: "up_/src/login-content.js" });
    sendLoginMessage({ type: "login-button", selector: auth.loginButton });
  }
  const onBeforeSendHeadersCallback = (
    details: browser.WebRequest.OnBeforeSendHeadersDetailsType
  ) => {
    const detailsUrl = new URL(details.url);
    const urlHost = detailsUrl.host;
    const headers = details.requestHeaders;
    const headerMap = new Map(headers.map((h) => [h.name, h.value]));

    if (!loginTab.foundCompletionUrl) {
      if (details.url === auth.completionUrl) {
        loginTab.foundCompletionUrl = true;
      } else if (auth.completionUrl.endsWith("?*")) {
        const urlToCheck = auth.completionUrl.slice(0, -2);
        const originAndPath = `${detailsUrl.origin}${detailsUrl.pathname}`;
        loginTab.foundCompletionUrl = originAndPath === urlToCheck;
      }
    }

    if (
      auth.cookiesToFind &&
      !loginTab.foundCookies &&
      headerMap.has("Cookie")
    ) {
      const cookies = headerMap.get("Cookie");
      const cookieMap = new Map<string, string>(
        cookies
          .split(";")
          .map((c) => c.trim().split("="))
          .map((c) => [c[0], c[1]])
      );
      loginTab.foundCookies = auth.cookiesToFind.every((c) => cookieMap.has(c));
    }

    if (auth.domainHeadersToFind && !loginTab.foundDomainHeaders) {
      const domainToSearch = Object.keys(auth.domainHeadersToFind).find((d) =>
        urlHost.endsWith(d)
      );
      if (domainToSearch && !loginTab.domainHeaders[domainToSearch]) {
        const domainHeaders = auth.domainHeadersToFind[domainToSearch];
        const foundDomainHeaders = domainHeaders.every((dh) =>
          headerMap.has(dh)
        );
        if (foundDomainHeaders) {
          loginTab.domainHeaders[domainToSearch] = {};
          for (const header of domainHeaders) {
            loginTab.domainHeaders[domainToSearch][header] =
              headerMap.get(header);
          }
        }
      }
      if (
        Object.keys(loginTab.domainHeaders).length ===
        Object.keys(auth.domainHeadersToFind).length
      ) {
        loginTab.foundDomainHeaders = true;
      }
    }

    if (auth.headersToFind && !loginTab.foundHeaders) {
      loginTab.foundHeaders = auth.headersToFind.every((h) => headerMap.has(h));
      if (loginTab.foundHeaders) {
        for (const header of loginTab.auth.headersToFind) {
          loginTab.headers[header] = headerMap.get(header);
        }
      }
    }

    const {
      foundCompletionUrl,
      foundCookies,
      foundHeaders,
      foundDomainHeaders,
    } = loginTab;
    if (
      foundCompletionUrl &&
      foundCookies &&
      foundHeaders &&
      foundDomainHeaders
    ) {
      sendTabMessage({
        type: "notify-login",
        pluginId: loginTab.pluginId,
        headers: loginTab.headers,
        domainHeaders: loginTab.domainHeaders,
      });
      browser.tabs.remove(tab.id);
    }
  };
  const onTabRemovedCallback = (tabId: number) => {
    if (tabId === tab.id) {
      browser.webRequest.onBeforeSendHeaders.removeListener(
        onBeforeSendHeadersCallback
      );
    }
    browser.tabs.onRemoved.removeListener(onTabRemovedCallback);
  };
  browser.tabs.onRemoved.addListener(onTabRemovedCallback);

  const url = new URL(auth.loginUrl);
  // keys formatted as .domain.tld
  const urlPatterns = auth.domainHeadersToFind
    ? Object.keys(auth.domainHeadersToFind).map((d) => `*://*${d}/*`)
    : [];
  browser.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeadersCallback,
    {
      urls: [`${url.origin}/*`, ...urlPatterns],
    },
    ["requestHeaders", "extraHeaders"]
  );
};

browser.runtime.onMessage.addListener((message: BackgroundMessage, sender) => {
  switch (message.type) {
    case "network-request":
      return handleRequest(message.input, message.init, message.options);
    case "execute-hook":
      if (sender.tab.id) {
        loadHook(sender.tab.id);
      }
      break;
    case "open-login":
      openWindow(message.auth, message.pluginId, sender.tab);
  }
});

init();
