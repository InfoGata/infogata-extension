import { browser } from "webextension-polyfill-ts";
import { LoginMessage } from "./types";

browser.runtime.onMessage.addListener((message: LoginMessage) => {
  if (message.type === "login-button") {
    const element = document.querySelector(message.selector);
    if (element instanceof HTMLElement) {
      element.click();
    }
  }
});
