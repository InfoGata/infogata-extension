# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfoGata Extension is a cross-browser extension that enhances AudioGata, VideoGata, and ReaderGata applications by providing:
- CORS-free network requests for plugins
- Authenticated requests to websites with user permission

The extension uses a message-passing architecture between page scripts, content scripts, and background scripts to bypass CORS restrictions and handle authentication flows.

## Build Commands

```bash
# Development
npm start              # Start development server (Firefox)

# Production builds
npm run build:chrome   # Build for Chrome (Manifest V3)
npm run build:firefox  # Build for Firefox (Manifest V2)

# Create distribution packages
npm run create-zip:chrome   # Create Chrome extension zip
npm run create-zip:firefox  # Create Firefox extension zip

# Clean build artifacts
npm run clean
```

## Architecture

### Core Components

1. **Background Script** (`src/index.ts`)
   - Central message hub handling network requests
   - Manages authentication windows and cookie capture
   - Injects content scripts into authorized domains
   - Chrome uses service worker, Firefox uses persistent background script

2. **Content Script** (`src/content.ts`)
   - Bridge between page context and extension context
   - Relays messages between hook script and background script
   - Injected only into authorized origins

3. **Hook Script** (`src/hook.ts`)
   - Runs in page context, exposes `window.InfoGata` API
   - Methods: `networkRequest()`, `startAuth()`, `isLoggedIn()`, `logout()`, `getVersion()`
   - Communicates with content script via `postMessage`

4. **Options Page** (`src/options.ts`)
   - Manages authorized origins list
   - Uses lit-html for reactive UI
   - Stores origins in browser.storage.local

### Message Flow

```
Page (hook.ts) → Content Script → Background Script → Network/Auth
                ←                ←                  ←
```

### Key Differences: Chrome vs Firefox

- **Manifest Version**: Chrome uses V3, Firefox uses V2
- **Background Script**: Chrome uses service worker, Firefox uses persistent script
- **Build Target**: Separate Parcel configs in package.json
- **Host Permissions**: Different syntax in manifest files

## Development Notes

- TypeScript with strict mode enabled
- No testing framework currently implemented
- Uses Parcel bundler with webextension plugin
- Browser polyfill (`webextension-polyfill`) for cross-browser compatibility
- All network requests preserve headers (including cookies) when authorized
- Authentication captures cookies and headers from login windows