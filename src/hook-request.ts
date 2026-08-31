import type {
  ContentMessage,
  HookMessage,
  NetworkRequest,
  NetworkRequestOptions,
  SerializableRequestInit,
} from "./types";

/**
 * The page-facing half of `InfoGata.networkRequest`.
 *
 * It lives here rather than inside the hook's script closure so it can be tested
 * directly, because the property that matters is one a test has to drive: the
 * returned promise must **always** settle. It previously resolved only on a
 * successful response, so a failed request left the calling app waiting forever
 * — a page stuck on a loading spinner with nothing to report.
 *
 * The returned function must not be `async`. In Firefox the hook runs in the
 * content script's sandbox, on the far side of an Xray boundary from the page,
 * and an async function always returns a promise built from *its own* realm —
 * which would bury the page-realm `PromiseCtor` promise inside a sandbox one the
 * page is not allowed to touch. The page sees `Permission denied to access
 * property "then"` instead of a response. So the page's promise is constructed
 * first and synchronously, and the async work happens inside it.
 */

export interface HookRequestDeps {
  sendMessage: (message: HookMessage) => void;
  addListener: (listener: (event: MessageEvent<ContentMessage>) => void) => void;
  removeListener: (
    listener: (event: MessageEvent<ContentMessage>) => void
  ) => void;
  /** Identity outside Firefox; `cloneInto` there, so the page can read it. */
  clone: <T>(value: T) => T;
  /** The page realm's Promise, so the value belongs to the page. */
  PromiseCtor: PromiseConstructor;
  nextUid: () => number;
  serializeBody: (
    body: BodyInit | null | undefined
  ) => Promise<{ body?: string; bodyIsBase64: boolean }>;
  /** Only messages posted by the page itself are ours. */
  isOwnSource: (event: MessageEvent<ContentMessage>) => boolean;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export const createNetworkRequestFn = (deps: HookRequestDeps) => {
  return (
    input: string,
    init?: RequestInit,
    options?: NetworkRequestOptions
  ): Promise<NetworkRequest> => {
    const uid = deps.nextUid();

    return new deps.PromiseCtor<NetworkRequest>((resolve, reject) => {
      let timer: unknown;
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        deps.removeListener(onMessage);
        if (timer !== undefined) deps.clearTimer?.(timer);
        fn();
      };

      const fail = (message: string, name = "Error") =>
        settle(() => reject(deps.clone({ message, name })));

      const onMessage = (e: MessageEvent<ContentMessage>) => {
        if (!deps.isOwnSource(e) || !e.data) return;
        if ("uid" in e.data && e.data.uid !== uid) return;
        if (e.data.type !== "infogata-extension-response") return;

        const { result, error } = e.data;
        if (error) {
          fail(error.message, error.name ?? "Error");
          return;
        }
        if (!result) {
          fail("The extension returned no response");
          return;
        }
        settle(() => resolve(deps.clone(result)));
      };

      deps.addListener(onMessage);

      // A backstop for a message that never arrives at all — a dead service
      // worker, or a content script that was torn down mid-request.
      const timeoutMs = deps.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      if (deps.setTimer && timeoutMs > 0) {
        timer = deps.setTimer(
          () => fail(`The request to ${input} received no response`, "TimeoutError"),
          timeoutMs
        );
      }

      const send = (serializedInit?: SerializableRequestInit) => {
        if (settled) return;
        deps.sendMessage({
          type: "infogata-extension-request",
          input,
          init: serializedInit,
          uid,
          options,
        });
      };

      if (!init) {
        send();
        return;
      }

      // Serializing a Blob body is asynchronous, so it cannot happen before the
      // promise above exists. Anything it throws has to reject that promise
      // rather than escape into an unhandled rejection, which is the other way
      // a caller ends up waiting forever.
      Promise.resolve()
        .then(() => deps.serializeBody(init.body))
        .then(({ body, bodyIsBase64 }) => {
          send({
            headers: init.headers,
            mode: init.mode,
            method: init.method,
            credentials: init.credentials,
            body,
            bodyIsBase64,
          });
        })
        .catch((error: any) =>
          fail(String(error?.message ?? error ?? "Could not serialize the request body"))
        );
    });
  };
};
