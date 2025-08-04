import { DEFAULT_ORIGIN_LIST } from "../src/defaultOrigns";
import {
  BackgroundMessage,
  ExecuteScriptOptions,
  HandleRequestResponse,
  LoginMessage,
  LoginTab,
  ManifestAuthentication,
  NetworkRequestOptions,
  TabMessage,
} from "../src/types";

export default defineBackground(() => {

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

  // Current firefox version is manifest v2
  // so check if chrome.scripting exists
  const isChrome = !!chrome.scripting;

  const executeScript = (tabId: number, options: ExecuteScriptOptions) => {
    if (isChrome) {
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

  const injectContentScript = (tab: Browser.tabs.Tab) => {
    if (tab.id) {
      browser.tabs.sendMessage(tab.id, { action: "ping" }).catch(() => {
        // Doesn't contain content script
        // so inject it
        if (tab.id) {
          executeScript(tab.id, { file: "content-script.js" });
        }
      });
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
    const urlPatterns = origins.map((o) => `${o}/*`);
    for (const tab of await browser.tabs.query({ url: urlPatterns })) {
      if (tab.status !== "loading") {
        injectContentScript(tab);
      }
    }
  });

  browser.tabs.onUpdated.addListener(async (_id, _info, tab) => {
    if (tab.status !== "loading" && tab.url) {
      const url = new URL(tab.url);
      if (origins.includes(url.origin)) {
        injectContentScript(tab);
      }
    }
  });

  const sendTabMessage = (message: TabMessage) => {
    if (loginTab?.senderTab.id) {
      browser.tabs.sendMessage(loginTab.senderTab.id, message);
    }
  };

  const sendLoginMessage = (message: LoginMessage) => {
    if (loginTab?.windowTab.id) {
      browser.tabs.sendMessage(loginTab.windowTab.id, message);
    }
  };

  const convertBlobToBase64 = (
    blob: Blob
  ): Promise<string | ArrayBuffer | null> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        const base64data = reader.result;
        resolve(base64data);
      };
    });

  const isAuthorizedDomain = (
    input: string,
    loginUrl?: string,
    domainHeaders?: Record<string, any>
  ): boolean => {
    if (!loginUrl) return false;

    const allowedHost = new URL(loginUrl).host;
    const inputHost = new URL(input).host;
    if (allowedHost === inputHost) {
      return true;
    }
    if (domainHeaders && Object.keys(domainHeaders).length > 0) {
      return Object.keys(domainHeaders).some((d) => inputHost.endsWith(d));
    }
    return false;
  };

  const handleRequest = async (
    input: string,
    init?: RequestInit,
    options?: NetworkRequestOptions
  ): Promise<HandleRequestResponse> => {
    const newInit = init || {};
    // Check if input and domain
    if (
      !isAuthorizedDomain(
        input,
        options?.auth?.loginUrl,
        options?.auth?.domainHeadersToFind
      )
    ) {
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
    executeScript(tabId, { file: "hook.js", world: "MAIN" });
  };

  const openWindow = async (
    auth: ManifestAuthentication,
    pluginId: string,
    senderTab: Browser.tabs.Tab
  ) => {
    const win = await browser.windows.create({
      url: auth.loginUrl,
    });
    if (!win.tabs) {
      return;
    }
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
      await executeScript(tab.id, { file: "login-content.js" });
      sendLoginMessage({ type: "login-button", selector: auth.loginButton });
    }
    const onBeforeSendHeadersCallback = (
      details: Browser.webRequest.OnBeforeSendHeadersDetails
    ) => {
      if (!loginTab) {
        return undefined;
      }
      const detailsUrl = new URL(details.url);
      const urlHost = detailsUrl.host;
      const headers = details.requestHeaders!;
      const headerMap = new Map(headers.map((h) => [h.name, h.value]));

      if (auth.completionUrl && !loginTab.foundCompletionUrl) {
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
        const cookies = headerMap.get("Cookie")!;
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
                headerMap.get(header)!;
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
          for (const header of auth.headersToFind) {
            loginTab.headers[header] = headerMap.get(header)!;
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
        if (tab.id) {
          browser.tabs.remove(tab.id);
        }
      }
      return undefined;
    };

    const url = new URL(auth.loginUrl);
    // keys formatted as .domain.tld
    const urlPatterns = auth.domainHeadersToFind
      ? Object.keys(auth.domainHeadersToFind).map((d) => `*://*${d}/*`)
      : [];
    const extraInfo: Browser.webRequest.OnBeforeSendHeadersOptions[] = [
      "requestHeaders" as Browser.webRequest.OnBeforeSendHeadersOptions
    ];
    // firefox doesn't have extraHeaders so check if chrome
    if (isChrome) {
      extraInfo.push("extraHeaders" as Browser.webRequest.OnBeforeSendHeadersOptions);
    }
    browser.webRequest.onBeforeSendHeaders.addListener(
      onBeforeSendHeadersCallback,
      {
        tabId: tab.id,
        urls: [`${url.origin}/*`, ...urlPatterns],
      },
      extraInfo
    );
  };

  browser.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    if (message.type === "network-request") {
      handleRequest(message.input, message.init, message.options)
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse(null);
        });
      return true; // Indicates that the response is sent asynchronously
    }
    
    switch (message.type) {
      case "execute-hook":
        if (sender.tab) {
          if (sender.tab.id) {
            loadHook(sender.tab.id);
          }
        }
        break;
      case "open-login":
        if (sender.tab) {
          openWindow(message.auth, message.pluginId, sender.tab);
        }
        break;
    }
  });

  // Remove origin header if it's coming from this extension when making
  // requests to youtube
  if (!isChrome) {
    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        for (let i = 0; i < details.requestHeaders!.length; i++) {
          const header = details.requestHeaders![i];
          if (
            header.name === "Origin" &&
            header.value?.indexOf("moz-extension://") === 0
          ) {
            details.requestHeaders!.splice(i, 1);
            break;
          }
        }
        return { requestHeaders: details.requestHeaders };
      },
      {
        urls: ["*://*.youtube.com/*"],
      },
      ["requestHeaders", "blocking"]
    );
  } else {
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              {
                header: "origin",
                operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE,
              },
            ],
          },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            urlFilter: "||youtube.com",
            resourceTypes: [
              chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
            ],
          },
        },
      ],
    });
  }

  init();
});
