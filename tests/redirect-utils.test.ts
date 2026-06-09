import { describe, it, expect } from "vitest";
import {
  resolvePatternRedirect,
  urlMatchesPattern,
} from "../src/redirect-utils";
import { SiteRedirectRule } from "../src/types";

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
});
