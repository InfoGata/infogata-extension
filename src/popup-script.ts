import { html, render } from "lit-html";
import { unsafeSVG } from "lit-html/directives/unsafe-svg.js";
import { DEFAULT_ORIGIN_LIST } from "./defaultOrigns";
import { getRuleKey } from "./redirect-utils";
import { getActiveTabOrigin } from "./tab-utils";
import { RedirectPreferences, SiteRedirectRule } from "./types";

// Import CSS
import "./popup.css";

// Import SVG assets
import addIconSvg from "../assets/add-icon.svg?raw";
import deleteIconSvg from "../assets/delete-icon.svg?raw";
import errorIconSvg from "../assets/error-icon.svg?raw";

const ICON_ADD = addIconSvg;
const ICON_DELETE = deleteIconSvg;
const ICON_ERROR = errorIconSvg;

const defaultOrigins = DEFAULT_ORIGIN_LIST;
let origins = [""];
let redirectRules: SiteRedirectRule[] = [];
let redirectPreferences: RedirectPreferences = {
  globalEnabled: true,
  dismissedRuleKeys: [],
  defaultOrigins: {},
};

let inputText = "";
let placeholderURL = "https://www.audiogata.com";
let errorMessage = "";

const getOrigins = async () => {
  const items = await browser.storage.local.get(["origins"]);

  if (!items || !items.origins) {
    await storeOrigins(defaultOrigins);
    return defaultOrigins;
  }
  return JSON.parse(items.origins as string);
};

const storeOrigins = async (origins: string[]) => {
  await browser.storage.local.set({ origins: JSON.stringify(origins) });
};

const onOpenDebugPage = () => {
  const getURL = browser.runtime.getURL as (path: string) => string;
  browser.tabs.create({ url: getURL("/debug.html") });
};

const onAddClick = (event: MouseEvent) => {
  event.preventDefault();

  try {
    const parsedURL = new URL(inputText);

    if (origins.includes(parsedURL.origin)) {
      errorMessage = "Origin is already on the list";
      render(page(), document.body);
    } else {
      origins.push(parsedURL.origin);
      inputText = "";

      storeOrigins(origins);

      errorMessage = "";

      render(page(), document.body);
    }
  } catch (e) {
    errorMessage = "Improper URL";
    render(page(), document.body);
  }
};

const onInputTextChange = (ev: InputEvent) => {
  inputText = (ev.target as HTMLInputElement).value;

  errorMessage = "";

  render(page(), document.body);
};

const onDeleteOriginClicked = async (index: number) => {
  origins.splice(index, 1);
  await storeOrigins(origins);

  render(page(), document.body);
};

const onSetDefaultOrigin = async (pluginId: string, appOrigin: string) => {
  redirectPreferences.defaultOrigins = {
    ...(redirectPreferences.defaultOrigins ?? {}),
    [pluginId]: appOrigin,
  };
  await browser.runtime.sendMessage({
    type: "set-default-redirect-origin",
    pluginId,
    appOrigin,
  });
  render(page(), document.body);
};

const onToggleRedirects = async () => {
  redirectPreferences.globalEnabled = !redirectPreferences.globalEnabled;
  await browser.runtime.sendMessage({
    type: "set-redirect-enabled",
    enabled: redirectPreferences.globalEnabled,
  });
  render(page(), document.body);
};

const onUndismissRule = async (ruleKey: string) => {
  redirectPreferences.dismissedRuleKeys =
    redirectPreferences.dismissedRuleKeys.filter((k) => k !== ruleKey);
  await browser.runtime.sendMessage({
    type: "undismiss-redirect",
    ruleKey,
  });
  render(page(), document.body);
};

const onDeleteRule = async (ruleKey: string) => {
  redirectRules = redirectRules.filter((rule) => getRuleKey(rule) !== ruleKey);
  redirectPreferences.dismissedRuleKeys =
    redirectPreferences.dismissedRuleKeys.filter((k) => k !== ruleKey);
  await browser.runtime.sendMessage({
    type: "delete-redirect",
    ruleKey,
  });
  render(page(), document.body);
};

const onDismissRule = async (ruleKey: string) => {
  if (!redirectPreferences.dismissedRuleKeys.includes(ruleKey)) {
    redirectPreferences.dismissedRuleKeys.push(ruleKey);
  }
  await browser.runtime.sendMessage({
    type: "dismiss-redirect",
    ruleKey,
  });
  render(page(), document.body);
};

const groupRulesByPlugin = (
  rules: SiteRedirectRule[]
): { pluginId: string; pluginName: string; rules: SiteRedirectRule[] }[] => {
  const groups: {
    pluginId: string;
    pluginName: string;
    rules: SiteRedirectRule[];
  }[] = [];
  for (const rule of rules) {
    let group = groups.find((g) => g.pluginId === rule.pluginId);
    if (!group) {
      group = { pluginId: rule.pluginId, pluginName: rule.pluginName, rules: [] };
      groups.push(group);
    }
    group.rules.push(rule);
  }
  return groups;
};

const redirectEntry = (
  rule: SiteRedirectRule,
  showDefaultRadio: boolean,
  isDefault: boolean
) => {
  const key = getRuleKey(rule);
  const isDismissed = redirectPreferences.dismissedRuleKeys.includes(key);
  return html`
    <li class="origin-list-entry redirect-entry ${isDismissed ? "dismissed" : ""}">
      ${showDefaultRadio
        ? html`<input
            class="redirect-default-radio"
            type="radio"
            name="default-${rule.pluginId}"
            title="Use this site by default"
            .checked=${isDefault}
            @change=${() => onSetDefaultOrigin(rule.pluginId, rule.appOrigin)}
          />`
        : html``}
      <div class="redirect-info">
        <span class="redirect-app-name">${rule.appName}</span>
        <span class="redirect-app-origin">${rule.appOrigin}</span>
      </div>
      <div class="redirect-actions">
        ${isDismissed
          ? html`<button class="redirect-toggle-btn" @click=${() => onUndismissRule(key)}>Enable</button>`
          : html`<button class="redirect-toggle-btn redirect-toggle-dismiss" @click=${() => onDismissRule(key)}>Disable</button>`
        }
        <button class="origin-delete" title="Remove redirect" @click=${() => onDeleteRule(key)}>
          ${unsafeSVG(ICON_DELETE)}
        </button>
      </div>
    </li>
  `;
};

const redirectSection = () => {
  if (redirectRules.length === 0) return html``;

  const groups = groupRulesByPlugin(redirectRules);

  return html`
    <div class="redirect-section">
      <div class="redirect-header">
        <label class="origin-input-label">Site Redirects</label>
        <label class="toggle-label">
          <input
            type="checkbox"
            .checked=${redirectPreferences.globalEnabled}
            @change=${onToggleRedirects}
          />
          <span class="toggle-text">${redirectPreferences.globalEnabled ? "On" : "Off"}</span>
        </label>
      </div>
      ${groups.map((group) => {
        const hasMultiple = group.rules.length > 1;
        const defaultOrigin =
          redirectPreferences.defaultOrigins?.[group.pluginId];
        return html`
          <div class="redirect-group">
            <div class="redirect-plugin-name">${group.pluginName}</div>
            <ul class="origin-list">
              ${group.rules.map((rule, i) => {
                const isDefault = defaultOrigin
                  ? defaultOrigin === rule.appOrigin
                  : i === 0;
                return redirectEntry(rule, hasMultiple, isDefault);
              })}
            </ul>
          </div>
        `;
      })}
    </div>
  `;
};

const page = () => html`
  ${import.meta.env.DEV ? debugButton(onOpenDebugPage) : ""}
  ${inputField(inputText, onInputTextChange, onAddClick)}
  ${errorField(errorMessage)} ${originList(origins, onDeleteOriginClicked)}
  ${redirectSection()}
`;

const debugButton = (onClick: () => void) => html`
  <div class="debug-button-wrapper">
    <button class="debug-button" @click=${onClick}>
      <span>🔧 Open Debug Page</span>
    </button>
  </div>
`;

const errorField = (error: string) => html`
  ${error.length > 0
    ? html`
        <div class="err">
          ${unsafeSVG(ICON_ERROR)}
          <span class="err-text"> ${error} </span>
        </div>
      `
    : html``}
`;

const inputField = (
  inputText: string,
  onInputTextChange: (ev: InputEvent) => void,
  onAddClick: (ev: MouseEvent) => void
) => html`
  <form novalidate class="origin-input-box">
    <label class="origin-input-label" for="origin-input">Enter new origin</label>
    <div class="origin-input-wrapper">
      <input id="origin-input" required placeholder="${placeholderURL}" class="origin-input" .value=${inputText} @input=${onInputTextChange}></input>
      <button class="origin-add" type="submit" @click=${onAddClick}>
        ${unsafeSVG(ICON_ADD)}
        <span class="button-text">Add</span>
      </button>
    </div>
  </form>
`;

const originList = (
  origins: string[],
  onDeleteClicked: (index: number) => void
) => html`
  <label class="origin-input-label">Active origins</label>
  <ul class="origin-list">
    ${origins.map(
      (origin, i) => html`
        <li class="origin-list-entry">
          <span class="origin-list-entry-origin">${origin}</span>
          <button class="origin-delete" @click=${() => onDeleteClicked(i)}>
            ${unsafeSVG(ICON_DELETE)}
          </button>
        </li>
      `
    )}
  </ul>
`;


const getRedirectData = async () => {
  try {
    const response = await browser.runtime.sendMessage({
      type: "get-redirect-rules",
    });
    if (response) {
      redirectRules = response.rules || [];
      redirectPreferences = response.preferences || {
        globalEnabled: true,
        dismissedRuleKeys: [],
        defaultOrigins: {},
      };
    }
  } catch {
    // Background script may not be available (e.g., in tests)
  }
};

const init = async () => {
  origins = await getOrigins();

  const { placeholderURL: newPlaceholder, inputText: newInputText } = await getActiveTabOrigin();
  placeholderURL = newPlaceholder;
  inputText = newInputText;

  await getRedirectData();

  render(page(), document.body);
};

init();