import { describe, it, expect, vi } from "vitest";
import {
  buildRedirectUrl,
  findMatchingRule,
  findMatchingRules,
  getRuleKey,
  resolvePatternRedirect,
  urlMatchesPattern,
} from "../src/redirect-utils";
import { RedirectPreferences, SiteRedirectRule } from "../src/types";

const baseRule = (
  patternRedirects?: SiteRedirectRule["patternRedirects"]
): SiteRedirectRule => ({
  pluginId: "test-plugin",
  pluginName: "Test Plugin",
  appName: "SocialGata",
  appOrigin: "https://www.socialgata.com",
  siteMatchPatterns: ["https://www.reddit.com/*"],
  redirectPath: "/plugins/test-plugin/feed",
  patternRedirects,
});

describe("urlMatchesPattern", () => {
  it("matches simple wildcard globs", () => {
    expect(
      urlMatchesPattern("https://www.reddit.com/r/bald", "https://www.reddit.com/*")
    ).toBe(true);
  });

  it("rejects non-matching urls", () => {
    expect(
      urlMatchesPattern("https://example.com/", "https://www.reddit.com/*")
    ).toBe(false);
  });
});

describe("resolvePatternRedirect", () => {
  it("returns undefined when no patternRedirects are defined", () => {
    expect(
      resolvePatternRedirect("https://www.reddit.com/r/bald", baseRule())
    ).toBeUndefined();
  });

  it("substitutes named groups from the pathname into the redirect template", () => {
    const rule = baseRule([
      {
        pattern: "https://*.reddit.com/r/:community/comments/:postId/*",
        redirectPath: "/plugins/test-plugin/community/:community/post/:postId",
      },
    ]);
    const out = resolvePatternRedirect(
      "https://www.reddit.com/r/bald/comments/1ti7fsy/well_i_finally_built_up_the_courage_to_do_it/",
      rule
    );
    expect(out).toBe("/plugins/test-plugin/community/bald/post/1ti7fsy");
  });

  it("returns the first matching pattern when multiple are defined", () => {
    const rule = baseRule([
      {
        pattern: "https://*.reddit.com/r/:community/comments/:postId/*",
        redirectPath: "/community/:community/post/:postId",
      },
      {
        pattern: "https://*.reddit.com/r/:community{/*}?",
        redirectPath: "/community/:community",
      },
    ]);
    const post = resolvePatternRedirect(
      "https://www.reddit.com/r/bald/comments/1ti7fsy/title/",
      rule
    );
    expect(post).toBe("/community/bald/post/1ti7fsy");

    const community = resolvePatternRedirect(
      "https://www.reddit.com/r/bald/",
      rule
    );
    expect(community).toBe("/community/bald");
  });

  it("works with old.reddit.com via wildcard subdomain", () => {
    const rule = baseRule([
      {
        pattern: "https://*.reddit.com/r/:community/comments/:postId/*",
        redirectPath: "/community/:community/post/:postId",
      },
    ]);
    const out = resolvePatternRedirect(
      "https://old.reddit.com/r/programming/comments/abc123/title/",
      rule
    );
    expect(out).toBe("/community/programming/post/abc123");
  });

  it("URI-encodes substituted values", () => {
    const rule = baseRule([
      {
        pattern: "https://example.com/topic/:name",
        redirectPath: "/topic/:name",
      },
    ]);
    const out = resolvePatternRedirect(
      "https://example.com/topic/hello%20world",
      rule
    );
    // The URLPattern returns the raw matched segment ("hello%20world").
    // encodeURIComponent then escapes the percent sign to keep the value opaque.
    expect(out).toBe("/topic/hello%2520world");
  });

  it("returns undefined when no pattern matches", () => {
    const rule = baseRule([
      {
        pattern: "https://*.reddit.com/r/:community/comments/:postId/*",
        redirectPath: "/community/:community/post/:postId",
      },
    ]);
    expect(
      resolvePatternRedirect("https://example.com/foo", rule)
    ).toBeUndefined();
  });

  it("skips invalid patterns and continues to the next one", () => {
    const rule = baseRule([
      { pattern: "::not a valid pattern::", redirectPath: "/should-not-match" },
      {
        pattern: "https://*.reddit.com/user/:userId{/*}?",
        redirectPath: "/user/:userId",
      },
    ]);
    const out = resolvePatternRedirect(
      "https://www.reddit.com/user/spez/",
      rule
    );
    expect(out).toBe("/user/spez");
  });

  it("warns once per invalid pattern instead of failing silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rule = baseRule([
      { pattern: "::another invalid pattern::", redirectPath: "/should-not-match" },
    ]);

    // Every navigation re-checks the pattern, but it should only be reported once.
    resolvePatternRedirect("https://x.com/jack", rule);
    resolvePatternRedirect("https://x.com/someone-else", rule);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("::another invalid pattern::");
    expect(warn.mock.calls[0][0]).toContain("Test Plugin");
    warn.mockRestore();
  });
});

describe("getRuleKey", () => {
  it("combines appOrigin and pluginId", () => {
    expect(getRuleKey(baseRule())).toBe(
      "https://www.socialgata.com::test-plugin"
    );
  });
});

describe("findMatchingRule", () => {
  const url = "https://www.reddit.com/r/bald";
  const prod: SiteRedirectRule = {
    ...baseRule(),
    appName: "SocialGata",
    appOrigin: "https://www.socialgata.com",
  };
  const dev: SiteRedirectRule = {
    ...baseRule(),
    appName: "Local",
    appOrigin: "http://localhost:3000",
  };
  const prefs = (
    overrides: Partial<RedirectPreferences> = {}
  ): RedirectPreferences => ({
    globalEnabled: true,
    dismissedRuleKeys: [],
    ...overrides,
  });

  it("returns the first matching rule when no default is set", () => {
    expect(findMatchingRule(url, [prod, dev], prefs())?.appOrigin).toBe(
      "https://www.socialgata.com"
    );
  });

  it("prefers the rule whose appOrigin matches the plugin default", () => {
    const result = findMatchingRule(
      url,
      [prod, dev],
      prefs({ defaultOrigins: { "test-plugin": "http://localhost:3000" } })
    );
    expect(result?.appOrigin).toBe("http://localhost:3000");
  });

  it("returns undefined when redirects are globally disabled", () => {
    expect(
      findMatchingRule(url, [prod, dev], prefs({ globalEnabled: false }))
    ).toBeUndefined();
  });

  it("skips dismissed rules and falls back to the next match", () => {
    const result = findMatchingRule(
      url,
      [prod, dev],
      prefs({ dismissedRuleKeys: [getRuleKey(prod)] })
    );
    expect(result?.appOrigin).toBe("http://localhost:3000");
  });

  it("returns undefined when no rule matches the url", () => {
    expect(
      findMatchingRule("https://example.com/", [prod, dev], prefs())
    ).toBeUndefined();
  });
});

describe("findMatchingRules", () => {
  const url = "https://www.reddit.com/r/bald";
  const prod: SiteRedirectRule = {
    ...baseRule(),
    appName: "SocialGata",
    appOrigin: "https://www.socialgata.com",
  };
  const dev: SiteRedirectRule = {
    ...baseRule(),
    appName: "Local",
    appOrigin: "http://localhost:3000",
  };
  const otherPlugin: SiteRedirectRule = {
    ...baseRule(),
    pluginId: "other-plugin",
    pluginName: "Other Plugin",
    appName: "VideoGata",
    appOrigin: "https://www.videogata.com",
  };
  const prefs = (
    overrides: Partial<RedirectPreferences> = {}
  ): RedirectPreferences => ({
    globalEnabled: true,
    dismissedRuleKeys: [],
    ...overrides,
  });

  it("returns every matching rule in registration order", () => {
    expect(
      findMatchingRules(url, [prod, dev], prefs()).map((r) => r.appOrigin)
    ).toEqual(["https://www.socialgata.com", "http://localhost:3000"]);
  });

  it("includes dismissed rules, since the popup is an explicit user action", () => {
    const result = findMatchingRules(
      url,
      [prod, dev],
      prefs({ dismissedRuleKeys: [getRuleKey(prod), getRuleKey(dev)] })
    );
    expect(result).toHaveLength(2);
  });

  it("includes rules when redirects are globally disabled", () => {
    expect(
      findMatchingRules(url, [prod, dev], prefs({ globalEnabled: false }))
    ).toHaveLength(2);
  });

  it("sorts a plugin's default origin first within its own group", () => {
    const result = findMatchingRules(
      url,
      [prod, dev],
      prefs({ defaultOrigins: { "test-plugin": "http://localhost:3000" } })
    );
    expect(result.map((r) => r.appOrigin)).toEqual([
      "http://localhost:3000",
      "https://www.socialgata.com",
    ]);
  });

  it("keeps rules grouped by plugin without reordering plugins", () => {
    const result = findMatchingRules(
      url,
      [prod, otherPlugin, dev],
      prefs({ defaultOrigins: { "test-plugin": "http://localhost:3000" } })
    );
    expect(result.map((r) => r.appOrigin)).toEqual([
      "http://localhost:3000",
      "https://www.socialgata.com",
      "https://www.videogata.com",
    ]);
  });

  it("returns an empty array when no rule matches the url", () => {
    expect(findMatchingRules("https://example.com/", [prod, dev], prefs())).toEqual(
      []
    );
  });
});

describe("buildRedirectUrl", () => {
  it("appends the static redirectPath when no patternRedirects match", () => {
    expect(buildRedirectUrl("https://www.reddit.com/r/bald", baseRule())).toBe(
      "https://www.socialgata.com/plugins/test-plugin/feed"
    );
  });

  it("appends the pattern-derived path when a patternRedirect matches", () => {
    const rule = baseRule([
      {
        pattern: "https://*.reddit.com/r/:community/comments/:postId/*",
        redirectPath: "/plugins/test-plugin/community/:community/post/:postId",
      },
    ]);
    expect(
      buildRedirectUrl("https://www.reddit.com/r/bald/comments/123/title/", rule)
    ).toBe("https://www.socialgata.com/plugins/test-plugin/community/bald/post/123");
  });

  it("falls back to redirectPath when the url matches siteMatch but no pattern", () => {
    const rule = baseRule([
      {
        pattern: "https://*.reddit.com/r/:community/comments/:postId/*",
        redirectPath: "/community/:community/post/:postId",
      },
    ]);
    expect(buildRedirectUrl("https://www.reddit.com/", rule)).toBe(
      "https://www.socialgata.com/plugins/test-plugin/feed"
    );
  });
});
