# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfoGata Extension is a cross-browser extension that enhances AudioGata, VideoGata, ReaderGata, and SocialGata applications by providing:
- CORS-free network requests for plugins
- Authenticated requests to websites with user permission

The extension uses a message-passing architecture between page scripts, content scripts, and background scripts to bypass CORS restrictions and handle authentication flows.

## Build Commands

`npm install` runs `wxt prepare` via `postinstall`, which generates the `.wxt`
types that `tsconfig.json` extends. Without it nothing typechecks and Vitest
cannot resolve the tsconfig, so a fresh clone must install before anything else.

```bash
# Development
npm run dev            # Start development server (Chrome by default)
npm run dev:firefox    # Start development server (Firefox)

# Production builds
npm run build          # Build for Chrome (Manifest V3)
npm run build:firefox  # Build for Firefox (Manifest V2)

# Create distribution packages
npm run zip            # Create Chrome extension zip
npm run zip:firefox    # Create Firefox extension zip

# Checks
npm run typecheck      # tsc --noEmit
npm test               # Run Vitest tests
npm run test:watch     # Run Vitest tests in watch mode
npm run test:coverage  # Run Vitest tests with coverage
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the tests, and both builds on
every pull request; pushes to `master` also produce the store zips as artifacts.

## Architecture

### Core Components

1. **Background Script** (`entrypoints/background.ts`)
   - Central message hub handling network requests
   - Manages authentication windows and cookie capture
   - Injects content scripts into authorized domains
   - Badges the toolbar icon when a site redirect rule matches the active tab,
     so redirect offers never touch the page itself
   - Chrome uses service worker, Firefox uses persistent background script

2. **Content Script** (`entrypoints/content-script.ts`)
   - Bridge between page context and extension context
   - Relays messages between hook script and background script
   - Injected only into authorized origins

3. **Hook Script** (`entrypoints/hook.ts`)
   - Runs in page context, exposes `window.InfoGata` API
   - Methods: `networkRequest()`, `openLoginWindow()`, `getVersion()`
   - Communicates with content script via `postMessage`

4. **Consent Window** (`entrypoints/consent.html`, `src/consent-script.ts`)
   - Asked before any request carries the user's cookies, and before a login
     window captures credentials
   - Opened by the background script, which awaits the answer; a window closed
     without answering counts as a refusal
   - Decisions are stored per host in `credentialHosts` and are revocable from
     the popup

5. **Popup** (`entrypoints/popup.html`, `src/popup-script.ts`)
   - Manages the authorized origins list and the site redirect rules
   - Offers to open the current page in a matching InfoGata app — the payoff for
     the toolbar badge, and the only surface where a redirect is offered
   - Uses lit-html for reactive UI, re-rendering via `render(page(), document.body)`
   - Stores origins and the theme preference in browser.storage.local; redirect
     preferences are owned by the background script and updated by message

6. **Debug Page** (`entrypoints/debug.html`, `src/debug-script.tsx`)
   - Development only. An `entrypoints:resolved` hook in `wxt.config.ts` skips it
     when `mode === "production"`, and the popup button that opens it is behind
     `import.meta.env.DEV`
   - It drives the background worker's privileged fetch with arbitrary input, so
     it must not ship; it is also the only thing pulling React into the build

### Message Flow

```
Page (hook.ts) → Content Script → Background Script → Network/Auth
                ←                ←                  ←
```

### Key Differences: Chrome vs Firefox

- **Manifest Version**: Chrome uses V3, Firefox uses V2
- **Background Script**: Chrome uses service worker, Firefox uses persistent script
- **Build Framework**: WXT handles cross-browser differences automatically
- **Host Permissions**: Different syntax in manifest files

## Security Invariants

These are load-bearing; changing them changes what a hostile plugin can do.

- Requests are `credentials: "omit"` unless the user has allowed the exact host.
  A plugin's `siteMatchPatterns` only *nominate* a host -- see
  `credentialHostFor` in `src/credential-hosts.ts`, which rejects wildcard hosts
  so a pattern cannot stand for every site at once.
- Redirect rules are bound to `sender.url`'s origin at registration, so a site
  cannot register a rule wearing another app's origin, and are capped per origin.
- `buildRedirectUrl` resolves rather than concatenates: the popup displays
  `appOrigin`, so a path that resolves off that origin is refused.
- The login flow tears its `onBeforeSendHeaders` listener down (`endLogin`);
  listeners must not outlive the window that needed them.
- There is no `web_accessible_resources`. `content-script.js` and `hook.js` are
  injected with `executeScript({ file })`, which does not need it; listing a
  resource lets any page probe for it and fingerprint the extension.
- Only the extension's own consent page may answer a consent prompt, checked by
  `sender.id` and the `consent.html` URL — the consent window is a real tab, so
  `sender.tab` does not distinguish it from a web page.

## Development Notes

- TypeScript with strict mode enabled
- Uses WXT framework for cross-browser extension development
- Browser polyfill (`webextension-polyfill`) for cross-browser compatibility
- Network requests are anonymous unless the user has allowed that host; see
  "Security Invariants" above
- Authentication captures cookies and headers from login windows, after the user
  approves the capture in the consent window
- WXT automatically generates manifests for both Chrome and Firefox
- Entrypoints directory structure for WXT organization
- Vitest for testing, with `fakeBrowser` from `wxt/testing/fake-browser` for
  extension APIs (wxt 0.21 split the old `wxt/testing` barrel; the vitest plugin
  now comes from `wxt/testing/vitest-plugin`).
  There is no global jsdom environment: DOM tests opt in per file with a
  `// @vitest-environment jsdom` comment on the first line
- The popup theme lives in `src/theme.ts`. `src/theme.css` holds the palette as
  custom properties, defaulting to dark and following `prefers-color-scheme`
  unless `data-theme` pins a choice; `popup.css` and `consent.css` both
  `@import` it
- No webfont. An `@font-face` `font-family` descriptor takes a single family
  name, and the old `"Inter", sans-serif` was a parse error, so the faces never
  registered and 581 kB of TTF shipped unread. If a webfont is ever added back,
  give each face a single-name descriptor and use woff2
- The version lives only in `package.json`; WXT reads it from there. Do not add a
  `version` to the manifest block
- `STORE.md` and `PRIVACY.md` describe what the extension is permitted to do.
  Change them in the same commit as `wxt.config.ts` when permissions or the
  consent flow change