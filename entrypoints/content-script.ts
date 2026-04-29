import {
  ContentMessage,
  NetworkRequest,
  HookMessage,
  HandleRequestResponse,
  HookRequest,
  BackgroundMessage,
  HookOpenLogin,
  TabMessage,
  HookGetVersion,
  HookRegisterRedirects,
  TabShowRedirectBanner,
  SiteRedirectRule,
} from "../src/types";

export default defineUnlistedScript(() => {

    console.log("InfoGata extension initialized");

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

    const makeNetworkRequest = async (request: HookRequest) => {
      const response: HandleRequestResponse = await sendMessageToBackground({
        type: "network-request",
        input: request.input,
        init: request.init,
        options: request.options,
      });

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
    function descructor() {
      document.removeEventListener(destructionEvent, descructor);
      window.removeEventListener("message", onHookMessage);
    }
    const destructionEvent = "destructmyextension_" + browser.runtime.id;
    document.dispatchEvent(new CustomEvent(destructionEvent));
    document.addEventListener(destructionEvent, descructor);

    const showRedirectBanner = (rule: SiteRedirectRule, redirectUrl: string) => {
      const existingBanner = document.getElementById("infogata-redirect-banner-host");
      if (existingBanner) return;

      const host = document.createElement("div");
      host.id = "infogata-redirect-banner-host";
      const shadow = host.attachShadow({ mode: "closed" });

      const style = document.createElement("style");
      style.textContent = `
        .banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 10px 16px;
          background: #1a1a2e;
          color: #e0e0e0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          animation: slideDown 0.3s ease-out;
        }
        @keyframes slideDown {
          from { transform: translateY(-100%); }
          to { transform: translateY(0); }
        }
        @keyframes slideUp {
          from { transform: translateY(0); }
          to { transform: translateY(-100%); }
        }
        .banner.dismissing {
          animation: slideUp 0.3s ease-in forwards;
        }
        .text { flex: 1; text-align: center; }
        .app-name { font-weight: 600; color: #31c48d; }
        .btn {
          padding: 6px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        }
        .btn-open {
          background: #31c48d;
          color: #1a1a2e;
        }
        .btn-open:hover { background: #28a876; }
        .btn-dismiss {
          background: transparent;
          color: #888;
          padding: 6px 8px;
          font-size: 18px;
          line-height: 1;
        }
        .btn-dismiss:hover { color: #ccc; }
        .btn-permanent {
          background: transparent;
          color: #666;
          font-size: 12px;
          text-decoration: underline;
          padding: 4px 8px;
        }
        .btn-permanent:hover { color: #999; }
      `;

      const banner = document.createElement("div");
      banner.className = "banner";
      banner.innerHTML = `
        <span class="text">View this in <span class="app-name">${rule.appName}</span> with <strong>${rule.pluginName}</strong></span>
        <button class="btn btn-open">Open</button>
        <button class="btn btn-permanent">Don't show again</button>
        <button class="btn btn-dismiss">\u00d7</button>
      `;

      const dismiss = (permanent: boolean) => {
        banner.classList.add("dismissing");
        banner.addEventListener("animationend", () => host.remove());
        if (permanent) {
          sendMessageToBackground({
            type: "dismiss-redirect",
            ruleKey: `${rule.appOrigin}::${rule.pluginId}`,
          });
        }
      };

      banner.querySelector(".btn-open")!.addEventListener("click", () => {
        window.location.href = redirectUrl;
      });
      banner.querySelector(".btn-dismiss")!.addEventListener("click", () => dismiss(false));
      banner.querySelector(".btn-permanent")!.addEventListener("click", () => dismiss(true));

      shadow.appendChild(style);
      shadow.appendChild(banner);
      document.documentElement.appendChild(host);

      setTimeout(() => {
        if (host.isConnected) dismiss(false);
      }, 15000);
    };

    browser.runtime.onMessage.addListener((message: TabMessage) => {
      if (message.type === "notify-login") {
        sendMessageToHook({
          type: "infogata-extension-notify-login",
          pluginId: message.pluginId,
          headers: message.headers,
          domainHeaders: message.domainHeaders,
        });
      }
      if (message.type === "show-redirect-banner") {
        showRedirectBanner(message.rule, message.redirectUrl);
      }
    });
});