import { urlMatchesPattern } from "./redirect-utils";
import { credentialPatternHost, hostFromUrl } from "./credential-hosts";
import type { NetworkRequestOptions } from "./types";

/**
 * Requests a site will only answer when they come from one of its own pages.
 *
 * Some sites decide on where a request came from rather than on what it carries.
 * twstalker.com is the case that forced this: its Cloudflare rule keys on
 * `Sec-Fetch-Site`, so a fetch from this worker arrives as `none` and is
 * challenged, while the same fetch from a page on twstalker.com arrives as
 * `same-origin` and is served. `Sec-Fetch-*` is browser-controlled, and forcing
 * it (verified in Electron, where header rewriting is unrestricted) does deliver
 * the header but does not satisfy Cloudflare — it validates the real context.
 *
 * So the request has to genuinely come from a page on that site. A background
 * tab is parked on the origin and the fetch runs inside it.
 */

/** Managed challenges clear themselves; the tab just needs a moment. */
const CHALLENGE_TIMEOUT_MS = 90_000;
const CHALLENGE_POLL_MS = 1_000;
/** The page script has its own budget; a probe must never wait this long. */
const PAGE_SCRIPT_TIMEOUT_MS = 20_000;
const LOAD_TIMEOUT_MS = 30_000;

/** A parked tab is cheap to keep but not free; drop it once it goes unused. */
const IDLE_CLOSE_MS = 5 * 60_000;

export type PageContextResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

/**
 * Which host, if any, this request is asking to borrow a page on.
 *
 * Same shape as `credentialHostFor`: the patterns come from the page, so they
 * are a nomination and nothing more. A pattern has to name a real site and the
 * url has to be on it, otherwise a plugin could pass a bare wildcard and get a
 * script running on any origin it liked.
 */
export const pageContextHostFor = (
  input: string,
  options?: NetworkRequestOptions
): string | undefined => {
  const host = hostFromUrl(input);
  if (!host) return undefined;

  for (const pattern of options?.pageContextPatterns ?? []) {
    const patternHost = credentialPatternHost(pattern);
    if (
      patternHost &&
      patternHost === host &&
      urlMatchesPattern(input, pattern)
    ) {
      return host;
    }
  }
  return undefined;
};

/**
 * Injected functions are serialized by `executeScript`, so they close over
 * nothing and take everything as arguments. They also cannot be built with
 * `new Function`: the worker's CSP forbids it.
 */
const probeChallenge = (): boolean => {
  const title = document.title || "";
  if (/^Just a moment|Attention Required|Verifying your browser/i.test(title)) {
    return true;
  }
  if (document.getElementById("challenge-error-text")) return true;
  if (document.getElementById("cf-challenge-running")) return true;
  return typeof (window as unknown as { _cf_chl_opt?: unknown })._cf_chl_opt !==
    "undefined";
};

const runFetch = async (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
) => {
  try {
    const response = await fetch(url, { ...init, credentials: "include" });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  } catch (e) {
    return { error: String(e && (e as Error).message ? (e as Error).message : e) };
  }
};

const waitForTabLoad = (tabId: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out loading the page-context tab"));
    }, LOAD_TIMEOUT_MS);

    const listener = (updatedTabId: number, info: { status?: string }) => {
      if (updatedTabId !== tabId || info.status !== "complete") return;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    browser.tabs.onUpdated.addListener(listener);
  });

const isMv3 = import.meta.env.MANIFEST_VERSION === 3;

/**
 * Runs a function in the page's own context.
 *
 * MV3 injects the function directly. Firefox's MV2 has no `scripting` API and no
 * MAIN world, so the function is serialized into a `code` string and reaches the
 * page through `wrappedJSObject` -- a content script's own `fetch` runs under the
 * extension principal, which is not the same-origin request this exists to make.
 */
const runInPage = async <T>(
  tabId: number,
  func: (...args: never[]) => T | Promise<T>,
  args: unknown[] = []
): Promise<T | undefined> => {
  if (isMv3) {
    // The scripting types pin `args` to the function's own parameter tuple,
    // which this helper is deliberately generic over.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func,
      args,
    } as unknown as Parameters<typeof chrome.scripting.executeScript>[0]);
    return results[0]?.result as T | undefined;
  }

  // Firefox MV2 has no MAIN world. Injecting into the content script is not
  // enough: `fetch` there resolves lexically to the sandbox's own global, so the
  // request goes out under the extension principal rather than as the page --
  // which is the whole thing this transport exists to avoid. So the function is
  // written into a real <script> element, which does run as the page, and the
  // result comes back through postMessage. The site serves no CSP on its real
  // pages, so an inline script is allowed.
  const id = `pc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pageScript =
    `Promise.resolve((${func.toString()}).apply(null, ${JSON.stringify(args)}))` +
    `.then(function (r) { window.postMessage({ __pageContextId: ${JSON.stringify(id)}, result: r }, "*"); })` +
    `.catch(function (e) { window.postMessage({ __pageContextId: ${JSON.stringify(id)},` +
    ` result: { error: String(e && e.message ? e.message : e) } }, "*"); });`;

  const code = `(function () {
    return new Promise(function (resolve) {
      var settle = function (value) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(value);
      };
      var timer = setTimeout(function () { settle(undefined); }, ${PAGE_SCRIPT_TIMEOUT_MS});
      var onMessage = function (event) {
        if (event.source !== window) return;
        if (!event.data || event.data.__pageContextId !== ${JSON.stringify(id)}) return;
        settle(event.data.result);
      };
      window.addEventListener("message", onMessage);
      var script = document.createElement("script");
      script.textContent = ${JSON.stringify(pageScript)};
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    });
  })()`;

  const results = (await browser.tabs.executeScript(tabId, { code })) as
    | (T | undefined)[]
    | undefined;
  return results?.[0];
};

/**
 * Runs a function in the tab's *isolated* content-script context.
 *
 * The bot check's own page ships a strict CSP (`default-src 'none'`), which
 * blocks the injected <script> element that `runInPage` relies on. The content
 * script is not subject to the page's CSP and can still read the DOM, which is
 * all the challenge probe needs — only the fetch has to be the page itself.
 */
const runInIsolated = async <T>(
  tabId: number,
  func: () => T
): Promise<T | undefined> => {
  if (isMv3) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
    } as unknown as Parameters<typeof chrome.scripting.executeScript>[0]);
    return results[0]?.result as T | undefined;
  }
  const results = (await browser.tabs.executeScript(tabId, {
    code: `(${func.toString()})()`,
  })) as (T | undefined)[] | undefined;
  return results?.[0];
};

const waitForChallenge = async (
  tabId: number,
  origin: string
): Promise<void> => {
  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let challenged: boolean;
    try {
      // `undefined` means the probe could not answer, which is not the same as
      // "cleared". Reading it as cleared sent the fetch straight into the check.
      challenged = (await runInIsolated<boolean>(tabId, probeChallenge)) !== false;
    } catch {
      // Navigating mid-probe throws; the next poll sees the new document.
      challenged = true;
    }
    if (!challenged) return;
    await new Promise((resolve) => setTimeout(resolve, CHALLENGE_POLL_MS));
  }

  // Fetching now would just scrape the interstitial. Some checks want a click,
  // and the tab is pinned and in the background, so say where it is.
  throw new Error(
    `${origin} is still showing a verification check. Open the pinned ` +
      `"Loading for InfoGata" tab and complete it, then try again.`
  );
};

/** Origin -> the tab parked on it. */
const parkedTabs = new Map<string, number>();

const tabIsUsable = async (tabId: number, origin: string): Promise<boolean> => {
  try {
    const tab = await browser.tabs.get(tabId);
    return !!tab.url?.startsWith(origin) && !tab.discarded;
  } catch {
    return false;
  }
};

const ensureTab = async (origin: string): Promise<number> => {
  const existing = parkedTabs.get(origin);
  if (existing !== undefined && (await tabIsUsable(existing, origin))) {
    return existing;
  }

  // Reuse a tab the user already has open on the site before making one.
  const open = await browser.tabs.query({ url: `${origin}/*` });
  const reusable = open.find((tab) => tab.id !== undefined && !tab.discarded);
  if (reusable?.id !== undefined) {
    parkedTabs.set(origin, reusable.id);
    return reusable.id;
  }

  // Inactive so it never takes focus -- the bot check completes in a background
  // tab -- and pinned, so it sits at the far left as a favicon rather than a
  // full tab the user did not open. A browser extension cannot create an
  // invisible tab, and the site refuses to be framed, so some surface is
  // unavoidable here; the desktop and mobile builds have none.
  const tab = await browser.tabs.create({
    url: origin,
    active: false,
    pinned: true,
  });
  if (tab.id === undefined) {
    throw new Error("Could not open a page-context tab");
  }
  parkedTabs.set(origin, tab.id);
  await waitForTabLoad(tab.id);
  await waitForChallenge(tab.id, origin);
  await labelTab(tab.id);
  return tab.id;
};

/**
 * Retitles the parked tab. A tab the user did not open, showing a site they may
 * not recognise, is the confusing part -- saying who opened it and why costs one
 * injection and makes it legible.
 */
const labelTab = async (tabId: number) => {
  try {
    await runInPage(tabId, () => {
      document.title = "Loading for InfoGata";
    });
  } catch {
    // Cosmetic only; a failure here must not fail the request.
  }
};

/** Origin -> timer that closes its parked tab once requests stop. */
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

const scheduleIdleClose = (origin: string) => {
  const existing = idleTimers.get(origin);
  if (existing) clearTimeout(existing);
  idleTimers.set(
    origin,
    setTimeout(() => {
      idleTimers.delete(origin);
      void closePageContext(origin);
    }, IDLE_CLOSE_MS)
  );
};

export const closePageContext = async (origin: string) => {
  const tabId = parkedTabs.get(origin);
  parkedTabs.delete(origin);
  if (tabId === undefined) return;
  try {
    await browser.tabs.remove(tabId);
  } catch {
    // Already gone.
  }
};

const looksChallenged = (response: PageContextResponse): boolean =>
  (response.status === 403 || response.status === 503) &&
  /Just a moment|cf_chl|Attention Required|Verifying your browser/i.test(
    response.body.slice(0, 4000)
  );

const fetchInTab = async (
  tabId: number,
  url: string,
  init?: RequestInit
): Promise<PageContextResponse | { error: string } | undefined> => {
  const headers =
    init?.headers && !(init.headers instanceof Headers)
      ? (init.headers as Record<string, string>)
      : init?.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : undefined;

  return await runInPage<PageContextResponse | { error: string }>(
    tabId,
    runFetch as (...args: never[]) => Promise<PageContextResponse | { error: string }>,
    [
      url,
      {
        method: init?.method,
        headers,
        body: typeof init?.body === "string" ? init.body : undefined,
      },
    ]
  );
};

/** Runs the request inside a page on its own origin. */
export const pageContextFetch = async (
  url: string,
  init?: RequestInit
): Promise<PageContextResponse> => {
  const origin = new URL(url).origin;
  let tabId = await ensureTab(origin);
  let result = await fetchInTab(tabId, url, init);

  // Clearance expires and the parked tab starts collecting interstitials.
  // Reloading re-runs the check the way the first load did.
  if (result && !("error" in result) && looksChallenged(result)) {
    await closePageContext(origin);
    tabId = await ensureTab(origin);
    result = await fetchInTab(tabId, url, init);
  }

  scheduleIdleClose(origin);

  if (!result) throw new Error(`No response from the page-context tab`);
  if ("error" in result) {
    throw new Error(`Page-context request to ${url} failed: ${result.error}`);
  }
  return result;
};
