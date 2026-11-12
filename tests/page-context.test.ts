import { describe, expect, it } from "vitest";
import {
  looksAnubisChallenged,
  looksInterstitialChallenged,
  pageContextHostFor,
} from "../src/page-context";

describe("pageContextHostFor", () => {
  const options = { pageContextPatterns: ["https://twstalker.com/*"] };

  it("nominates the host a declared pattern pins to", () => {
    expect(pageContextHostFor("https://twstalker.com/elonmusk", options)).toBe(
      "twstalker.com"
    );
  });

  it("ignores a url on a different host", () => {
    expect(pageContextHostFor("https://example.com/elonmusk", options)).toBe(
      undefined
    );
  });

  it("does not let a lookalike host borrow the pattern", () => {
    expect(
      pageContextHostFor("https://twstalker.com.evil.test/x", options)
    ).toBe(undefined);
  });

  it("refuses a wildcard host, which would nominate any site", () => {
    for (const pattern of ["https://*/*", "https://*.com/*"]) {
      expect(
        pageContextHostFor("https://twstalker.com/x", {
          pageContextPatterns: [pattern],
        })
      ).toBe(undefined);
    }
  });

  it("is undefined when the plugin declared nothing", () => {
    expect(pageContextHostFor("https://twstalker.com/x")).toBe(undefined);
    expect(
      pageContextHostFor("https://twstalker.com/x", { pageContextPatterns: [] })
    ).toBe(undefined);
  });

  it("does not treat siteMatch patterns as page-context nominations", () => {
    expect(
      pageContextHostFor("https://twstalker.com/x", {
        siteMatchPatterns: ["https://twstalker.com/*"],
      })
    ).toBe(undefined);
  });
});

describe("looksAnubisChallenged", () => {
  const response = (body: string) => ({
    status: 200,
    statusText: "OK",
    headers: {},
    body,
  });

  it("spots the proof-of-work page, which lobste.rs serves as a 200", () => {
    expect(
      looksAnubisChallenged(
        response(
          '<title>Making sure you&#39;re not a bot!</title>' +
            '<script id="anubis_challenge" type="application/json">{}</script>'
        )
      )
    ).toBe(true);
  });

  it("passes the real page", () => {
    expect(
      looksAnubisChallenged(response('<li data-shortid="abc123">story</li>'))
    ).toBe(false);
  });
});

describe("looksInterstitialChallenged", () => {
  const response = (body: string, status = 200) => ({
    status,
    statusText: "",
    headers: {},
    body,
  });

  it("spots Gandalf's first step, served as a 200", () => {
    expect(
      looksInterstitialChallenged(
        response(
          '<meta http-equiv="refresh" content="3; url=/.gandalf/check?gandalf_id=x">' +
            "<title>Gandalf</title>"
        )
      )
    ).toBe(true);
  });

  it("spots Shield, served as a 403", () => {
    expect(
      looksInterstitialChallenged(
        response(
          "<title>Checking your browser</title>" +
            '<meta http-equiv=refresh content="1;url=/__shield/v/abc?d=%2FNASA">',
          403
        )
      )
    ).toBe(true);
  });

  it("spots r4fo's proof-of-work page", () => {
    expect(
      looksInterstitialChallenged(
        response(
          "<title>Checking you are not a bot</title>" +
            '<link rel="stylesheet" href="/.well-known/r4fo-check/assets/static/forgejo/style.css">'
        )
      )
    ).toBe(true);
  });

  it("still spots Anubis", () => {
    expect(
      looksInterstitialChallenged(
        response('<script id="anubis_challenge" type="application/json">{}</script>')
      )
    ).toBe(true);
  });

  it("passes a real Nitter page", () => {
    expect(
      looksInterstitialChallenged(
        response(
          '<title>NASA (@NASA) | nitter</title><div class="timeline-item " data-username="NASA">'
        )
      )
    ).toBe(false);
  });
});
