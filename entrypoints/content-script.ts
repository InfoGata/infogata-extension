import type {
  ContentMessage,
  NetworkRequest,
  HookMessage,
  HandleRequestResult,
  HookRequest,
  BackgroundMessage,
  HookOpenLogin,
  TabMessage,
  HookGetVersion,
  HookMintPoToken,
  MintPoTokenResult,
} from "../src/types";

export default defineUnlistedScript(() => {

    if (import.meta.env.DEV) {
      console.log("InfoGata extension initialized");
    }

    const sendMessageToBackground = async (
      message: BackgroundMessage
    ): Promise<any> => {
      return await browser.runtime.sendMessage(message);
    };

    const injectScript = () => {
      sendMessageToBackground({ type: "execute-hook" });
    };

    injectScript();

    const sendMessageToHook = (message: ContentMessage) => {
      window.postMessage(message);
    };

    const base64ToBlob = async (base64: string): Promise<Blob> => {
      const response = await fetch(base64);
      return await response.blob();
    };

    /**
     * Answers the page exactly once, whatever happens. A request that goes
     * unanswered leaves the page awaiting a promise that never settles, which
     * surfaces as an app that loads forever rather than one that reports a
     * problem.
     */
    const makeNetworkRequest = async (request: HookRequest) => {
      try {
        const response: HandleRequestResult = await sendMessageToBackground({
          type: "network-request",
          input: request.input,
          init: request.init,
          options: request.options,
        });

        if (!response) {
          throw new Error("The extension returned no response");
        }
        if ("error" in response) {
          throw Object.assign(new Error(response.error.message), {
            name: response.error.name ?? "Error",
          });
        }

        let body =
          typeof response.base64 === "string"
            ? await base64ToBlob(response.base64)
            : response.base64;

        let result: NetworkRequest = {
          body: body,
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
        };

        sendMessageToHook({
          type: "infogata-extension-response",
          result,
          uid: request.uid,
        });
      } catch (error: any) {
        sendMessageToHook({
          type: "infogata-extension-response",
          error: {
            message: String(error?.message ?? error ?? "Request failed"),
            name: error?.name,
          },
          uid: request.uid,
        });
      }
    };

    const openWindow = (request: HookOpenLogin) => {
      sendMessageToBackground({
        type: "open-login",
        auth: request.auth,
        pluginId: request.pluginId,
      });
    };

    const getVersion = (request: HookGetVersion) => {
      sendMessageToHook({
        type: "infogata-extension-getversion-content",
        uid: request.uid,
        result: browser.runtime.getManifest().version,
      });
    };

    /** Answers the page exactly once, like makeNetworkRequest. */
    const mintPoToken = async (request: HookMintPoToken) => {
      try {
        const response: MintPoTokenResult | undefined = await sendMessageToBackground({
          type: "mint-po-token",
          origin: request.origin,
          contentBinding: request.contentBinding,
          overrides: request.overrides,
        });
        if (!response) {
          throw new Error("The extension returned no response");
        }
        sendMessageToHook({
          type: "infogata-extension-mint-po-token-content",
          uid: request.uid,
          ...("error" in response ? { error: response.error } : { token: response.token }),
        });
      } catch (error: any) {
        sendMessageToHook({
          type: "infogata-extension-mint-po-token-content",
          uid: request.uid,
          error: {
            message: String(error?.message ?? error ?? "Minting failed"),
            name: error?.name,
          },
        });
      }
    };

    // The minter frame sits in the app's page, but only the background creates
    // it or runs anything in it; the page just gets tokens back.
    let poFrame: HTMLIFrameElement | undefined;

    const createPoFrame = (url: string): Promise<boolean> => {
      poFrame?.remove();
      const frame = document.createElement("iframe");
      frame.src = url;
      frame.style.display = "none";
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      poFrame = frame;
      return new Promise((resolve) => {
        // A frame that fails still fires load, so this only guards a hang.
        const timer = setTimeout(() => resolve(false), 30_000);
        frame.addEventListener("load", () => {
          clearTimeout(timer);
          resolve(true);
        }, { once: true });
        (document.body ?? document.documentElement).appendChild(frame);
      });
    };

    const removePoFrame = () => {
      poFrame?.remove();
      poFrame = undefined;
    };

    const onHookMessage = async (e: MessageEvent<HookMessage>) => {
      if (e.source !== window || !e.data) {
        return;
      }

      switch (e.data.type) {
        case "infogata-extension-openlogin-hook":
          openWindow(e.data);
          break;
        case "infogata-extension-request":
          await makeNetworkRequest(e.data);
          break;
        case "infogata-extension-getversion-hook":
          getVersion(e.data);
          break;
        case "infogata-extension-mint-po-token-hook":
          await mintPoToken(e.data);
          break;
        case "infogata-extension-register-redirects":
          sendMessageToBackground({
            type: "register-redirects",
            rules: e.data.rules,
          });
          break;
      }
    };

    window.addEventListener("message", onHookMessage);


    // Unload previous content script
    function destructor() {
      document.removeEventListener(destructionEvent, destructor);
      window.removeEventListener("message", onHookMessage);
      removePoFrame();
    }
    const destructionEvent = "destructmyextension_" + browser.runtime.id;
    document.dispatchEvent(new CustomEvent(destructionEvent));
    document.addEventListener(destructionEvent, destructor);

    browser.runtime.onMessage.addListener((message: TabMessage) => {
      if (message.type === "create-po-frame") {
        return createPoFrame(message.url);
      }
      if (message.type === "remove-po-frame") {
        removePoFrame();
        return;
      }
      if (message.type === "notify-login") {
        sendMessageToHook({
          type: "infogata-extension-notify-login",
          pluginId: message.pluginId,
          headers: message.headers,
          domainHeaders: message.domainHeaders,
        });
      }
    });
});