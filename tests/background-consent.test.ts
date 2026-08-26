import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import background from "../entrypoints/background";
import type { CredentialHostMap } from "../src/credential-hosts";

/**
 * The background worker's consent orchestration.
 *
 * The pure decision logic lives in `credential-hosts.test.ts`; what is tested
 * here is the part that can only go wrong at runtime -- that a request actually
 * waits for the answer, that "no" is as durable as "yes", that a dismissed
 * window is not an accidental yes, and that nothing but the extension's own
 * consent page can answer a prompt.
 */

const APP_ORIGIN = "https://www.audiogata.com";
const APP_URL = `${APP_ORIGIN}/plugins/test`;

/** A content script's message sender. */
const pageSender = (url = APP_URL) => ({
  url,
  tab: { id: 1, url },
});

/** The consent page's message sender. */
const consentSender = (id: string) => ({
  id: fakeBrowser.runtime.id,
  url: `${fakeBrowser.runtime.getURL("/consent.html")}?id=${id}`,
  tab: { id: 70, url: fakeBrowser.runtime.getURL("/consent.html") },
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/**
 * Node has no `FileReader`, and the worker uses one to base64 the response body.
 * Without this the request would fail after the fetch, and every assertion below
 * would be reading an error path rather than the real one.
 */
class TestFileReader {
  result: string | null = null;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  readAsDataURL(blob: Blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        const type = blob.type || "application/octet-stream";
        const base64 = Buffer.from(buffer).toString("base64");
        this.result = `data:${type};base64,${base64}`;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

let createWindow: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let nextWindowId = 100;

const sendToBackground = (message: unknown, sender: unknown) => {
  const sendResponse = vi.fn();
  (fakeBrowser.runtime.onMessage as any).trigger(message, sender, sendResponse);
  return sendResponse;
};

/** Every window the worker opened that was a consent prompt. */
const consentWindows = () =>
  createWindow.mock.calls
    .map((call) => String(call[0]?.url ?? ""))
    .filter((url) => url.includes("consent.html"))
    .map((url) => new URL(url));

const latestConsent = () => {
  const windows = consentWindows();
  const latest = windows[windows.length - 1];
  if (!latest) throw new Error("No consent window was opened");
  return {
    id: latest.searchParams.get("id")!,
    kind: latest.searchParams.get("kind"),
    requester: latest.searchParams.get("requester"),
    hosts: (latest.searchParams.get("hosts") ?? "").split(",").filter(Boolean),
    detail: latest.searchParams.get("detail"),
  };
};

const answerConsent = async (
  allowed: boolean,
  sender = consentSender(latestConsent().id)
) => {
  const { id, hosts } = latestConsent();
  sendToBackground({ type: "consent-decision", id, allowed, hosts }, sender);
  await flush();
};

const storedHosts = async (): Promise<CredentialHostMap> => {
  const items = await fakeBrowser.storage.local.get(["credentialHosts"]);
  const raw = items?.credentialHosts;
  return typeof raw === "string" ? JSON.parse(raw) : {};
};

const requestBandcamp = (
  patterns: string[] = ["https://bandcamp.com/*"],
  url = "https://bandcamp.com/album/x"
) =>
  sendToBackground(
    {
      type: "network-request",
      input: url,
      options: { siteMatchPatterns: patterns },
    },
    pageSender()
  );

const credentialsUsed = () => fetchMock.mock.calls[0]?.[1]?.credentials;

const start = async (seed?: CredentialHostMap) => {
  if (seed) {
    await fakeBrowser.storage.local.set({
      credentialHosts: JSON.stringify(seed),
    });
  }
  background.main!();
  await flush();
};

beforeEach(async () => {
  fakeBrowser.reset();
  nextWindowId = 100;

  // fake-browser has no in-memory webRequest; the worker only registers and
  // removes listeners, so counting those calls is the whole contract here.
  const onBeforeSendHeaders = (fakeBrowser as any).webRequest
    .onBeforeSendHeaders;
  onBeforeSendHeaders.addListener = vi.fn();
  onBeforeSendHeaders.removeListener = vi.fn();

  createWindow = vi.fn(async () => {
    const id = nextWindowId++;
    return { id, tabs: [{ id: id * 10 }] };
  });
  vi.spyOn(fakeBrowser.windows, "create").mockImplementation(
    createWindow as any
  );

  fetchMock = vi.fn(
    async () => new Response("body", { status: 200, statusText: "OK" })
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("FileReader", TestFileReader);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("credentialed requests", () => {
  it("holds the request open until the user answers", async () => {
    await start();
    requestBandcamp();
    await flush();

    expect(consentWindows()).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the host and the app that asked", async () => {
    await start();
    requestBandcamp();
    await flush();

    expect(latestConsent()).toMatchObject({
      kind: "request",
      requester: APP_ORIGIN,
      hosts: ["bandcamp.com"],
    });
  });

  it("sends the cookies once the user allows, and remembers the answer", async () => {
    await start();
    const sendResponse = requestBandcamp();
    await flush();
    await answerConsent(true);

    expect(credentialsUsed()).toBe("include");
    expect(await storedHosts()).toMatchObject({
      "bandcamp.com": { decision: "allow", requester: APP_ORIGIN },
    });
    // The page gets a real response, not the failure path.
    const answer = sendResponse.mock.calls[0]?.[0];
    expect(answer).toMatchObject({ status: 200, statusText: "OK" });
    expect(answer).not.toHaveProperty("error");
  });

  it("still answers the request anonymously when the user denies", async () => {
    await start();
    const sendResponse = requestBandcamp();
    await flush();
    await answerConsent(false);

    // Denied means anonymous, not failed: the plugin still gets its response.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credentialsUsed()).toBe("omit");
    expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({ status: 200 });
  });

  it("does not ask again once a host is allowed", async () => {
    await start({
      "bandcamp.com": {
        decision: "allow",
        requester: APP_ORIGIN,
        decidedAt: 1,
      },
    });
    requestBandcamp();
    await flush();

    expect(consentWindows()).toHaveLength(0);
    expect(credentialsUsed()).toBe("include");
  });

  it("does not ask again once a host is denied", async () => {
    await start({
      "bandcamp.com": { decision: "deny", requester: APP_ORIGIN, decidedAt: 1 },
    });
    requestBandcamp();
    await flush();

    expect(consentWindows()).toHaveLength(0);
    expect(credentialsUsed()).toBe("omit");
  });

  it("treats a dismissed window as a refusal without recording one", async () => {
    await start();
    requestBandcamp();
    await flush();

    const windowId = (await createWindow.mock.results[0]!.value).id;
    (fakeBrowser.windows.onRemoved as any).trigger(windowId);
    await flush();

    expect(credentialsUsed()).toBe("omit");
    // Dismissing is not answering: the next request may ask again.
    expect(await storedHosts()).toEqual({});
  });

  it("opens one window for a burst of requests for the same host", async () => {
    await start();
    requestBandcamp();
    requestBandcamp(["https://bandcamp.com/*"], "https://bandcamp.com/album/y");
    requestBandcamp(["https://bandcamp.com/*"], "https://bandcamp.com/album/z");
    await flush();

    expect(consentWindows()).toHaveLength(1);

    await answerConsent(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.credentials).toBe("include");
    }
  });

  it("never asks for a pattern with a wildcard host", async () => {
    await start();
    sendToBackground(
      {
        type: "network-request",
        input: "https://mail.google.com/mail/u/0/",
        options: { siteMatchPatterns: ["https://*/*"] },
      },
      pageSender()
    );
    await flush();

    expect(consentWindows()).toHaveLength(0);
    expect(credentialsUsed()).toBe("omit");
  });

  it("sends an ordinary request anonymously without asking", async () => {
    await start();
    sendToBackground(
      { type: "network-request", input: "https://example.com/feed.xml" },
      pageSender()
    );
    await flush();

    expect(consentWindows()).toHaveLength(0);
    expect(credentialsUsed()).toBe("omit");
  });
});

describe("who may answer a prompt", () => {
  it("ignores a decision that did not come from the consent page", async () => {
    await start();
    requestBandcamp();
    await flush();

    // A web page that guessed the pending id.
    await answerConsent(true, pageSender("https://evil.com/") as any);
    expect(fetchMock).not.toHaveBeenCalled();

    // Another extension reusing the URL.
    await answerConsent(true, {
      id: "some-other-extension",
      url: fakeBrowser.runtime.getURL("/consent.html"),
    } as any);
    expect(fetchMock).not.toHaveBeenCalled();

    // The real consent page.
    await answerConsent(true);
    expect(credentialsUsed()).toBe("include");
  });

  it("ignores a decision for an id that is not pending", async () => {
    await start();
    requestBandcamp();
    await flush();

    sendToBackground(
      { type: "consent-decision", id: "not-a-real-id", allowed: true, hosts: [] },
      consentSender("not-a-real-id")
    );
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await storedHosts()).toEqual({});
  });
});

describe("login windows", () => {
  const auth = {
    loginUrl: "https://example.com/login",
    headersToFind: ["Authorization"],
    cookiesToFind: ["session"],
    domainHeadersToFind: { ".api.example.com": ["X-Token"] },
  };

  const openLogin = (overrides: Record<string, unknown> = {}) =>
    sendToBackground(
      { type: "open-login", auth: { ...auth, ...overrides }, pluginId: "p1" },
      pageSender()
    );

  const loginWindows = () =>
    createWindow.mock.calls
      .map((call) => String(call[0]?.url ?? ""))
      .filter((url) => !url.includes("consent.html"));

  const headerListener = () =>
    (fakeBrowser as any).webRequest.onBeforeSendHeaders;

  /**
   * Only the login flow's registrations. Under MV2 the worker also registers a
   * permanent listener that strips the extension's Origin header on YouTube,
   * and that one is scoped by URL rather than by tab.
   */
  const loginHeaderListeners = () =>
    headerListener().addListener.mock.calls.filter(
      (call: any[]) => call[1]?.tabId !== undefined
    );

  it("asks before opening the login window, naming every domain it captures", async () => {
    await start();
    openLogin();
    await flush();

    expect(loginWindows()).toHaveLength(0);
    const consent = latestConsent();
    expect(consent.kind).toBe("login");
    expect(consent.hosts.sort()).toEqual(["api.example.com", "example.com"]);
    expect(consent.detail).toContain("session");
    expect(consent.detail).toContain("Authorization");
    expect(consent.detail).toContain("X-Token");
  });

  it("opens the login window and watches headers once allowed", async () => {
    await start();
    openLogin();
    await flush();
    await answerConsent(true);

    expect(loginWindows()).toEqual(["https://example.com/login"]);
    expect(loginHeaderListeners()).toHaveLength(1);
  });

  it("opens nothing and watches nothing when denied", async () => {
    await start();
    openLogin();
    await flush();
    await answerConsent(false);

    expect(loginWindows()).toHaveLength(0);
    expect(loginHeaderListeners()).toHaveLength(0);
  });

  it("refuses a login URL that is not http(s)", async () => {
    await start();
    openLogin({ loginUrl: "javascript:alert(1)" });
    await flush();

    expect(consentWindows()).toHaveLength(0);
    expect(loginWindows()).toHaveLength(0);
  });

  it("removes the header listener when the login window closes", async () => {
    await start();
    openLogin();
    await flush();
    await answerConsent(true);

    expect(headerListener().removeListener).not.toHaveBeenCalled();

    const loginWindowId = (await createWindow.mock.results[1]!.value).id;
    (fakeBrowser.windows.onRemoved as any).trigger(loginWindowId);
    await flush();

    expect(headerListener().removeListener).toHaveBeenCalledTimes(1);
  });

  it("tears the previous login down before starting another", async () => {
    await start({
      "example.com": { decision: "allow", requester: APP_ORIGIN, decidedAt: 1 },
      "api.example.com": {
        decision: "allow",
        requester: APP_ORIGIN,
        decidedAt: 1,
      },
    });

    openLogin();
    await flush();
    openLogin();
    await flush();

    expect(loginHeaderListeners()).toHaveLength(2);
    expect(headerListener().removeListener).toHaveBeenCalledTimes(1);
  });
});

describe("the stored allowlist", () => {
  it("returns the decisions to the popup", async () => {
    const seed = {
      "bandcamp.com": {
        decision: "allow" as const,
        requester: APP_ORIGIN,
        decidedAt: 1,
      },
    };
    await start(seed);

    const sendResponse = sendToBackground(
      { type: "get-credential-hosts" },
      { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL("/popup.html") }
    );
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({ hosts: seed });
  });

  it("revoking returns a host to undecided, so the next request asks again", async () => {
    await start({
      "bandcamp.com": {
        decision: "deny",
        requester: APP_ORIGIN,
        decidedAt: 1,
      },
    });

    sendToBackground(
      { type: "revoke-credential-host", host: "bandcamp.com" },
      { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL("/popup.html") }
    );
    await flush();
    expect(await storedHosts()).toEqual({});

    requestBandcamp();
    await flush();
    expect(consentWindows()).toHaveLength(1);
  });
});

describe("redirect registration", () => {
  const rule = {
    pluginId: "p1",
    pluginName: "Test Plugin",
    appName: "AudioGata",
    appOrigin: "https://evil.com",
    siteMatchPatterns: ["https://bandcamp.com/*"],
    redirectPath: "/feed",
  };

  const registeredRules = async () => {
    const sendResponse = sendToBackground(
      { type: "get-redirect-rules" },
      { id: fakeBrowser.runtime.id, url: fakeBrowser.runtime.getURL("/popup.html") }
    );
    await flush();
    return sendResponse.mock.calls[0]?.[0]?.rules ?? [];
  };

  it("overwrites a claimed appOrigin with the origin that actually sent it", async () => {
    await start();
    sendToBackground({ type: "register-redirects", rules: [rule] }, pageSender());
    await flush();

    expect(await registeredRules()).toEqual([
      { ...rule, appOrigin: APP_ORIGIN },
    ]);
  });

  it("caps how many rules one origin can register", async () => {
    await start();
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...rule,
      pluginId: `p${i}`,
    }));
    sendToBackground({ type: "register-redirects", rules: many }, pageSender());
    await flush();

    expect(await registeredRules()).toHaveLength(50);
  });

  it("ignores a registration from a sender with no usable origin", async () => {
    await start();
    sendToBackground({ type: "register-redirects", rules: [rule] }, {});
    await flush();

    expect(await registeredRules()).toEqual([]);
  });

  it("replaces only the rules belonging to the sending origin", async () => {
    await start();
    sendToBackground({ type: "register-redirects", rules: [rule] }, pageSender());
    await flush();
    sendToBackground(
      { type: "register-redirects", rules: [{ ...rule, pluginId: "p2" }] },
      pageSender("https://www.videogata.com/plugins/test")
    );
    await flush();

    const rules = await registeredRules();
    expect(rules.map((r: any) => r.appOrigin).sort()).toEqual([
      APP_ORIGIN,
      "https://www.videogata.com",
    ]);
  });
});
