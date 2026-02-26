import {
  ContentMessage,
  HookMessage,
  ManifestAuthentication,
  NetworkRequest,
  NetworkRequestOptions,
  SerializableRequestInit,
} from "../src/types";
import { cloneInto } from "@emoji-gen/clone-into";

export default defineUnlistedScript(() => {
  console.log("Initilizing hook");

  let messageId = 0;
  const getMessageId = () => {
    return ++messageId;
  };

  const sendMessage = (message: HookMessage) => {
    window.postMessage(message, "*");
  };

  /**
   * Convert a Blob to a base64 data URL string
   */
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new window.Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  /**
   * Convert request body to a serializable format (base64 string)
   */
  const serializeBody = async (
    body: BodyInit | null | undefined
  ): Promise<{ body?: string; bodyIsBase64: boolean }> => {
    if (!body) {
      return { body: undefined, bodyIsBase64: false };
    }

    // Handle Blob
    if (body instanceof Blob) {
      const base64 = await blobToBase64(body);
      return { body: base64, bodyIsBase64: true };
    }

    // Handle ArrayBuffer
    if (body instanceof ArrayBuffer) {
      const blob = new Blob([body]);
      const base64 = await blobToBase64(blob);
      return { body: base64, bodyIsBase64: true };
    }

    // Handle Uint8Array and other TypedArrays
    if (ArrayBuffer.isView(body)) {
      const blob = new Blob([body]);
      const base64 = await blobToBase64(blob);
      return { body: base64, bodyIsBase64: true };
    }

    // Handle string
    if (typeof body === "string") {
      return { body, bodyIsBase64: false };
    }

    // Handle URLSearchParams
    if (body instanceof URLSearchParams) {
      return { body: body.toString(), bodyIsBase64: false };
    }

    // Handle FormData - convert to string representation
    if (body instanceof FormData) {
      // FormData can't be easily serialized, convert to URLSearchParams format
      const params = new URLSearchParams();
      body.forEach((value, key) => {
        if (typeof value === "string") {
          params.append(key, value);
        }
      });
      return { body: params.toString(), bodyIsBase64: false };
    }

    // Fallback: try to convert to string
    return { body: String(body), bodyIsBase64: false };
  };

  const InfoGata = {
    getVersion: (): Promise<string> => {
      return new window.Promise((resolve, _reject) => {
        const uid = getMessageId();
        const onMessage = (e: MessageEvent<ContentMessage>) => {
          if (e.source !== window || !e.data || ('uid' in e.data && e.data.uid !== uid)) {
            return;
          }

          if (e.data.type === "infogata-extension-getversion-content") {
            if (e.data.result) {
              resolve(e.data.result);
            }
            window.removeEventListener("message", onMessage);
          }
        };
        window.addEventListener("message", onMessage);

        sendMessage({ type: "infogata-extension-getversion-hook", uid });
      });
    },
    networkRequest: (
      input: string,
      init?: RequestInit,
      options?: NetworkRequestOptions
    ): Promise<NetworkRequest> => {
      return new window.Promise(async (resolve, _reject) => {
        const uid = getMessageId();
        const onMessage = (e: MessageEvent<ContentMessage>) => {
          if (e.source !== window || !e.data || ('uid' in e.data && e.data.uid !== uid)) {
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

        let serializedInit: SerializableRequestInit | undefined;
        if (init) {
          // Serialize the body to base64 if it's binary data
          const { body, bodyIsBase64 } = await serializeBody(init.body);

          serializedInit = {
            headers: init.headers,
            mode: init.mode,
            method: init.method,
            credentials: init.credentials,
            body,
            bodyIsBase64,
          };
        }

        sendMessage({
          type: "infogata-extension-request",
          input,
          init: serializedInit,
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
});