import { html, render } from "lit-html";
import { applyTheme, getThemePreference } from "./theme";
import type { ConsentKind } from "./types";

import "./consent.css";

/**
 * The window the background opens before a plugin is allowed to borrow the
 * user's login. Everything it displays arrives as query parameters and is
 * rendered as text by lit-html, never as markup -- the host and the requesting
 * origin are both attacker-chosen strings.
 */

const params = new URLSearchParams(window.location.search);
const id = params.get("id") ?? "";
const kind = (params.get("kind") ?? "request") as ConsentKind;
const requester = params.get("requester") ?? "an InfoGata app";
const hosts = (params.get("hosts") ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const detail = params.get("detail") ?? "";

let decided = false;

const decide = async (allowed: boolean) => {
  if (decided) return;
  decided = true;
  try {
    await browser.runtime.sendMessage({
      type: "consent-decision",
      id,
      allowed,
      hosts,
    });
  } catch (e) {
    console.warn("[InfoGata] Unable to deliver consent decision:", e);
  }
  window.close();
};

const lede = () => {
  if (kind === "login") {
    return html`A plugin on <span class="consent-requester">${requester}</span>
      wants to sign you in to:`;
  }
  if (kind === "page-context") {
    return html`A plugin on <span class="consent-requester">${requester}</span>
      wants to load pages in the background from:`;
  }
  return html`A plugin on <span class="consent-requester">${requester}</span>
    wants to use your login for:`;
};

const warning = () => {
  if (kind === "login") {
    return html`InfoGata will open a login window and capture the credentials
      that site issues, so the plugin can keep acting as you there.`;
  }
  if (kind === "page-context") {
    // Worth spelling out: this is the only consent that keeps a tab around.
    return html`That site refuses requests unless they come from one of its own
      pages, so InfoGata will keep a background tab open on it and read pages
      through that tab as you. The tab closes when it goes unused.`;
  }
  return html`This lets it read pages on that site as you, including anything
    private to your account.`;
};

const page = () => html`
  <h1 class="consent-title">Allow access?</h1>
  <p class="consent-lede">${lede()}</p>
  <ul class="consent-hosts">
    ${hosts.map((host) => html`<li class="consent-host">${host}</li>`)}
  </ul>
  <p class="consent-warning">${warning()}</p>
  ${detail ? html`<p class="consent-detail">${detail}</p>` : html``}
  <div class="consent-actions">
    <button class="consent-button consent-allow" @click=${() => decide(true)}>
      Allow
    </button>
    <button class="consent-button" @click=${() => decide(false)}>Deny</button>
  </div>
  <p class="consent-footnote">
    Your choice is remembered. Review or revoke it in the InfoGata popup.
  </p>
`;

const init = async () => {
  applyTheme(await getThemePreference());
  render(page(), document.body);
};

init();
