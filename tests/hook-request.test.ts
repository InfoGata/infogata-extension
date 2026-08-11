import { describe, it, expect, vi } from "vitest";
import { createNetworkRequestFn } from "../src/hook-request";
import { ContentMessage, HookMessage, NetworkRequest } from "../src/types";

/**
 * The property under test is that the promise always settles. A request that
 * goes unanswered used to leave the calling app on a loading spinner forever
 * instead of reporting a failure.
 */
const harness = (overrides: { timeoutMs?: number } = {}) => {
  const listeners: ((event: MessageEvent<ContentMessage>) => void)[] = [];
  const sent: HookMessage[] = [];
  const timers: { fn: () => void; ms: number }[] = [];

  const networkRequest = createNetworkRequestFn({
    sendMessage: (message) => sent.push(message),
    addListener: (listener) => listeners.push(listener),
    removeListener: (listener) => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    },
    clone: (value) => value,
    PromiseCtor: Promise,
    nextUid: (() => {
      let id = 0;
      return () => ++id;
    })(),
    serializeBody: async () => ({ body: undefined, bodyIsBase64: false }),
    // `deliver(..., false)` stands in for a message posted by another frame.
    isOwnSource: (e) => e.source !== null,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: () => {},
    ...overrides,
  });

  /** Delivers a message to every current listener, as postMessage would. */
  const deliver = (data: unknown, source = true) => {
    for (const listener of [...listeners]) {
      listener({ data, source: source ? {} : null } as MessageEvent<ContentMessage>);
    }
  };

  return { networkRequest, listeners, sent, timers, deliver };
};

/** The body is serialized before the request is posted, so it lands a tick later. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const okResult: NetworkRequest = {
  body: null,
  headers: {},
  status: 200,
  statusText: "OK",
  url: "https://www.reddit.com/hot.json",
};

describe("createNetworkRequestFn", () => {
  it("resolves with the response and stops listening", async () => {
    const { networkRequest, listeners, deliver } = harness();
    const pending = networkRequest("https://www.reddit.com/hot.json");

    deliver({ type: "infogata-extension-response", uid: 1, result: okResult });

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(listeners).toHaveLength(0);
  });

  it("rejects when the background reports a failure", async () => {
    const { networkRequest, listeners, deliver } = harness();
    const pending = networkRequest("https://www.reddit.com/hot.json");

    deliver({
      type: "infogata-extension-response",
      uid: 1,
      error: { message: "Failed to fetch", name: "TypeError" },
    });

    await expect(pending).rejects.toMatchObject({
      message: "Failed to fetch",
      name: "TypeError",
    });
    expect(listeners).toHaveLength(0);
  });

  it("rejects rather than hanging on a response carrying nothing", async () => {
    const { networkRequest, listeners, deliver } = harness();
    const pending = networkRequest("https://www.reddit.com/hot.json");

    // What the old background error path produced.
    deliver({ type: "infogata-extension-response", uid: 1, result: undefined });

    await expect(pending).rejects.toMatchObject({
      message: "The extension returned no response",
    });
    expect(listeners).toHaveLength(0);
  });

  it("rejects when no response ever arrives", async () => {
    const { networkRequest, listeners, timers } = harness();
    const pending = networkRequest("https://www.reddit.com/hot.json");

    expect(timers).toHaveLength(1);
    timers[0].fn();

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(listeners).toHaveLength(0);
  });

  it("ignores another request's reply and a foreign source", async () => {
    const { networkRequest, listeners, deliver } = harness();
    const settled = vi.fn();
    const pending = networkRequest("https://www.reddit.com/hot.json").then(
      settled,
      settled
    );
    await flush();

    deliver({ type: "infogata-extension-response", uid: 99, result: okResult });
    deliver(
      { type: "infogata-extension-response", uid: 1, result: okResult },
      false
    );
    deliver({ type: "infogata-extension-getversion-content", uid: 1, result: "1" });

    await flush();
    expect(settled).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(1);

    // Still live, and answers its own reply.
    deliver({ type: "infogata-extension-response", uid: 1, result: okResult });
    await pending;
    expect(settled).toHaveBeenCalled();
  });

  it("serializes the body before waiting on a reply", async () => {
    const { networkRequest, sent, deliver } = harness();
    const pending = networkRequest("https://www.reddit.com/api", {
      method: "POST",
      body: "a=1",
    });
    await flush();

    // The request is only posted once serialization has finished, so by the time
    // anything can answer it the init is complete.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "infogata-extension-request",
      init: { method: "POST", bodyIsBase64: false },
    });

    deliver({ type: "infogata-extension-response", uid: 1, result: okResult });
    await pending;
  });
});
