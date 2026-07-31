// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";

vi.mock("../src/popup.css", () => ({}));
vi.mock("../assets/add-icon.svg?raw", () => ({ default: "<svg>add</svg>" }));
vi.mock("../assets/delete-icon.svg?raw", () => ({ default: "<svg>delete</svg>" }));
vi.mock("../assets/error-icon.svg?raw", () => ({ default: "<svg>error</svg>" }));

/** Boots the popup with a given stored theme, returns the rendered select. */
const renderPopup = async (stored?: string) => {
  vi.resetModules();
  fakeBrowser.reset();
  document.documentElement.removeAttribute("data-theme");
  // A fresh body element, not innerHTML = "": lit caches its render part on the
  // container, and wiping innerHTML ejects the marker nodes it expects.
  document.documentElement.replaceChild(
    document.createElement("body"),
    document.body
  );

  if (stored !== undefined) {
    await fakeBrowser.storage.local.set({ theme: stored });
  }
  vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([] as never);

  await import("../src/popup-script");
  // init() is async; let its promise chain settle before asserting on the DOM.
  await vi.waitFor(() =>
    expect(document.querySelector(".theme-select")).toBeTruthy()
  );
  return document.querySelector<HTMLSelectElement>(".theme-select")!;
};

const theme = () => document.documentElement.getAttribute("data-theme");

const select = async (element: HTMLSelectElement, value: string) => {
  element.value = value;
  element.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(fakeBrowser.storage.local.get("theme")).resolves.toEqual({
      theme: value,
    })
  );
};

describe("popup theme preference", () => {
  beforeEach(() => {
    window.close = vi.fn();
  });

  it("defaults to system and leaves the theme unpinned", async () => {
    const element = await renderPopup();

    expect(element.value).toBe("system");
    expect(theme()).toBeNull();
  });

  it("pins a stored light preference on the document", async () => {
    const element = await renderPopup("light");

    expect(element.value).toBe("light");
    expect(theme()).toBe("light");
  });

  it("pins a stored dark preference on the document", async () => {
    const element = await renderPopup("dark");

    expect(element.value).toBe("dark");
    expect(theme()).toBe("dark");
  });

  it("falls back to system when the stored value is not a theme", async () => {
    const element = await renderPopup("neon");

    expect(element.value).toBe("system");
    expect(theme()).toBeNull();
  });

  it("applies and persists a newly chosen theme", async () => {
    const element = await renderPopup();

    await select(element, "dark");

    expect(theme()).toBe("dark");
  });

  it("unpins the theme when switching back to system", async () => {
    const element = await renderPopup("light");

    await select(element, "system");

    expect(theme()).toBeNull();
  });
});
