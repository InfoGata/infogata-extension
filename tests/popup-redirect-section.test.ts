// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { SiteRedirectRule } from "../src/types";

vi.mock("../src/popup.css", () => ({}));
vi.mock("../assets/add-icon.svg?raw", () => ({ default: "<svg>add</svg>" }));
vi.mock("../assets/delete-icon.svg?raw", () => ({ default: "<svg>delete</svg>" }));
vi.mock("../assets/error-icon.svg?raw", () => ({ default: "<svg>error</svg>" }));

const rule = (overrides: Partial<SiteRedirectRule> = {}): SiteRedirectRule => ({
  pluginId: "reddit-plugin",
  pluginName: "Reddit Plugin",
  appName: "SocialGata",
  appOrigin: "https://www.socialgata.com",
  siteMatchPatterns: ["https://www.reddit.com/*"],
  redirectPath: "/plugins/reddit-plugin/feed",
  patternRedirects: [
    {
      pattern: "https://*.reddit.com/r/:community{/*}?",
      redirectPath: "/plugins/reddit-plugin/community/:community",
    },
  ],
  ...overrides,
});

/** Boots the popup with a given active tab + background state, returns the rendered body. */
const renderPopup = async (
  tabUrl: string,
  rules: SiteRedirectRule[],
  preferences: Record<string, unknown>
) => {
  vi.resetModules();
  fakeBrowser.reset();
  // A fresh body element, not innerHTML = "": lit caches its render part on the
  // container, and wiping innerHTML ejects the marker nodes it expects.
  document.documentElement.replaceChild(
    document.createElement("body"),
    document.body
  );

  vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([
    { id: 42, url: tabUrl },
  ] as never);
  vi.spyOn(fakeBrowser.runtime, "sendMessage").mockImplementation((async (
    message: { type: string }
  ) => {
    if (message.type === "get-redirect-rules") return { rules, preferences };
    return undefined;
  }) as never);
  const update = vi
    .spyOn(fakeBrowser.tabs, "update")
    .mockResolvedValue({} as never);

  await import("../src/popup-script");
  // init() is async; let its promise chain settle before asserting on the DOM.
  await vi.waitFor(() =>
    expect(document.querySelector(".origin-input")).toBeTruthy()
  );
  return { update };
};

const ctas = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".redirect-cta")];

describe("popup current-page redirect section", () => {
  beforeEach(() => {
    window.close = vi.fn();
  });

  it("offers the matching app and navigates the current tab on click", async () => {
    const { update } = await renderPopup(
      "https://www.reddit.com/r/bald",
      [rule()],
      { globalEnabled: true, dismissedRuleKeys: [] }
    );

    expect(ctas()).toHaveLength(1);
    expect(ctas()[0].textContent).toContain("SocialGata");

    ctas()[0].click();
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(42, {
      url: "https://www.socialgata.com/plugins/reddit-plugin/community/bald",
    });
  });

  it("still offers a redirect the user permanently dismissed", async () => {
    await renderPopup("https://www.reddit.com/r/bald", [rule()], {
      globalEnabled: true,
      dismissedRuleKeys: ["https://www.socialgata.com::reddit-plugin"],
    });

    expect(ctas()).toHaveLength(1);
  });

  it("still offers a redirect when redirects are globally disabled", async () => {
    await renderPopup("https://www.reddit.com/r/bald", [rule()], {
      globalEnabled: false,
      dismissedRuleKeys: [],
    });

    expect(ctas()).toHaveLength(1);
  });

  it("lists one button per match with the plugin default first", async () => {
    await renderPopup(
      "https://www.reddit.com/r/bald",
      [rule(), rule({ appName: "Local", appOrigin: "http://localhost:3000" })],
      {
        globalEnabled: true,
        dismissedRuleKeys: [],
        defaultOrigins: { "reddit-plugin": "http://localhost:3000" },
      }
    );

    expect(ctas().map((b) => b.textContent?.trim().split(/\s+/)[0])).toEqual([
      "Local",
      "SocialGata",
    ]);
    expect(ctas()[0].querySelector(".redirect-cta-default")).toBeTruthy();
    expect(ctas()[1].querySelector(".redirect-cta-default")).toBeFalsy();
  });

  it("renders no section on a page no rule matches", async () => {
    await renderPopup("https://example.com/", [rule()], {
      globalEnabled: true,
      dismissedRuleKeys: [],
    });

    expect(ctas()).toHaveLength(0);
    expect(document.querySelector(".current-page-section")).toBeFalsy();
  });

  it("renders no section on a non-http page", async () => {
    await renderPopup("chrome://extensions", [rule()], {
      globalEnabled: true,
      dismissedRuleKeys: [],
    });

    expect(ctas()).toHaveLength(0);
  });
});
