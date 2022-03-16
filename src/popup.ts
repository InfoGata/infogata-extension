import { html, render } from "lit-html";
import { browser } from "webextension-polyfill-ts";
import { DEFAULT_ORIGIN_LIST } from "./defaultOrigns";
import { unsafeSVG } from "lit-html/directives/unsafe-svg";

const fs = require("fs");

const ICON_ADD = fs.readFileSync(__dirname + "/add-icon.svg", "utf8");
const ICON_DELETE = fs.readFileSync(__dirname + "/delete-icon.svg", "utf8");
const ICON_ERROR = fs.readFileSync(__dirname + "/error-icon.svg", "utf8");

const defaultOrigins = DEFAULT_ORIGIN_LIST;
let origins = [""];

let inputText = "";
let placeholderURL = "https://elijahgreen.gitlab.io/audiogata";
let errorMessage = "";

const getOrigins = async () => {
  const items = await browser.storage.local.get(["origins"]);

  if (!items) {
    await storeOrigins(defaultOrigins);
    return defaultOrigins;
  }
  return JSON.parse(items.origins);
};

const storeOrigins = async (origins: string[]) => {
  await browser.storage.local.set({ origins: JSON.stringify(origins) });
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

const page = () => html`
  ${inputField(inputText, onInputTextChange, onAddClick)}
  ${errorField(errorMessage)} ${originList(origins, onDeleteOriginClicked)}
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

const init = async () => {
  origins = await getOrigins();

  try {
    const activeTabs = await browser.tabs.query({ active: true });
    if (activeTabs[0].url) {
      if (activeTabs[0].url.startsWith("http")) {
        const url = new URL(activeTabs[0].url);
        if (url && url.origin) {
          placeholderURL = url.origin;
          inputText = url.origin;
        }
      }
    }
  } catch {}

  render(page(), document.body);
};

init();
