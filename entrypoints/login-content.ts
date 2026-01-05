import { LoginMessage } from "@/src/types";

export default defineUnlistedScript(() => {
  browser.runtime.onMessage.addListener((message: LoginMessage) => {
    if (message.type === "login-button") {
      const element = document.querySelector(message.selector);
      if (element instanceof HTMLElement) {
        element.click();
      }
    }
  });
});