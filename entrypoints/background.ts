import {
  CREDENTIAL_HOSTS_KEY,
  credentialHostFor,
  hostFromUrl,
  loadCredentialHosts,
  normalizeHost,
  storeCredentialHosts,
  type CredentialHostMap,
} from "../src/credential-hosts";
import { DEFAULT_ORIGIN_LIST } from "../src/defaultOrigins";
import {
  DEFAULT_ACTION_TITLE,
  getBadgeState,
  getRuleKey,
  isValidAppOrigin,
} from "../src/redirect-utils";
import type {
  BackgroundMessage,
  ConsentKind,
  ExecuteScriptOptions,
  HandleRequestResponse,
  LoginMessage,
  LoginTab,
  ManifestAuthentication,
  NetworkRequestOptions,
  RedirectPreferences,
  SerializableRequestInit,
  SiteRedirectRule,
  TabMessage,
} from "../src/types";

export default defineBackground(() => {

  let origins: string[] = [];
  const defaultOrigins = DEFAULT_ORIGIN_LIST;
  let loginTab: LoginTab | undefined;
  let redirectRules: SiteRedirectRule[] = [];
  let redirectPreferences: RedirectPreferences = {
    globalEnabled: true,
    dismissedRuleKeys: [],
    defaultOrigins: {},
  };
  let credentialHosts: CredentialHostMap = {};

  /** A plugin cannot register more rules than a person would ever review. */
  const MAX_REDIRECT_RULES_PER_ORIGIN = 50;

  const init = async () => {
    const items = await browser.storage.local.get();
    const strOrigins = items["origins"];
    if (typeof strOrigins === "string") {
      origins = JSON.parse(strOrigins);
    }
    const strRules = items["redirectRules"];
    if (typeof strRules === "string") {
      redirectRules = JSON.parse(strRules);
    }
    const strPrefs = items["redirectPreferences"];
    if (typeof strPrefs === "string") {
      redirectPreferences = JSON.parse(strPrefs);
    }
    credentialHosts = await loadCredentialHosts();
  };

  /**
   * Message handlers await this. The service worker can be woken by a message
   * that arrives before storage has been read, and answering a credential
   * question from empty state would treat every stored decision as absent.
   */
  const ready = init();

  const saveRedirectRules = async () => {
    await browser.storage.local.set({
      redirectRules: JSON.stringify(redirectRules),
    });
  };

  const saveRedirectPreferences = async () => {
    await browser.storage.local.set({
      redirectPreferences: JSON.stringify(redirectPreferences),
    });
  };

  // --- Credential consent -------------------------------------------------
  //
  // A plugin can name a host it wants the user's cookies for, but only the user
  // can say yes. Decisions -- including refusals -- are stored, so a plugin that
  // keeps asking gets one window, not one per request.

  type PendingConsent = {
    hosts: string[];
    requester: string;
    resolve: (allowed: boolean) => void;
    windowId?: number;
  };

  const pendingConsents = new Map<string, PendingConsent>();
  /** Keyed by host set, so a burst of requests shares a single window. */
  const inFlightConsents = new Map<string, Promise<boolean>>();

  const recordConsent = async (
    hosts: string[],
    requester: string,
    allowed: boolean
  ) => {
    const decidedAt = Date.now();
    for (const host of hosts) {
      credentialHosts[host] = {
        decision: allowed ? "allow" : "deny",
        requester,
        decidedAt,
      };
    }
    await storeCredentialHosts(credentialHosts);
  };

  const askForConsent = (
    hosts: string[],
    requester: string,
    kind: ConsentKind,
    detail?: string
  ): Promise<boolean> => {
    const key = `${kind}:${[...hosts].sort().join(",")}`;
    const existing = inFlightConsents.get(key);
    if (existing) return existing;

    const promise = (async (): Promise<boolean> => {
      const id = crypto.randomUUID();
      let resolveDecision!: (allowed: boolean) => void;
      const decision = new Promise<boolean>((resolve) => {
        resolveDecision = resolve;
      });
      pendingConsents.set(id, {
        hosts,
        requester,
        resolve: resolveDecision,
      });

      const params = new URLSearchParams({
        id,
        kind,
        requester,
        hosts: hosts.join(","),
      });
      if (detail) params.set("detail", detail);
      const getURL = browser.runtime.getURL as (path: string) => string;

      try {
        const win = await browser.windows.create({
          url: `${getURL("/consent.html")}?${params.toString()}`,
          type: "popup",
          width: 440,
          height: 420,
        });
        const entry = pendingConsents.get(id);
        if (entry) entry.windowId = win?.id ?? undefined;
      } catch (e) {
        // No window means no way to ask, and no way to ask means no.
        console.warn("[InfoGata] Unable to open the consent window:", e);
        pendingConsents.delete(id);
        return false;
      }

      return decision;
    })();

    inFlightConsents.set(key, promise);
    promise.finally(() => inFlightConsents.delete(key));
    return promise;
  };

  /**
   * True only when every host has an explicit allow. Hosts with no stored
   * decision are put to the user; a single denial fails the whole set, because
   * partial credentials are not what the caller asked for.
   */
  const ensureCredentialConsent = async (
    hosts: string[],
    requester: string,
    kind: ConsentKind,
    detail?: string
  ): Promise<boolean> => {
    if (hosts.length === 0) return false;
    if (hosts.some((host) => credentialHosts[host]?.decision === "deny")) {
      return false;
    }
    const undecided = hosts.filter((host) => !credentialHosts[host]);
    if (undecided.length === 0) return true;
    return askForConsent(undecided, requester, kind, detail);
  };

  // A consent window closed without an answer is a refusal, but not a stored
  // one -- the user dismissed the question rather than answering it.
  browser.windows.onRemoved.addListener((windowId) => {
    for (const [id, entry] of pendingConsents) {
      if (entry.windowId === windowId) {
        pendingConsents.delete(id);
        entry.resolve(false);
      }
    }
  });

  const isMv3 = import.meta.env.MANIFEST_VERSION === 3;

  // MV3 renamed browserAction to action; the polyfill exposes only the one the
  // running manifest declares.
  const actionApi: any = isMv3
    ? (browser as any).action
    : (browser as any).browserAction;

  const BADGE_BACKGROUND = "#31c48d";
  const BADGE_TEXT_COLOR = "#1a1a2e";

  /**
   * Badge text and title are sticky per tab, so every navigation has to write
   * both -- including the empty state, or a count set on one page follows the
   * user to the next.
   */
  const updateBadge = async (tabId: number, url: string | undefined) => {
    if (!actionApi) return;
    const { text, title } = url
      ? getBadgeState(url, redirectRules, redirectPreferences)
      : { text: "", title: DEFAULT_ACTION_TITLE };
    try {
      await actionApi.setBadgeText({ tabId, text });
      await actionApi.setTitle({ tabId, title });
      if (text) {
        await actionApi.setBadgeBackgroundColor({
          tabId,
          color: BADGE_BACKGROUND,
        });
        // Chrome 110+ and Firefox only; white-on-green fails contrast at badge size.
        if (typeof actionApi.setBadgeTextColor === "function") {
          await actionApi.setBadgeTextColor({ tabId, color: BADGE_TEXT_COLOR });
        }
      }
    } catch {
      // Tab closed mid-update.
    }
  };

  /**
   * Toggling redirects or editing rules in the popup has to repaint tabs that
   * are already open, otherwise a badge lingers on a rule the user just
   * silenced.
   */
  const refreshAllBadges = async () => {
    for (const tab of await browser.tabs.query({})) {
      if (tab.id !== undefined) {
        await updateBadge(tab.id, tab.url);
      }
    }
  };

  const executeScript = (tabId: number, options: ExecuteScriptOptions) => {
    if (isMv3) {
      return chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [options.file],
        world: options.world,
      });
    } else {
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

  browser.storage.onChanged.addListener(async (changes) => {
    if (changes.origins && typeof changes.origins.newValue === "string") {
      const newOrigins: string[] = JSON.parse(changes.origins.newValue);
      const oldOrigins = origins;
      origins = newOrigins;

      // Find newly added origins
      const addedOrigins = newOrigins.filter((o) => !oldOrigins.includes(o));

      if (addedOrigins.length > 0) {
        // Query tabs matching the new origins and inject content scripts
        const urlPatterns = addedOrigins.map((o) => `${o}/*`);
        const tabs = await browser.tabs.query({ url: urlPatterns });
        for (const tab of tabs) {
          if (tab.status !== "loading") {
            injectContentScript(tab);
          }
        }
      }
    }
    let redirectsChanged = false;
    if (changes.redirectRules && typeof changes.redirectRules.newValue === "string") {
      redirectRules = JSON.parse(changes.redirectRules.newValue);
      redirectsChanged = true;
    }
    if (changes.redirectPreferences && typeof changes.redirectPreferences.newValue === "string") {
      redirectPreferences = JSON.parse(changes.redirectPreferences.newValue);
      redirectsChanged = true;
    }
    if (redirectsChanged) {
      await refreshAllBadges();
    }
    if (
      changes[CREDENTIAL_HOSTS_KEY] &&
      typeof changes[CREDENTIAL_HOSTS_KEY].newValue === "string"
    ) {
      credentialHosts = JSON.parse(changes[CREDENTIAL_HOSTS_KEY].newValue);
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

  browser.tabs.onUpdated.addListener(async (tabId, _info, tab) => {
    if (tab.status !== "loading" && tab.url) {
      const url = new URL(tab.url);
      if (origins.includes(url.origin)) {
        injectContentScript(tab);
      }

      // Redirect offers surface on the toolbar icon, so pages the user visits
      // need no script injected into them.
      await updateBadge(tabId, tab.url);
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

  /**
   * Convert a base64 data URL to a Blob
   */
  const base64ToBlob = async (base64: string): Promise<Blob> => {
    const response = await fetch(base64);
    return await response.blob();
  };

  const handleRequest = async (
    input: string,
    init?: SerializableRequestInit,
    options?: NetworkRequestOptions,
    requester = "an InfoGata app"
  ): Promise<HandleRequestResponse> => {
    const newInit: RequestInit = {};

    // Copy over serializable properties
    if (init) {
      if (init.headers) newInit.headers = init.headers;
      if (init.mode) newInit.mode = init.mode;
      if (init.method) newInit.method = init.method;
      if (init.credentials) newInit.credentials = init.credentials;

      // Decode base64 body if needed
      if (init.bodyIsBase64 && typeof init.body === "string") {
        newInit.body = await base64ToBlob(init.body);
      } else if (init.body) {
        newInit.body = init.body;
      }
    }

    // Credentials (cookies) are stripped unless the user has allowed this exact
    // host. A plugin nominates a host through its siteMatch patterns or its
    // login domains; the user grants it. Anything else is sent anonymously, so
    // the plugin still gets its response, just not the user's session.
    newInit.credentials = "omit";
    const candidateHost = credentialHostFor(input, options);
    if (candidateHost) {
      const allowed = await ensureCredentialConsent(
        [candidateHost],
        requester,
        "request"
      );
      if (allowed) {
        newInit.credentials = "include";
      } else {
        console.warn(
          `[InfoGata] Sending an anonymous request to ${candidateHost}: not allowed to use your login.`
        );
      }
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

  /**
   * Tears down whatever the last login left registered.
   *
   * `onBeforeSendHeaders` listeners used to be added per login and never
   * removed, so every sign-in left another header-inspecting callback attached
   * for the life of the worker. There is also only one `loginTab`, so a second
   * login would silently overwrite the first one's state.
   */
  let endLogin: () => void = () => {};

  const describeLoginCapture = (auth: ManifestAuthentication): string => {
    const parts: string[] = [];
    if (auth.cookiesToFind?.length) {
      parts.push(`cookies (${auth.cookiesToFind.join(", ")})`);
    }
    const headers = [
      ...(auth.headersToFind ?? []),
      ...Object.values(auth.domainHeadersToFind ?? {}).flat(),
    ];
    if (headers.length) {
      parts.push(`request headers (${[...new Set(headers)].join(", ")})`);
    }
    return parts.length ? `It will capture: ${parts.join(" and ")}.` : "";
  };

  const openWindow = async (
    auth: ManifestAuthentication,
    pluginId: string,
    senderTab: Browser.tabs.Tab,
    requester = "an InfoGata app"
  ) => {
    const loginHost = auth.loginUrl ? hostFromUrl(auth.loginUrl) : undefined;
    if (!loginHost) {
      console.warn(
        "[InfoGata] Refusing a login window for a non-http(s) URL:",
        auth.loginUrl
      );
      return;
    }

    // Every domain whose headers would be captured has to be named in the
    // prompt, not just the one the window navigates to -- `domainHeadersToFind`
    // can reach sites the user never sees during the login.
    const captureHosts = [
      loginHost,
      ...Object.keys(auth.domainHeadersToFind ?? {})
        .map((d) => normalizeHost(d.replace(/^\./, "")))
        .filter((h): h is string => !!h),
    ];
    const hosts = [...new Set(captureHosts)];

    const allowed = await ensureCredentialConsent(
      hosts,
      requester,
      "login",
      describeLoginCapture(auth)
    );
    if (!allowed) {
      console.warn(
        `[InfoGata] Login for plugin ${pluginId} was not allowed for: ${hosts.join(", ")}`
      );
      return;
    }

    // A previous login's listener and state go before this one replaces them.
    endLogin();

    const win = await browser.windows.create({
      url: auth.loginUrl,
    });
    if (!win || !win.tabs) {
      return;
    }
    const tab = win.tabs[0];
    if (!tab) {
      return;
    }
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
            .map((c): [string, string] => [c[0] ?? "", c[1] ?? ""])
        );
        loginTab.foundCookies = auth.cookiesToFind.every((c) => cookieMap.has(c));
      }

      if (auth.domainHeadersToFind && !loginTab.foundDomainHeaders) {
        const domainToSearch = Object.keys(auth.domainHeadersToFind).find((d) =>
          urlHost.endsWith(d)
        );
        if (domainToSearch && !loginTab.domainHeaders[domainToSearch]) {
          const domainHeaders = auth.domainHeadersToFind[domainToSearch] ?? [];
          const foundDomainHeaders = domainHeaders.every((dh) =>
            headerMap.has(dh)
          );
          if (foundDomainHeaders) {
            const collected: Record<string, string> = {};
            for (const header of domainHeaders) {
              collected[header] = headerMap.get(header)!;
            }
            loginTab.domainHeaders[domainToSearch] = collected;
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
        endLogin();
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
    if (isMv3) {
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

    const loginWindowId = win.id;
    const onLoginWindowRemoved = (windowId: number) => {
      if (windowId === loginWindowId) endLogin();
    };
    browser.windows.onRemoved.addListener(onLoginWindowRemoved);

    endLogin = () => {
      endLogin = () => {};
      browser.webRequest.onBeforeSendHeaders.removeListener(
        onBeforeSendHeadersCallback
      );
      browser.windows.onRemoved.removeListener(onLoginWindowRemoved);
      loginTab = undefined;
    };
  };

  /**
   * The page a message actually came from. `sender.url` is the sending frame,
   * which is the right anchor to bind a registration to; `sender.tab.url` is
   * only a fallback for browsers that omit it.
   */
  const senderOrigin = (sender: Browser.runtime.MessageSender): string | undefined => {
    const url = sender.url ?? sender.tab?.url;
    if (!url) return undefined;
    try {
      const origin = new URL(url).origin;
      return origin === "null" ? undefined : origin;
    } catch {
      return undefined;
    }
  };

  browser.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
    if (message.type === "network-request") {
      const requester = senderOrigin(sender) ?? "an InfoGata app";
      ready
        .then(() =>
          handleRequest(message.input, message.init, message.options, requester)
        )
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          // Answering with null used to strand the caller: the content script
          // would throw reading the response, so nothing was ever posted back
          // to the page and its promise never settled.
          console.error("InfoGata network request failed:", message.input, error);
          sendResponse({
            error: {
              message: String(error?.message ?? error ?? "Request failed"),
              name: error?.name,
            },
          });
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
      case "open-login": {
        const tab = sender.tab;
        if (tab) {
          const requester = senderOrigin(sender) ?? "an InfoGata app";
          ready.then(() =>
            openWindow(message.auth, message.pluginId, tab, requester)
          );
        }
        break;
      }
      case "register-redirects": {
        // Rules are bound to the origin that sent them. Otherwise any authorized
        // site could register a rule wearing AudioGata's name and pointing
        // wherever it liked, and the popup would offer it as the real thing.
        const appOrigin = senderOrigin(sender);
        if (!appOrigin || !isValidAppOrigin(appOrigin)) break;

        const incoming = message.rules
          .filter((rule) => rule && typeof rule.pluginId === "string")
          .slice(0, MAX_REDIRECT_RULES_PER_ORIGIN)
          .map((rule) => ({ ...rule, appOrigin }));
        if (incoming.length < message.rules.length) {
          console.warn(
            `[InfoGata] ${appOrigin} registered more than ${MAX_REDIRECT_RULES_PER_ORIGIN} redirect rules; the rest were dropped.`
          );
        }

        redirectRules = [
          ...redirectRules.filter((r) => r.appOrigin !== appOrigin),
          ...incoming,
        ];
        saveRedirectRules();
        refreshAllBadges();
        break;
      }
      case "dismiss-redirect":
        if (!redirectPreferences.dismissedRuleKeys.includes(message.ruleKey)) {
          redirectPreferences.dismissedRuleKeys.push(message.ruleKey);
          saveRedirectPreferences();
        }
        break;
      case "get-redirect-rules":
        sendResponse({ rules: redirectRules, preferences: redirectPreferences });
        return true;
      case "set-redirect-enabled":
        redirectPreferences.globalEnabled = message.enabled;
        saveRedirectPreferences();
        break;
      case "undismiss-redirect":
        redirectPreferences.dismissedRuleKeys =
          redirectPreferences.dismissedRuleKeys.filter(
            (k) => k !== message.ruleKey
          );
        saveRedirectPreferences();
        break;
      case "delete-redirect": {
        const removedRule = redirectRules.find(
          (rule) => getRuleKey(rule) === message.ruleKey
        );
        redirectRules = redirectRules.filter(
          (rule) => getRuleKey(rule) !== message.ruleKey
        );
        saveRedirectRules();
        let prefsChanged = false;
        // Drop any dismissed-preference entry for the removed rule
        if (redirectPreferences.dismissedRuleKeys.includes(message.ruleKey)) {
          redirectPreferences.dismissedRuleKeys =
            redirectPreferences.dismissedRuleKeys.filter(
              (k) => k !== message.ruleKey
            );
          prefsChanged = true;
        }
        // Drop the default-origin entry if the removed rule was the default
        if (
          removedRule &&
          redirectPreferences.defaultOrigins?.[removedRule.pluginId] ===
            removedRule.appOrigin
        ) {
          const { [removedRule.pluginId]: _removed, ...rest } =
            redirectPreferences.defaultOrigins;
          redirectPreferences.defaultOrigins = rest;
          prefsChanged = true;
        }
        if (prefsChanged) {
          saveRedirectPreferences();
        }
        break;
      }
      case "set-default-redirect-origin":
        redirectPreferences.defaultOrigins = {
          ...(redirectPreferences.defaultOrigins ?? {}),
          [message.pluginId]: message.appOrigin,
        };
        saveRedirectPreferences();
        break;
      case "consent-decision": {
        // Only the extension's own consent page may answer a prompt. It runs in
        // a popup window, so it has a `sender.tab` like any page -- the URL is
        // what distinguishes it from a web page that guessed a pending id.
        const getURL = browser.runtime.getURL as (path: string) => string;
        if (
          sender.id !== browser.runtime.id ||
          !sender.url?.startsWith(getURL("/consent.html"))
        ) {
          break;
        }
        const pending = pendingConsents.get(message.id);
        if (!pending) break;
        pendingConsents.delete(message.id);
        recordConsent(pending.hosts, pending.requester, message.allowed).then(
          () => pending.resolve(message.allowed)
        );
        break;
      }
      case "get-credential-hosts":
        ready.then(() => sendResponse({ hosts: credentialHosts }));
        return true;
      case "revoke-credential-host":
        ready.then(async () => {
          const { [message.host]: _removed, ...rest } = credentialHosts;
          credentialHosts = rest;
          await storeCredentialHosts(credentialHosts);
        });
        break;
    }
  });

  // Remove origin header if it's coming from this extension when making
  // requests to youtube
  if (!isMv3) {
    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        for (let i = 0; i < details.requestHeaders!.length; i++) {
          const header = details.requestHeaders![i];
          if (
            header?.name === "Origin" &&
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

  // Badges are painted after the stored rules land, so a browser restart or a
  // service worker wake-up repaints tabs that were already open.
  ready.then(refreshAllBadges);
});
