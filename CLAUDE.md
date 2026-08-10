# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfoGata Extension is a cross-browser extension that enhances AudioGata, VideoGata, ReaderGata, and SocialGata applications by providing:
- CORS-free network requests for plugins
- Authenticated requests to websites with user permission

The extension uses a message-passing architecture between page scripts, content scripts, and background scripts to bypass CORS restrictions and handle authentication flows.

## Build Commands

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

# Testing
npm test               # Run Vitest tests
npm run test:watch     # Run Vitest tests in watch mode
npm run test:coverage  # Run Vitest tests with coverage
```

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

4. **Popup** (`entrypoints/popup.html`, `src/popup-script.ts`)
   - Manages the authorized origins list and the site redirect rules
   - Offers to open the current page in a matching InfoGata app — the payoff for
     the toolbar badge, and the only surface where a redirect is offered
   - Uses lit-html for reactive UI, re-rendering via `render(page(), document.body)`
   - Stores origins and the theme preference in browser.storage.local; redirect
     preferences are owned by the background script and updated by message

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

## Development Notes

- TypeScript with strict mode enabled
- Uses WXT framework for cross-browser extension development
- Browser polyfill (`webextension-polyfill`) for cross-browser compatibility
- All network requests preserve headers (including cookies) when authorized
- Authentication captures cookies and headers from login windows
- WXT automatically generates manifests for both Chrome and Firefox
- Entrypoints directory structure for WXT organization
- Vitest for testing, with `fakeBrowser` from `wxt/testing` for extension APIs.
  There is no global jsdom environment: DOM tests opt in per file with a
  `// @vitest-environment jsdom` comment on the first line
- The popup theme lives in `src/theme.ts`; `src/popup.css` holds the palette as
  custom properties, defaulting to dark and following `prefers-color-scheme`
  unless `data-theme` pins a choice