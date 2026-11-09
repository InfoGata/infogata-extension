import type {
  NetworkRequest,
  NetworkRequestOptions,
  RequestFailure,
  SerializableRequestInit,
  SharedRequest,
} from "./types";

/**
 * Streams a network request's response from the background worker to the
 * content script over a port, a chunk at a time.
 *
 * A single `runtime.sendMessage` carrying the whole body was the old way. It
 * capped a response at chrome's 64 MiB message limit -- about 48 MB of real
 * data once base64 inflates it -- and gave the page nothing to show while a
 * large file downloaded, and no way to stop it.
 *
 * Over a port the body goes in chunks, each one well under the limit, so size
 * no longer matters. The content script acknowledges each chunk before the
 * worker reads the next, so a slow page can't make the worker buffer the whole
 * file anyway. Each chunk is reported to the page as progress, and closing the
 * port cancels the fetch.
 *
 * Chunks are base64 because chrome's extension messaging is JSON: an
 * ArrayBuffer would arrive as `{}`.
 */

export const STREAM_PORT_NAME = "infogata-network-request";

/** Raw bytes per chunk; about 5.3 MB once base64 encoded. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

export type StreamStart = {
  type: "start";
  input: string;
  init?: SerializableRequestInit;
  options?: NetworkRequestOptions;
};
export type StreamAck = { type: "ack" };
export type ToBackground = StreamStart | StreamAck;

export type StreamHead = SharedRequest & {
  type: "head";
  /** Bytes the body will have, when the server says and it isn't compressed. */
  total?: number;
};
export type StreamChunk = { type: "chunk"; data: string };
export type StreamEnd = { type: "end" };
export type StreamError = { type: "error"; error: RequestFailure };
export type FromBackground = StreamHead | StreamChunk | StreamEnd | StreamError;

/** The part of `Browser.runtime.Port` used here, so tests can fake it. */
export interface PortLike<In, Out> {
  postMessage: (message: Out) => void;
  onMessage: { addListener: (listener: (message: In) => void) => void };
  onDisconnect: { addListener: (listener: () => void) => void };
  disconnect: () => void;
}

export type BackgroundPort = PortLike<ToBackground, FromBackground>;
export type ContentPort = PortLike<FromBackground, ToBackground>;

/** A response whose body has not been read yet. */
export type PreparedResponse = SharedRequest & {
  body: ReadableStream<Uint8Array> | null;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  // String.fromCharCode takes its bytes as arguments, and an argument list
  // that long overflows the stack; 32K at a time is safe everywhere.
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
};

export const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** The body's length, if the headers state it for the bytes fetch will yield. */
export const expectedLength = (
  headers: Record<string, string>
): number | undefined => {
  // fetch decompresses, so a compressed body's Content-Length counts the wrong
  // bytes.
  if (headers["content-encoding"]) return undefined;
  const length = Number(headers["content-length"]);
  return Number.isFinite(length) && length >= 0 ? length : undefined;
};

const toFailure = (error: unknown, fallback: string): RequestFailure => ({
  message: String((error as Error)?.message ?? error ?? fallback),
  name: (error as Error)?.name,
});

/**
 * The worker's side of one port: waits for `start`, makes the request with
 * `perform`, then sends the head, the body's chunks and an end (or an error).
 * The fetch is aborted if the port closes first.
 */
export const serveStreamPort = (
  port: BackgroundPort,
  perform: (start: StreamStart, signal: AbortSignal) => Promise<PreparedResponse>,
  chunkBytes = CHUNK_BYTES
) => {
  const controller = new AbortController();
  let closed = false;
  let started = false;
  let acknowledged: (() => void) | undefined;

  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    acknowledged?.();
  };
  port.onDisconnect.addListener(close);

  // Chrome throws on a port the other end has closed, which can happen before
  // its onDisconnect arrives here.
  const post = (message: FromBackground) => {
    if (closed) return;
    try {
      port.postMessage(message);
    } catch {
      close();
    }
  };

  const nextAck = () =>
    new Promise<void>((resolve) => {
      acknowledged = resolve;
    });

  const run = async (start: StreamStart) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await perform(start, controller.signal);
      const { body, ...head } = response;
      post({ type: "head", ...head, total: expectedLength(head.headers) });

      if (body) {
        reader = body.getReader();
        let pending: Uint8Array[] = [];
        let pendingBytes = 0;
        const flush = async () => {
          if (!pendingBytes) return;
          const joined = new Uint8Array(pendingBytes);
          let offset = 0;
          for (const part of pending) {
            joined.set(part, offset);
            offset += part.length;
          }
          pending = [];
          pendingBytes = 0;
          const ack = nextAck();
          post({ type: "chunk", data: bytesToBase64(joined) });
          await ack;
        };

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          // Reads come in whatever sizes the network gives; chunks are cut to
          // exactly chunkBytes so none can grow past the message limit.
          let offset = 0;
          while (offset < value.length && !closed) {
            const take = Math.min(chunkBytes - pendingBytes, value.length - offset);
            pending.push(value.subarray(offset, offset + take));
            pendingBytes += take;
            offset += take;
            if (pendingBytes === chunkBytes) await flush();
          }
        }
        if (!closed) await flush();
      }
      post({ type: "end" });
    } catch (error) {
      if (!closed) {
        console.error("InfoGata network request failed:", start.input, error);
        post({ type: "error", error: toFailure(error, "Request failed") });
      }
    } finally {
      if (closed) reader?.cancel().catch(() => {});
    }
  };

  port.onMessage.addListener((message) => {
    if (message.type === "ack") {
      const resolve = acknowledged;
      acknowledged = undefined;
      resolve?.();
    } else if (message.type === "start" && !started) {
      started = true;
      void run(message);
    }
  });
};

export interface ReceiveCallbacks {
  onProgress?: (loaded: number, total: number | undefined) => void;
}

/**
 * The content script's side: starts the request and assembles the chunks into
 * a Blob. Resolves with the whole response, or rejects with what went wrong;
 * either way exactly once. Disconnecting the port rejects with an AbortError.
 */
export const receiveStreamedResponse = (
  port: ContentPort,
  start: Omit<StreamStart, "type">,
  callbacks: ReceiveCallbacks = {}
): { response: Promise<NetworkRequest>; abort: () => void } => {
  let settle: { resolve: (r: NetworkRequest) => void; reject: (e: Error) => void };
  const response = new Promise<NetworkRequest>((resolve, reject) => {
    settle = { resolve, reject };
  });

  let done = false;
  let head: StreamHead | undefined;
  const parts: Uint8Array[] = [];
  let loaded = 0;

  const finish = (fn: () => void) => {
    if (done) return;
    done = true;
    fn();
    try {
      port.disconnect();
    } catch {
      // Already gone.
    }
  };

  const fail = (message: string, name = "Error") =>
    finish(() => settle.reject(Object.assign(new Error(message), { name })));

  // Chrome throws on a port the worker has closed, which can happen before its
  // onDisconnect arrives here.
  const post = (message: ToBackground) => {
    try {
      port.postMessage(message);
    } catch {
      fail("The extension stopped responding before the response finished");
    }
  };

  port.onMessage.addListener((message) => {
    if (done) return;
    switch (message.type) {
      case "head":
        head = message;
        callbacks.onProgress?.(0, message.total);
        break;
      case "chunk": {
        const bytes = base64ToBytes(message.data);
        parts.push(bytes);
        loaded += bytes.length;
        callbacks.onProgress?.(loaded, head?.total);
        post({ type: "ack" });
        break;
      }
      case "end": {
        if (!head) {
          fail("The extension sent no response");
          return;
        }
        const { type: _type, total: _total, ...shared } = head;
        const body = new Blob(parts as BlobPart[], {
          type: head.headers["content-type"] ?? "",
        });
        finish(() => settle.resolve({ ...shared, body }));
        break;
      }
      case "error":
        fail(message.error.message, message.error.name ?? "Error");
        break;
    }
  });

  // The worker went away mid-response (chrome stops an idle service worker,
  // or the extension was reloaded).
  port.onDisconnect.addListener(() =>
    fail("The extension stopped responding before the response finished")
  );

  post({ type: "start", ...start });

  return {
    response,
    abort: () => fail("The request was aborted", "AbortError"),
  };
};
