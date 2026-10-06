import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { checkPoTokenRequest } from "../src/po-token-providers";

/**
 * Cleanup of the minter's access.
 *
 * Minting itself is exercised end to end in real browsers; what is tested here
 * is what has to be put back afterwards. Framing a provider lifts its
 * X-Frame-Options and CSP, and anonymity strips cookies from everything its page
 * sends. Both must end when the last frame does -- after the idle timeout, when
 * the tab closes, or when the tab leaves the app -- and not before, since the
 * app routing within itself keeps its frame.
 */

const APP = "https://www.audiogata.com";
const OTHER_APP = "https://www.videogata.com";
const MINTER_URL = "https://www.youtube.com/?infogata-po-minter=1";
const VIDEO_ID = "uC8sc0cQa9M";
const IDLE_MS = 10 * 60_000;
const FRAMING_RULE_ID = 9001;
const ANONYMITY_RULE_ID = 9100;

type Minter = typeof import("../src/po-token-minter");

const check = checkPoTokenRequest("https://www.youtube.com", VIDEO_ID);
if (!check.ok) throw new Error(check.error);
const { provider, config } = check;

/** Tabs whose page currently holds a minter frame. */
let framesInTabs: Set<number>;
let sendMessage: ReturnType<typeof vi.fn>;

const removeMessagesSent = () =>
  sendMessage.mock.calls.filter(([, message]) => message.type === "remove-po-frame");

/** A fresh minter, so no frame, timer or listener carries over between tests. */
const load = async (manifestVersion: 2 | 3): Promise<Minter> => {
  vi.resetModules();
  vi.doMock("../src/manifest-version", () => ({ isMv3: manifestVersion === 3 }));
  return await import("../src/po-token-minter");
};

const mint = (minter: Minter, tabId: number, appOrigin = APP) =>
  minter.mintPoToken(tabId, appOrigin, [APP, OTHER_APP], provider, config, VIDEO_ID);

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  framesInTabs = new Set();
  // The content script's side: it adds or removes the frame when asked.
  sendMessage = vi.fn(async (tabId: number, message: { type: string }) => {
    if (message.type === "create-po-frame") {
      framesInTabs.add(tabId);
      return true;
    }
    if (message.type === "remove-po-frame") framesInTabs.delete(tabId);
    return undefined;
  });
  vi.spyOn(fakeBrowser.tabs, "sendMessage").mockImplementation(sendMessage as any);
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("../src/manifest-version");
  vi.unstubAllGlobals();
});

describe("on Chrome (MV3)", () => {
  /** The session rules as the browser would hold them. */
  let sessionRules: Map<number, chrome.declarativeNetRequest.Rule>;
  let updateSessionRules: ReturnType<typeof vi.fn>;

  const anonymousTabs = () =>
    sessionRules.get(ANONYMITY_RULE_ID)?.condition.tabIds ?? [];

  beforeEach(() => {
    sessionRules = new Map();
    updateSessionRules = vi.fn(
      async (update: chrome.declarativeNetRequest.UpdateRuleOptions) => {
        for (const id of update.removeRuleIds ?? []) sessionRules.delete(id);
        for (const rule of update.addRules ?? []) sessionRules.set(rule.id, rule);
      }
    );
    vi.stubGlobal("chrome", {
      declarativeNetRequest: {
        updateSessionRules,
        RuleActionType: { MODIFY_HEADERS: "modifyHeaders" },
        HeaderOperation: { REMOVE: "remove" },
        ResourceType: { SUB_FRAME: "sub_frame" },
      },
      scripting: {
        executeScript: vi.fn(async (injection: any) => {
          const { tabId, allFrames } = injection.target;
          if (allFrames) {
            return [
              { frameId: 0, result: `${APP}/` },
              ...(framesInTabs.has(tabId) ? [{ frameId: 5, result: MINTER_URL }] : []),
            ];
          }
          if (injection.files) return [];
          return [{ frameId: 5, result: { token: "token" } }];
        }),
      },
    });
  });

  it("frames the provider and anonymizes the tab while it mints", async () => {
    const minter = await load(3);
    await expect(mint(minter, 1)).resolves.toBe("token");

    expect(sessionRules.has(FRAMING_RULE_ID)).toBe(true);
    expect(anonymousTabs()).toEqual([1]);
  });

  it("removes the frame and both rules after the idle timeout", async () => {
    const minter = await load(3);
    await mint(minter, 1);

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(removeMessagesSent()).toHaveLength(0);
    expect(sessionRules.size).toBe(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(removeMessagesSent()).toEqual([[1, { type: "remove-po-frame" }]]);
    expect(framesInTabs.has(1)).toBe(false);
    expect(sessionRules.size).toBe(0);
  });

  it("postpones the idle removal while tokens keep being minted", async () => {
    const minter = await load(3);
    await mint(minter, 1);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 60_000);
    await mint(minter, 1);

    await vi.advanceTimersByTimeAsync(IDLE_MS - 60_000);
    expect(removeMessagesSent()).toHaveLength(0);
    expect(sessionRules.size).toBe(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(removeMessagesSent()).toHaveLength(1);
    expect(sessionRules.size).toBe(0);
  });

  it("drops a closed tab's rules at once and does not message it later", async () => {
    const minter = await load(3);
    await mint(minter, 1);

    minter.onMinterTabRemoved(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionRules.size).toBe(0);

    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(removeMessagesSent()).toHaveLength(0);
  });

  it("keeps the rules while the app routes within itself", async () => {
    const minter = await load(3);
    await mint(minter, 1);

    minter.onMinterTabNavigated(1, `${APP}/playlists/abc`);
    await vi.advanceTimersByTimeAsync(0);
    expect(anonymousTabs()).toEqual([1]);
    expect(sessionRules.has(FRAMING_RULE_ID)).toBe(true);
  });

  it("drops the rules when the tab leaves the app, even for the provider's own site", async () => {
    const minter = await load(3);
    await mint(minter, 1);

    // Otherwise youtube.com in this tab would lose its cookies.
    minter.onMinterTabNavigated(1, "https://www.youtube.com/watch?v=abc");
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionRules.size).toBe(0);

    // Its idle timer went with it.
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(removeMessagesSent()).toHaveLength(0);
  });

  it("keeps access for the tabs that still have a frame", async () => {
    const minter = await load(3);
    await mint(minter, 1);
    await mint(minter, 2, OTHER_APP);
    expect(anonymousTabs()).toEqual([1, 2]);

    minter.onMinterTabRemoved(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(anonymousTabs()).toEqual([2]);
    expect(sessionRules.has(FRAMING_RULE_ID)).toBe(true);

    minter.onMinterTabNavigated(2, `${APP}/`);
    await vi.advanceTimersByTimeAsync(0);
    expect(sessionRules.size).toBe(0);
  });

  it("ignores tabs that never had a frame", async () => {
    const minter = await load(3);
    await mint(minter, 1);
    updateSessionRules.mockClear();

    minter.onMinterTabRemoved(9);
    minter.onMinterTabNavigated(9, "https://example.com/");
    await vi.advanceTimersByTimeAsync(0);
    expect(updateSessionRules).not.toHaveBeenCalled();
    expect(anonymousTabs()).toEqual([1]);
  });
});

describe("on Firefox (MV2)", () => {
  type Details = {
    url: string;
    type: string;
    tabId: number;
    documentUrl?: string;
    frameAncestors?: { url: string }[];
    requestHeaders?: { name: string; value: string }[];
    responseHeaders?: { name: string; value: string }[];
  };
  type Listener = (details: Details) => Partial<Details> | undefined;

  /** A blocking webRequest event that honours its filters, as Firefox does. */
  const fakeEvent = () => {
    const listeners = new Map<Listener, { urls: string[]; types?: string[] }>();
    const matches = (pattern: string, url: string) =>
      pattern === "<all_urls>" ||
      new RegExp(
        "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
      ).test(url);
    return {
      addListener: (fn: Listener, filter: { urls: string[]; types?: string[] }) =>
        listeners.set(fn, filter),
      removeListener: (fn: Listener) => listeners.delete(fn),
      hasListener: (fn: Listener) => listeners.has(fn),
      get size() {
        return listeners.size;
      },
      /** Runs the matching listeners, each seeing the headers the last one left. */
      dispatch(details: Details): Details {
        let current = details;
        for (const [fn, filter] of listeners) {
          if (filter.types && !filter.types.includes(current.type)) continue;
          if (!filter.urls.some((pattern) => matches(pattern, current.url))) continue;
          current = { ...current, ...fn(current) };
        }
        return current;
      },
    };
  };

  let onBeforeSendHeaders: ReturnType<typeof fakeEvent>;
  let onHeadersReceived: ReturnType<typeof fakeEvent>;
  let minter: Minter;

  const COOKIE = { name: "Cookie", value: "SID=secret" };
  const ACCEPT = { name: "Accept", value: "*/*" };
  const RESPONSE_HEADERS = [
    { name: "X-Frame-Options", value: "SAMEORIGIN" },
    { name: "Content-Security-Policy", value: "script-src 'nonce-x'" },
    { name: "Set-Cookie", value: "YSC=abc" },
    { name: "Content-Type", value: "text/html" },
  ];

  const sendsCookie = (details: Omit<Details, "requestHeaders">) =>
    onBeforeSendHeaders
      .dispatch({ ...details, requestHeaders: [COOKIE, ACCEPT] })
      .requestHeaders!.some((h) => h.name === "Cookie");

  const responseHeaderNames = (details: Omit<Details, "responseHeaders">) =>
    onHeadersReceived
      .dispatch({ ...details, responseHeaders: RESPONSE_HEADERS })
      .responseHeaders!.map((h) => h.name);

  /** The minter frame's own document, framed by the app. */
  const frameDocument = (tabId = 1, parent = `${APP}/`) => ({
    url: MINTER_URL,
    type: "sub_frame",
    tabId,
    documentUrl: parent,
    frameAncestors: [{ url: parent }],
  });

  /** A request the provider's page makes from inside the frame. */
  const fromFrame = (tabId = 1) => ({
    url: "https://www.youtube.com/youtubei/v1/browse",
    type: "xmlhttprequest",
    tabId,
    documentUrl: MINTER_URL,
  });

  beforeEach(async () => {
    onBeforeSendHeaders = fakeEvent();
    onHeadersReceived = fakeEvent();
    (fakeBrowser as any).webRequest.onBeforeSendHeaders = onBeforeSendHeaders;
    (fakeBrowser as any).webRequest.onHeadersReceived = onHeadersReceived;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("/* po-minter.js */")));

    minter = await load(2);
    // MV2 has no frame ids in executeScript results, so the frame announces
    // itself; and the minter runs through a page script.
    (fakeBrowser.tabs as any).executeScript = vi.fn(
      async (tabId: number, details: { allFrames?: boolean; frameId?: number }) => {
        if (details.allFrames) {
          if (framesInTabs.has(tabId)) {
            minter.onMinterFrameAnnounced({
              id: fakeBrowser.runtime.id,
              tab: { id: tabId } as any,
              frameId: 7,
              url: MINTER_URL,
            });
          }
          return [];
        }
        return [{ token: "token" }];
      }
    );
  });

  it("lifts the frame's protections and strips its cookies while it mints", async () => {
    await expect(mint(minter, 1)).resolves.toBe("token");

    expect(sendsCookie(frameDocument())).toBe(false);
    expect(responseHeaderNames(frameDocument())).toEqual(["Content-Type"]);
    expect(sendsCookie(fromFrame())).toBe(false);
    expect(responseHeaderNames(fromFrame())).not.toContain("Set-Cookie");
  });

  it("leaves everything else alone while it mints", async () => {
    await mint(minter, 1);

    // The app's own request to the provider.
    expect(sendsCookie({ url: "https://www.youtube.com/robots.txt", type: "xmlhttprequest", tabId: 1, documentUrl: `${APP}/` })).toBe(true);
    // The provider's site in a tab without a frame.
    expect(sendsCookie({ ...fromFrame(2), documentUrl: "https://www.youtube.com/watch?v=abc" })).toBe(true);
    // A page that is not an app framing the minter url.
    expect(responseHeaderNames(frameDocument(3, "https://evil.example/"))).toContain("X-Frame-Options");
  });

  it("removes its listeners after the idle timeout", async () => {
    await mint(minter, 1);
    expect(onBeforeSendHeaders.size).toBe(2);
    expect(onHeadersReceived.size).toBe(2);

    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(removeMessagesSent()).toEqual([[1, { type: "remove-po-frame" }]]);
    expect(onBeforeSendHeaders.size).toBe(0);
    expect(onHeadersReceived.size).toBe(0);
    expect(sendsCookie(fromFrame())).toBe(true);
    expect(responseHeaderNames(frameDocument())).toContain("X-Frame-Options");
  });

  it("stops stripping a closed tab's cookies, and keeps the listeners for other tabs", async () => {
    await mint(minter, 1);
    await mint(minter, 2, OTHER_APP);

    minter.onMinterTabRemoved(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendsCookie(fromFrame(1))).toBe(true);
    expect(sendsCookie(fromFrame(2))).toBe(false);

    minter.onMinterTabRemoved(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(onBeforeSendHeaders.size).toBe(0);
    expect(onHeadersReceived.size).toBe(0);
  });

  it("keeps stripping through in-app routing and stops when the tab leaves", async () => {
    await mint(minter, 1);

    minter.onMinterTabNavigated(1, `${APP}/playlists/abc`);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendsCookie(fromFrame())).toBe(false);

    minter.onMinterTabNavigated(1, "https://www.youtube.com/");
    await vi.advanceTimersByTimeAsync(0);
    expect(sendsCookie({ ...fromFrame(), documentUrl: "https://www.youtube.com/" })).toBe(true);
    expect(onBeforeSendHeaders.size).toBe(0);
  });
});
