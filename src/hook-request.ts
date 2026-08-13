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
  return async (
    input: string,
    init?: RequestInit,
    options?: NetworkRequestOptions
  ): Promise<NetworkRequest> => {
    // Serialized up front so the promise executor below stays synchronous: an
    // async executor swallows anything it throws, which is another way to end up
    // with a promise that never settles.
    let serializedInit: SerializableRequestInit | undefined;
    if (init) {
      const { body, bodyIsBase64 } = await deps.serializeBody(init.body);
      serializedInit = {
        headers: init.headers,
        mode: init.mode,
        method: init.method,
        credentials: init.credentials,
        body,
        bodyIsBase64,
      };
    }

    const uid = deps.nextUid();

    return new deps.PromiseCtor<NetworkRequest>((resolve, reject) => {
      let timer: unknown;

      const settle = (fn: () => void) => {
        deps.removeListener(onMessage);
        if (timer !== undefined) deps.clearTimer?.(timer);
        fn();
      };

      const onMessage = (e: MessageEvent<ContentMessage>) => {
        if (!deps.isOwnSource(e) || !e.data) return;
        if ("uid" in e.data && e.data.uid !== uid) return;
        if (e.data.type !== "infogata-extension-response") return;

        const { result, error } = e.data;
        if (error) {
          settle(() =>
            reject(
              deps.clone({
                message: error.message,
                name: error.name ?? "Error",
              })
            )
          );
          return;
        }
        if (!result) {
          settle(() =>
            reject(deps.clone({ message: "The extension returned no response" }))
          );
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
          () =>
            settle(() =>
              reject(
                deps.clone({
                  message: `The request to ${input} received no response`,
                  name: "TimeoutError",
                })
              )
            ),
          timeoutMs
        );
      }

      deps.sendMessage({
        type: "infogata-extension-request",
        input,
        init: serializedInit,
        uid,
        options,
      });
    });
  };
};
