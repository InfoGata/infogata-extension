import {
  PO_MINTER_GLOBAL,
  PO_TOKEN_MINTER_MARKER,
  PO_TOKEN_PROVIDERS,
  type PoTokenMintConfig,
  type PoTokenProvider,
} from "./po-token-providers";
import { isMv3 } from "./manifest-version";
import { runPageScriptMv2 } from "./page-script";
import type { TabMessage } from "./types";

/**
 * Mints proof-of-origin tokens in a hidden provider frame inside the app's tab.
 *
 * Unlike page-context, which parks a pinned tab because its sites refuse to be
 * framed, this frames the provider: a music app asks for a token on nearly
 * every track, and a tab that never goes away is the wrong trade. Framing needs
 * the provider's X-Frame-Options and CSP lifted, which is done for the marked
 * minter url only, only when an authorized app is the one framing it, and only
 * while some tab has a minter frame.
 *
 * Each step has an MV3 and an MV2 form: Chrome uses a session rule and the
 * `scripting` API, Firefox blocking webRequest listeners and a <script> element.
 */

/** A frame is cheap to keep while tracks play and pointless once they stop. */
const IDLE_REMOVE_MS = 10 * 60_000;

/** The first mint waits on the provider's page and BotGuard; later ones are instant. */
const MINT_TIMEOUT_MS = 45_000;

/** How long the minter frame has to announce itself on MV2. */
const ANNOUNCE_TIMEOUT_MS = 5_000;

/** Session rule ids share one space with nothing else in this extension. */
const FRAME_RULE_ID_BASE = 9001;


const providers = Object.entries(PO_TOKEN_PROVIDERS);

const isMinterUrl = (href: string, origin: string) => {
  try {
    const url = new URL(href);
    return url.origin === origin && url.searchParams.has(PO_TOKEN_MINTER_MARKER);
  } catch {
    return false;
  }
};

//#region Framing access

/** App origins the MV2 listeners let frame a minter; kept current on every mint. */
let mv2AppOrigins: string[] = [];

type FrameRequestDetails = {
  frameAncestors?: { url: string }[];
  documentUrl?: string;
  requestHeaders?: { name: string; value?: string }[];
  responseHeaders?: { name: string; value?: string }[];
};

/** Whether the document framing this request is an authorized app. */
const framedByApp = (details: FrameRequestDetails) => {
  const parent = details.frameAncestors?.[0]?.url ?? details.documentUrl;
  if (!parent) return false;
  try {
    return mv2AppOrigins.includes(new URL(parent).origin);
  } catch {
    return false;
  }
};

const stripCookie = (details: FrameRequestDetails) =>
  framedByApp(details)
    ? { requestHeaders: details.requestHeaders?.filter((h) => h.name.toLowerCase() !== "cookie") }
    : {};

const stripFrameBlockers = (details: FrameRequestDetails) =>
  framedByApp(details)
    ? {
        responseHeaders: details.responseHeaders?.filter(
          (h) => !/^(x-frame-options|content-security-policy|set-cookie)$/i.test(h.name)
        ),
      }
    : {};

/** Match patterns for every provider's minter url. */
const minterUrlPatterns = () =>
  providers.map(([, provider]) => {
    const url = new URL(provider.frameUrl);
    return `${url.origin}${url.pathname}?${PO_TOKEN_MINTER_MARKER}=*`;
  });

/**
 * Lets the marked minter urls be framed by the app origins, and loads them
 * without the user's cookies and without letting them set any. Rewritten on every mint so it follows the
 * authorized origins list without a listener of its own.
 */
const allowFraming = async (appOrigins: string[]) => {
  if (isMv3) {
    const initiatorDomains = [
      ...new Set(appOrigins.map((origin) => new URL(origin).hostname)),
    ];
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: providers.map((_, i) => FRAME_RULE_ID_BASE + i),
      addRules: providers.map(([, provider], i) => {
        const url = new URL(provider.frameUrl);
        return {
          id: FRAME_RULE_ID_BASE + i,
          action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            requestHeaders: [
              { header: "cookie", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
            ],
            responseHeaders: [
              { header: "x-frame-options", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
              { header: "content-security-policy", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
              { header: "set-cookie", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
            ],
          },
          condition: {
            urlFilter: `|${url.origin}${url.pathname}?${PO_TOKEN_MINTER_MARKER}=`,
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.SUB_FRAME],
            initiatorDomains,
          },
        };
      }),
    });
    return;
  }

  mv2AppOrigins = appOrigins;
  const filter = { urls: minterUrlPatterns(), types: ["sub_frame" as const] };
  if (!browser.webRequest.onBeforeSendHeaders.hasListener(stripCookie as never)) {
    browser.webRequest.onBeforeSendHeaders.addListener(stripCookie as never, filter, [
      "blocking",
      "requestHeaders",
    ]);
  }
  if (!browser.webRequest.onHeadersReceived.hasListener(stripFrameBlockers as never)) {
    browser.webRequest.onHeadersReceived.addListener(stripFrameBlockers as never, filter, [
      "blocking",
      "responseHeaders",
    ]);
  }
};

/** Puts the providers' framing protections back once no tab has a minter frame. */
const revokeFraming = async () => {
  if (isMv3) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: providers.map((_, i) => FRAME_RULE_ID_BASE + i),
    });
    return;
  }
  browser.webRequest.onBeforeSendHeaders.removeListener(stripCookie as never);
  browser.webRequest.onHeadersReceived.removeListener(stripFrameBlockers as never);
  mv2AppOrigins = [];
};

//#endregion

//#region Anonymity

/**
 * The frame is loaded without cookies, but the provider's own page then makes
 * requests of its own. Left alone, those would carry the user's session for the
 * provider wherever the browser still sends third-party cookies (Chrome), and
 * would let the provider's scripts act on that account and rewrite its cookies
 * from a frame the user never sees. So every request a provider page makes in a
 * tab with a minter frame goes out without cookies and cannot set any.
 *
 * Firefox's Total Cookie Protection already gives the frame its own jar; it gets
 * the same treatment anyway, so both browsers behave alike.
 */

const ANONYMITY_RULE_ID = 9100;

const providerOrigins = providers.map(([origin]) => origin);

/** Whether a request's document is a provider page in a tab with a minter frame. */
const fromMinterFrame = (details: { tabId: number; documentUrl?: string }) => {
  if (!framedTabs.has(details.tabId) || !details.documentUrl) return false;
  try {
    return providerOrigins.includes(new URL(details.documentUrl).origin);
  } catch {
    return false;
  }
};

const stripFrameCookie = (details: FrameRequestDetails & { tabId: number }) =>
  fromMinterFrame(details)
    ? { requestHeaders: details.requestHeaders?.filter((h) => h.name.toLowerCase() !== "cookie") }
    : {};

const stripFrameSetCookie = (details: FrameRequestDetails & { tabId: number }) =>
  fromMinterFrame(details)
    ? { responseHeaders: details.responseHeaders?.filter((h) => h.name.toLowerCase() !== "set-cookie") }
    : {};

/** Brings the cookie stripping in line with which tabs currently have a frame. */
const updateAnonymity = async () => {
  if (isMv3) {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ANONYMITY_RULE_ID],
      addRules: framedTabs.size
        ? [
            {
              id: ANONYMITY_RULE_ID,
              action: {
                type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
                requestHeaders: [
                  { header: "cookie", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                ],
                responseHeaders: [
                  { header: "set-cookie", operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                ],
              },
              condition: {
                // Requests the provider's page starts, wherever they go; the
                // app's own requests and the plugin's (made from the
                // background) have other initiators and are untouched.
                initiatorDomains: providerOrigins.map((origin) => new URL(origin).hostname),
                tabIds: [...framedTabs.keys()],
              },
            },
          ]
        : [],
    });
    return;
  }

  const filter = { urls: ["<all_urls>"] };
  if (framedTabs.size) {
    if (!browser.webRequest.onBeforeSendHeaders.hasListener(stripFrameCookie as never)) {
      browser.webRequest.onBeforeSendHeaders.addListener(stripFrameCookie as never, filter, [
        "blocking",
        "requestHeaders",
      ]);
    }
    if (!browser.webRequest.onHeadersReceived.hasListener(stripFrameSetCookie as never)) {
      browser.webRequest.onHeadersReceived.addListener(stripFrameSetCookie as never, filter, [
        "blocking",
        "responseHeaders",
      ]);
    }
  } else {
    browser.webRequest.onBeforeSendHeaders.removeListener(stripFrameCookie as never);
    browser.webRequest.onHeadersReceived.removeListener(stripFrameSetCookie as never);
  }
};

//#endregion

//#region Finding the frame

/** MV2 frames waiting to be found, by tab: the origin looked for and who to tell. */
const announceWaiters = new Map<number, { origin: string; resolve: (frameId: number) => void }>();

/**
 * Called by the background for a "po-minter-frame" message. Only the snippet
 * `findMinterFrame` injects sends it, and a web page cannot reach
 * `runtime.sendMessage`, so the sender's frame is trusted to be ours; its url is
 * still checked, in case the frame navigated.
 */
export const onMinterFrameAnnounced = (sender: Browser.runtime.MessageSender) => {
  const tabId = sender.tab?.id;
  if (sender.id !== browser.runtime.id || tabId === undefined || sender.frameId === undefined) {
    return;
  }
  const waiter = announceWaiters.get(tabId);
  if (waiter && sender.url && isMinterUrl(sender.url, waiter.origin)) {
    announceWaiters.delete(tabId);
    waiter.resolve(sender.frameId);
  }
};

/** The minter frame's id in the tab, if it is there. Frame ids are not stable across reloads. */
const findMinterFrame = async (tabId: number, origin: string): Promise<number | undefined> => {
  if (isMv3) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => location.href,
    });
    return results.find(
      (r) => typeof r.result === "string" && isMinterUrl(r.result, origin)
    )?.frameId;
  }

  // MV2's executeScript does not say which frame a result came from, so the
  // minter frame also reports itself, and the message's sender carries the
  // frame id. Each frame's result says whether it is the one, so when none is
  // there is no announcement to wait for.
  return await new Promise<number | undefined>((resolve) => {
    const settle = (frameId: number | undefined) => {
      clearTimeout(timer);
      announceWaiters.delete(tabId);
      resolve(frameId);
    };
    const timer = setTimeout(() => settle(undefined), ANNOUNCE_TIMEOUT_MS);
    announceWaiters.set(tabId, { origin, resolve: settle });
    browser.tabs
      .executeScript(tabId, {
        allFrames: true,
        code: `(function () {
          try {
            var url = new URL(location.href);
            if (url.origin === ${JSON.stringify(origin)} && url.searchParams.has(${JSON.stringify(PO_TOKEN_MINTER_MARKER)})) {
              browser.runtime.sendMessage({ type: "po-minter-frame" });
              return true;
            }
          } catch (e) {}
          return false;
        })();`,
      })
      .then((results) => {
        if (!results?.some((isMinter) => isMinter === true)) settle(undefined);
      })
      .catch(() => {
        // A frame the extension cannot script; the minter frame still announces.
      });
  });
};

const sendToTab = (tabId: number, message: TabMessage) =>
  browser.tabs.sendMessage(tabId, message);

const ensureFrame = async (tabId: number, provider: PoTokenProvider, origin: string) => {
  const existing = await findMinterFrame(tabId, origin);
  if (existing !== undefined) return existing;

  const loaded = await sendToTab(tabId, { type: "create-po-frame", url: provider.frameUrl });
  if (!loaded) throw new Error("The minter frame did not load");
  const frameId = await findMinterFrame(tabId, origin);
  if (frameId === undefined) throw new Error("The minter frame is not reachable");
  return frameId;
};

//#endregion

//#region Running the minter

type MintOutcome = { token: string } | { error: string };

/**
 * Injected, so it closes over nothing. The minter's rejection would otherwise
 * be swallowed by executeScript, which reports only resolved values.
 */
const callMinter = async (
  globalName: string,
  config: PoTokenMintConfig,
  contentBinding: string
): Promise<MintOutcome> => {
  const api = (window as unknown as Record<string, { mint: (c: PoTokenMintConfig, b: string) => Promise<string> }>)[globalName];
  if (!api) return { error: "The minter script is not loaded" };
  try {
    return { token: await api.mint(config, contentBinding) };
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e) };
  }
};

/** po-minter.js's source, for MV2, which can only hand the page source text. */
let minterSource: Promise<string> | undefined;

const loadMinterSource = () => {
  minterSource ??= fetch(browser.runtime.getURL("/po-minter.js"))
    .then((response) => response.text())
    .catch((error) => {
      minterSource = undefined;
      throw error;
    });
  return minterSource;
};

const runMinter = async (
  tabId: number,
  frameId: number,
  config: PoTokenMintConfig,
  contentBinding: string
): Promise<MintOutcome | undefined> => {
  if (isMv3) {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      files: ["po-minter.js"],
    });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      func: callMinter,
      args: [PO_MINTER_GLOBAL, config, contentBinding],
    });
    return result?.result as MintOutcome | undefined;
  }

  // The frame's CSP was removed with its framing headers, so the inline script
  // this writes is allowed. po-minter.js installs its API once and ignores
  // being run again.
  return await runPageScriptMv2<MintOutcome>(tabId, {
    frameId,
    prelude: await loadMinterSource(),
    expression: `(${callMinter.toString()})(${JSON.stringify(PO_MINTER_GLOBAL)}, ${JSON.stringify(config)}, ${JSON.stringify(contentBinding)})`,
    timeoutMs: MINT_TIMEOUT_MS,
  });
};

//#endregion

/**
 * Tabs with a minter frame, and the app origin each frame lives under, so
 * framing access ends with the last one and a tab is only forgotten when it
 * leaves that origin: the app routes within itself without losing the frame.
 */
const framedTabs = new Map<number, string>();
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Stops treating the tab as having a frame, and drops access nothing needs any more. */
const forgetTab = async (tabId: number) => {
  clearTimeout(idleTimers.get(tabId));
  idleTimers.delete(tabId);
  if (!framedTabs.delete(tabId)) return;
  await updateAnonymity();
  if (framedTabs.size === 0) await revokeFraming();
};

const removeFrame = async (tabId: number) => {
  await sendToTab(tabId, { type: "remove-po-frame" }).catch(() => {
    // The tab is gone, and the frame with it.
  });
  await forgetTab(tabId);
};

const scheduleIdleRemove = (tabId: number) => {
  clearTimeout(idleTimers.get(tabId));
  idleTimers.set(
    tabId,
    setTimeout(() => void removeFrame(tabId), IDLE_REMOVE_MS)
  );
};

/** A closed tab took its frame with it; its access goes too. */
export const onMinterTabRemoved = (tabId: number) => {
  void forgetTab(tabId);
};

/**
 * A tab that left the app's origin lost its frame with the document that held
 * it. Its access goes too: otherwise a tab that went on to the provider's own
 * site would have that site's cookies stripped.
 */
export const onMinterTabNavigated = (tabId: number, url: string) => {
  const appOrigin = framedTabs.get(tabId);
  if (appOrigin === undefined) return;
  let origin: string | undefined;
  try {
    origin = new URL(url).origin;
  } catch {
    origin = undefined;
  }
  if (origin !== appOrigin) void forgetTab(tabId);
};

/** One mint at a time per tab, so two tracks starting together share one frame. */
const queues = new Map<number, Promise<unknown>>();

export const mintPoToken = (
  tabId: number,
  appOrigin: string,
  appOrigins: string[],
  provider: PoTokenProvider,
  config: PoTokenMintConfig,
  contentBinding: string
): Promise<string> => {
  const run = async () => {
    framedTabs.set(tabId, appOrigin);
    scheduleIdleRemove(tabId);
    // Before the frame exists, so none of its requests go out with cookies.
    await updateAnonymity();
    await allowFraming(appOrigins);
    const frameId = await ensureFrame(tabId, provider, config.origin);
    const outcome = await runMinter(tabId, frameId, config, contentBinding);
    scheduleIdleRemove(tabId);
    if (!outcome) throw new Error("No answer from the minter frame");
    if ("error" in outcome) throw new Error(outcome.error);
    return outcome.token;
  };

  const next = (queues.get(tabId) ?? Promise.resolve()).then(run, run);
  queues.set(tabId, next.catch(() => undefined));
  return next;
};
