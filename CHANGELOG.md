# Changelog

Notable changes to the InfoGata Extension. Dates are the release tag's date.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Proof-of-origin tokens.** YouTube now streams only about a minute of most
  videos to a client that cannot show a token from its BotGuard check, and that
  check yields a usable token only on youtube.com, so a plugin cannot mint one.
  `window.InfoGata.mintPoToken(origin, contentBinding, overrides?)` mints it in
  a hidden youtube.com frame inside the calling app's tab. The API names no
  site; what YouTube needs is a provider table in the extension, and the page
  supplies only data. The frame uses the BotGuard VM youtube.com's own page
  loads, so the extension never fetches or evaluates remote code. Unlike
  page-context, which parks a pinned tab because its sites refuse to be framed,
  the provider's framing headers are lifted for the one marked minter url, only
  when an authorized app embeds it, so a music app does not keep a tab open.
  Works in Chrome and Firefox.
- **The minter frame is anonymous.** Its load and every request its page makes
  go out without cookies, and its responses cannot set any, so the user's
  YouTube account is never involved. That is also why it asks no consent.
  Header changes and cookie stripping exist only while a tab has a frame, which
  is removed after ten idle minutes, when the tab closes, or when it leaves the
  app.

### Changed

- The Firefox path that runs a function as the page (`<script>` element plus
  `postMessage`) moved from `page-context.ts` to `src/page-script.ts`, so the
  minter shares it. It now also reports an error the function throws before
  returning a promise.

## [1.4.0] — 2026-09-04

### Added

- **Page-context requests.** Some sites answer on where a request came from
  rather than on what headers it carries, and refuse anything else. A plugin can
  now name such URLs in its manifest as `pageContextRequests`, and the extension
  runs those fetches from a tab parked on that site instead of from the
  background worker. The tab is pinned, opened in the background, titled
  "Loading for InfoGata" so it does not read as a stray, and closed once it goes
  unused; a tab the user already has open on the site is reused first. This is
  the only way to reach such a site: the header the check reads is
  browser-controlled and cannot be forged, and a hidden iframe is refused
  because an embedded frame is cross-site by construction.
- **A separate consent prompt for it.** Keeping a tab open on a site and reading
  pages through it is a larger capability than sending cookies, so it asks on
  its own rather than riding on the credential prompt, and says plainly that a
  tab will stay open. As with `siteMatchPatterns`, a pattern only nominates a
  host: a wildcard host is rejected, and the URL must genuinely be on the site
  the pattern names.

## [1.3.0] — 2026-08-31

### Security

- **Requests no longer carry the user's login unless the user has allowed that
  host.** A plugin's `siteMatchPatterns` previously granted `credentials:
  "include"` on any URL they matched, and the patterns came straight from the
  page — a plugin passing `https://*/*` could read every site the user was
  signed in to. Patterns now only *nominate* a host: a wildcard host is rejected
  outright, the URL must genuinely be on the site the pattern names, and a
  consent window asks the user before any cookies are sent. Denied requests are
  still performed, just anonymously.
- **The login flow asks first.** `openLoginWindow` used to open any URL a plugin
  named and hand back whatever headers and cookies it captured, with no
  confirmation. It now names every domain involved and the exact credentials it
  will capture, and refuses non-http(s) URLs.
- **Redirect rules are bound to the origin that registered them**, so an
  authorized site can no longer register rules wearing another app's identity,
  and are capped per origin.
- **Fixed an open redirect.** `buildRedirectUrl` concatenated the app origin and
  the redirect path, so a path of `@evil.com` parsed as userinfo and sent the
  tab to a host the popup never displayed. It now resolves against the origin
  and refuses anything that lands elsewhere.
- **Fixed a listener leak in the login flow.** `onBeforeSendHeaders` listeners
  were registered per sign-in and never removed.
- **Removed `web_accessible_resources`.** `content-script.js` was exposed to
  every URL, letting any page detect the extension. Nothing needed it.

### Added

- A popup section to review and revoke which sites plugins may use your login
  for.
- A development-only "Skip consent prompts" toggle, so iterating on a plugin is
  not interrupted by a prompt per host. It is compiled out of release builds,
  and `npm run check:bundle` fails CI if any dev-only code reaches one.
- `PRIVACY.md`, `SECURITY.md`, and `STORE.md` (permission justifications and
  store disclosures).
- CI running typecheck, tests, and both browser builds on every pull request,
  and attaching the store zips to every build of `master`.

### Changed

- The production build dropped from 856 kB to 57 kB. The debug page — a
  development tool that drives the privileged fetch with arbitrary input — is no
  longer included in release builds, and 581 kB of font was removed.
- The version is now maintained only in `package.json`.
- The two `console.log` calls that fired on every authorized page load are
  development-only.

### Fixed

- The bundled Inter font never actually loaded. Its `@font-face` rules declared
  `font-family: "Inter", sans-serif`, which is not a valid family descriptor, so
  the faces registered under no name. The popup has always rendered in the
  generic `sans-serif`; the unreachable font files were removed. Appearance is
  unchanged.
- A plugin's network request is always answered, even when it fails. A failed
  request used to leave the calling app awaiting a promise that never settled,
  which surfaced as a page that loaded forever instead of reporting an error.
- A request that never receives a response now times out after 60 seconds rather
  than hanging indefinitely.
- Plugin network requests failed in Firefox with `Permission denied to access
  property "then"`. The hook runs in the content script's sandbox there, across
  an Xray boundary from the page, and `networkRequest` had become an `async`
  function — which returns a promise from the sandbox's realm, burying the
  page-realm promise inside one the page is not allowed to read. It builds the
  page's promise directly again.

## [1.2.0] — 2026-08-10

### Added

- An optional light mode for the popup, following `prefers-color-scheme` unless
  pinned.

### Changed

- Redirect offers moved from an in-page banner to a badge on the toolbar icon,
  so the extension no longer injects anything into the pages you browse.

## [1.1.0] — 2026-07-26

### Added

- Site redirects: plugins can register rules so the extension offers to open a
  matching page in the corresponding InfoGata app, with a default app per plugin
  and per-rule enable, disable, and delete.
- SocialGata support.
- A development-only debug page for exercising network requests.
- Vitest, replacing Jest, with coverage.

### Changed

- Migrated the build from Parcel to WXT, which generates both the Chrome MV3 and
  Firefox MV2 manifests.
- The options page became a popup.
- Requests matching a plugin's declared `siteMatch` patterns were sent with
  credentials. (Superseded in Unreleased, which puts that behind user consent.)

### Fixed

- The toolbar icon was missing because the extension declared no icons.
- Request bodies are serialized so they survive cross-context message passing.
- The hook script is injected immediately when an origin is added, rather than
  on the next page load.
- A warning is logged when a plugin's redirect pattern fails to compile, instead
  of failing silently.

## [1.0.0] — 2023-01-27

First release.

### Added

- CORS-free network requests for plugins running in the InfoGata web apps, via
  the `window.InfoGata` hook.
- Plugin authentication: a login window whose cookies and headers are captured
  and returned to the requesting plugin.
- `getVersion()` for feature detection from the page.
- A popup for managing the list of authorized origins.
- The extension's own `Origin` header is stripped from its requests to
  youtube.com, which otherwise rejects them.

[Unreleased]: https://github.com/InfoGata/infogata-extension/compare/1.4.0...HEAD
[1.4.0]: https://github.com/InfoGata/infogata-extension/compare/1.3.0...1.4.0
[1.3.0]: https://github.com/InfoGata/infogata-extension/compare/1.2.0...1.3.0
[1.2.0]: https://github.com/InfoGata/infogata-extension/compare/1.1.0...1.2.0
[1.1.0]: https://github.com/InfoGata/infogata-extension/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/InfoGata/infogata-extension/releases/tag/1.0.0
