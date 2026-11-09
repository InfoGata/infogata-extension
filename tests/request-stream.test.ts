import { describe, expect, it, vi } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  expectedLength,
  receiveStreamedResponse,
  serveStreamPort,
  type BackgroundPort,
  type ContentPort,
  type PreparedResponse,
  type StreamStart,
} from "../src/request-stream";

/**
 * Two ends of a runtime port. Messages arrive asynchronously, as they do
 * between a content script and the worker, and go through JSON, as chrome's
 * messaging does, so anything that wouldn't survive the trip fails here too.
 * Disconnecting fires only the other end's onDisconnect, as in chrome.
 */
const portPair = () => {
  type End = {
    messages: ((message: any) => void)[];
    disconnects: (() => void)[];
    open: boolean;
  };
  const a: End = { messages: [], disconnects: [], open: true };
  const b: End = { messages: [], disconnects: [], open: true };
  const make = (self: End, other: End) => ({
    postMessage: (message: unknown) => {
      if (!self.open) throw new Error("Attempting to use a disconnected port");
      const copy = JSON.parse(JSON.stringify(message));
      setTimeout(() => {
        if (other.open) other.messages.forEach((l) => l(copy));
      }, 0);
    },
    onMessage: { addListener: (l: (m: any) => void) => self.messages.push(l) },
    onDisconnect: { addListener: (l: () => void) => self.disconnects.push(l) },
    disconnect: () => {
      if (!self.open) return;
      self.open = false;
      other.open = false;
      setTimeout(() => other.disconnects.forEach((l) => l()), 0);
    },
  });
  return {
    content: make(a, b) as ContentPort,
    background: make(b, a) as BackgroundPort,
  };
};

const head = {
  status: 200,
  statusText: "OK",
  url: "https://www.gutenberg.org/ebooks/1497.epub3.images",
};

/** A body that yields `parts` and records how far it has been read. */
const bodyOf = (parts: Uint8Array[]) => {
  const state = { reads: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = parts[state.reads++];
      if (next) controller.enqueue(next);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
};

const bytes = (...values: number[]) => new Uint8Array(values);

const start = { input: head.url };

describe("base64", () => {
  it("round-trips every byte value, past the 32K argument batch", () => {
    const data = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(base64ToBytes(bytesToBase64(data))).toEqual(data);
  });
});

describe("expectedLength", () => {
  it("trusts Content-Length only for an uncompressed body", () => {
    expect(expectedLength({ "content-length": "619155" })).toBe(619155);
    expect(
      expectedLength({ "content-length": "1000", "content-encoding": "gzip" })
    ).toBeUndefined();
    expect(expectedLength({})).toBeUndefined();
  });
});

describe("streamed responses", () => {
  it("delivers the body in chunks and reports progress", async () => {
    const { content, background } = portPair();
    const { stream } = bodyOf([bytes(1, 2, 3), bytes(4, 5, 6, 7, 8), bytes(9)]);
    serveStreamPort(
      background,
      async () => ({
        ...head,
        headers: { "content-type": "application/epub+zip", "content-length": "9" },
        body: stream,
      }),
      // A tiny chunk size, so a 9-byte body takes several chunks.
      4
    );
    const onProgress = vi.fn();

    const { response } = receiveStreamedResponse(content, start, { onProgress });
    const result = await response;

    expect(result.status).toBe(200);
    expect(result.url).toBe(head.url);
    const body = result.body as Blob;
    expect(body.type).toBe("application/epub+zip");
    expect(new Uint8Array(await body.arrayBuffer())).toEqual(
      bytes(1, 2, 3, 4, 5, 6, 7, 8, 9)
    );
    expect(onProgress.mock.calls).toEqual([
      [0, 9],
      [4, 9],
      [8, 9],
      [9, 9],
    ]);
  });

  it("splits one large read into chunks the message limit allows", async () => {
    const { content, background } = portPair();
    const big = new Uint8Array(10).map((_, i) => i);
    serveStreamPort(
      background,
      async () => ({ ...head, headers: {}, body: bodyOf([big]).stream }),
      3
    );
    const onProgress = vi.fn();

    const result = await receiveStreamedResponse(content, start, { onProgress })
      .response;

    expect(new Uint8Array(await (result.body as Blob).arrayBuffer())).toEqual(big);
    // 3 + 3 + 3 + 1, after the head's 0; the total is unknown.
    expect(onProgress.mock.calls.map(([loaded]) => loaded)).toEqual([0, 3, 6, 9, 10]);
    expect(onProgress.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("doesn't read ahead of what the content script has taken", async () => {
    const { content, background } = portPair();
    const { stream, state } = bodyOf([bytes(1), bytes(2), bytes(3), bytes(4)]);
    serveStreamPort(
      background,
      async () => ({ ...head, headers: {}, body: stream }),
      1
    );
    // Swallow acks, as a stalled page would.
    const realPost = content.postMessage;
    content.postMessage = (message) => {
      if (message.type !== "ack") realPost(message);
    };
    receiveStreamedResponse(content, start);

    await new Promise((r) => setTimeout(r, 20));
    // The first chunk is sent and the worker waits for its ack. The stream
    // may have pulled one more ahead on its own, but no further.
    expect(state.reads).toBeLessThanOrEqual(2);
  });

  it("answers a body-less response with an empty body", async () => {
    const { content, background } = portPair();
    serveStreamPort(background, async () => ({ ...head, headers: {}, body: null }));

    const result = await receiveStreamedResponse(content, start).response;

    expect((result.body as Blob).size).toBe(0);
  });

  it("passes on the request's failure", async () => {
    const { content, background } = portPair();
    vi.spyOn(console, "error").mockImplementation(() => {});
    serveStreamPort(background, async () => {
      throw Object.assign(new Error("Not allowed"), { name: "SecurityError" });
    });

    await expect(receiveStreamedResponse(content, start).response).rejects.toMatchObject(
      { message: "Not allowed", name: "SecurityError" }
    );
  });

  it("cancels the download when the page aborts", async () => {
    const { content, background } = portPair();
    const { stream, state } = bodyOf([bytes(1), bytes(2), bytes(3), bytes(4)]);
    let signal: AbortSignal | undefined;
    serveStreamPort(
      background,
      async (_start: StreamStart, s: AbortSignal): Promise<PreparedResponse> => {
        signal = s;
        return { ...head, headers: {}, body: stream };
      },
      1
    );

    const request = receiveStreamedResponse(content, start, {
      // Abort as soon as the first chunk lands.
      onProgress: (loaded) => {
        if (loaded === 1) request.abort();
      },
    });

    await expect(request.response).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((r) => setTimeout(r, 20));
    expect(signal?.aborted).toBe(true);
    expect(state.cancelled).toBe(true);
  });

  it("fails rather than hangs when the worker goes away mid-response", async () => {
    const { content, background } = portPair();
    const { stream } = bodyOf([bytes(1), bytes(2)]);
    serveStreamPort(
      background,
      async () => ({ ...head, headers: {}, body: stream }),
      1
    );

    const request = receiveStreamedResponse(content, start, {
      onProgress: (loaded) => {
        // Chrome stopping the service worker looks like this from the page.
        if (loaded === 1) background.disconnect();
      },
    });

    await expect(request.response).rejects.toThrow(/stopped responding/);
  });
});
