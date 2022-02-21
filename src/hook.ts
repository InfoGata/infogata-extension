import { HookMessageType } from "./types";
console.log("Initilizing hook");

(window as any).MediaGata = {
  networkRequest: (input: RequestInfo, init?: RequestInit) => {
    return new Promise((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        if (e.source !== window || !e.data) {
          return;
        }
        console.log(e.data);
        if (e.data.type === HookMessageType.Response) {
          if (e.data.error) {
            reject(e.data.error);
          }
          if (e.data.result) {
            resolve(e.data.result);
          }
          window.removeEventListener("message", onMessage);
        }
      };
      window.addEventListener("message", onMessage);

      if (init) {
        init = {
          headers: init.headers,
          mode: init.mode,
          method: init.method,
          signal: init.signal,
          credentials: init.credentials,
          body: init.body,
        };
      }
      window.postMessage({ type: HookMessageType.Request, input, init }, "*");
    });
  },
};
