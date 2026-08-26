import { describe, expect, it, vi } from "vitest";
import {
  credentialHostFor,
  credentialPatternHost,
  hostFromUrl,
  hostMatchesPatternHost,
  normalizeHost,
} from "../src/credential-hosts";

describe("credentialPatternHost", () => {
  it("accepts a pattern that names a concrete host", () => {
    expect(credentialPatternHost("https://bandcamp.com/*")).toBe("bandcamp.com");
    expect(credentialPatternHost("http://localhost:3000/*")).toBe("localhost");
    expect(credentialPatternHost("*://soundcloud.com/*")).toBe("soundcloud.com");
  });

  it("accepts a subdomain wildcard over a registrable domain", () => {
    expect(credentialPatternHost("https://*.bandcamp.com/*")).toBe(
      "bandcamp.com"
    );
  });

  it("rejects a bare wildcard host, which would nominate every site at once", () => {
    expect(credentialPatternHost("https://*/*")).toBeUndefined();
    expect(credentialPatternHost("*://*/*")).toBeUndefined();
    expect(credentialPatternHost("https://*")).toBeUndefined();
  });

  it("rejects a wildcard that would cover a whole TLD", () => {
    expect(credentialPatternHost("https://*.com/*")).toBeUndefined();
  });

  it("rejects a wildcard buried inside the host", () => {
    expect(credentialPatternHost("https://mail.*.com/*")).toBeUndefined();
    expect(credentialPatternHost("https://bandcamp.com*")).toBeUndefined();
  });

  it("rejects non-http schemes and malformed patterns", () => {
    expect(credentialPatternHost("file:///*")).toBeUndefined();
    expect(credentialPatternHost("bandcamp.com/*")).toBeUndefined();
    expect(credentialPatternHost("")).toBeUndefined();
  });
});

describe("hostMatchesPatternHost", () => {
  it("matches the host itself and its subdomains", () => {
    expect(hostMatchesPatternHost("bandcamp.com", "bandcamp.com")).toBe(true);
    expect(hostMatchesPatternHost("art.bandcamp.com", "bandcamp.com")).toBe(
      true
    );
  });

  it("does not match a domain that merely ends with the same text", () => {
    expect(hostMatchesPatternHost("evilbandcamp.com", "bandcamp.com")).toBe(
      false
    );
  });
});

describe("normalizeHost", () => {
  it("accepts a bare host or a full URL, case-insensitively and without a port", () => {
    expect(normalizeHost("Bandcamp.com")).toBe("bandcamp.com");
    expect(normalizeHost("https://Bandcamp.com:8443/path")).toBe("bandcamp.com");
    expect(normalizeHost("  bandcamp.com  ")).toBe("bandcamp.com");
  });

  it("rejects non-http(s) input", () => {
    expect(normalizeHost("file:///etc/passwd")).toBeUndefined();
    expect(normalizeHost("")).toBeUndefined();
  });
});

describe("hostFromUrl", () => {
  it("returns the lowercased hostname of an http(s) URL", () => {
    expect(hostFromUrl("https://Mail.Google.com/mail/u/0/")).toBe(
      "mail.google.com"
    );
  });

  it("returns nothing for other schemes or unparseable input", () => {
    expect(hostFromUrl("javascript:alert(1)")).toBeUndefined();
    expect(hostFromUrl("not a url")).toBeUndefined();
  });
});

/**
 * The gate that decides whether a request may carry the user's cookies. These
 * are the cases that matter: the patterns arrive from the page, so a plugin
 * gets to *ask* for a host and nothing more.
 */
describe("credentialHostFor", () => {
  it("nominates the host when a concrete pattern matches the URL", () => {
    expect(
      credentialHostFor("https://bandcamp.com/album/x", {
        siteMatchPatterns: ["https://bandcamp.com/*"],
      })
    ).toBe("bandcamp.com");
  });

  it("nominates a subdomain covered by a wildcard pattern", () => {
    expect(
      credentialHostFor("https://art.bandcamp.com/track/y", {
        siteMatchPatterns: ["https://*.bandcamp.com/*"],
      })
    ).toBe("art.bandcamp.com");
  });

  it("nominates nothing for a blanket wildcard, however the plugin spells it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const pattern of ["https://*/*", "*://*/*", "https://*.com/*"]) {
      expect(
        credentialHostFor("https://mail.google.com/mail/u/0/", {
          siteMatchPatterns: [pattern],
        })
      ).toBeUndefined();
    }
    warn.mockRestore();
  });

  it("nominates nothing when the URL is not on the site the pattern names", () => {
    expect(
      credentialHostFor("https://mail.google.com/mail/u/0/", {
        siteMatchPatterns: ["https://bandcamp.com/*"],
      })
    ).toBeUndefined();
  });

  it("nominates nothing for a lookalike host", () => {
    expect(
      credentialHostFor("https://evilbandcamp.com/album/x", {
        siteMatchPatterns: ["https://*.bandcamp.com/*"],
      })
    ).toBeUndefined();
  });

  it("nominates the login host and its declared header domains", () => {
    const options = {
      auth: {
        loginUrl: "https://example.com/login",
        domainHeadersToFind: { ".api.example.com": ["Authorization"] },
      },
    };
    expect(credentialHostFor("https://example.com/feed", options)).toBe(
      "example.com"
    );
    expect(credentialHostFor("https://v2.api.example.com/x", options)).toBe(
      "v2.api.example.com"
    );
    expect(
      credentialHostFor("https://mail.google.com/", options)
    ).toBeUndefined();
  });

  it("nominates nothing when no options are supplied at all", () => {
    expect(credentialHostFor("https://bandcamp.com/album/x")).toBeUndefined();
  });
});
