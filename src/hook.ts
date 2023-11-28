import {
  ContentMessage,
  HookMessage,
  ManifestAuthentication,
  NetworkRequest,
  NetworkRequestOptions,
} from "./types";
import { cloneInto } from "@emoji-gen/clone-into";

console.log("Initilizing hook");

let messageId = 0;
const getMessageId = () => {
  return ++messageId;
};

const sendMessage = (message: HookMessage) => {
  window.postMessage(message, "*");
};

const InfoGata = {
  networkRequest: (
    input: RequestInfo,
    init?: RequestInit,
    options?: NetworkRequestOptions
  ): Promise<NetworkRequest> => {
    return new window.Promise((resolve, _reject) => {
      const uid = getMessageId();
      const onMessage = (e: MessageEvent<ContentMessage>) => {
        if (e.source !== window || !e.data || e.data.uid !== uid) {
          return;
        }

        if (e.data.type === "infogata-extension-response") {
          if (e.data.result) {
            resolve(cloneInto(e.data.result, window));
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

      sendMessage({
        type: "infogata-extension-request",
        input,
        init,
        uid,
        options,
      });
    });
  },
  openLoginWindow: (auth: ManifestAuthentication, pluginId: string) => {
    sendMessage({ type: "infogata-extension-openlogin-hook", auth, pluginId });
  },
};

(window as any).InfoGata = InfoGata;

if ((window as any).wrappedJSObject) {
  (window as any).wrappedJSObject.InfoGata = cloneInto(InfoGata, window, {
    cloneFunctions: true,
    wrapReflectors: false,
  });
}
