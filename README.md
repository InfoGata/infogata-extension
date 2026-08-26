# InfoGata Browser Extension

This extension enables additional functionality to [audiogata](https://github.com/InfoGata/audiogata), [videogata](https://github.com/InfoGata/videogata), [readergata](https://github.com/InfoGata/readergata), [socialgata](https://github.com/InfoGata/socialgata) plugins.

It currently enables the following:

1. Allows the plugins to fetch urls without a cors proxy, which some plugins need.
2. Allows some plugins to make authenticated requests to websites if the user enables the plugin to.

## Using your login

By default every request a plugin makes is sent anonymously, without your
cookies. A plugin can *nominate* a site it needs your login for, but it cannot
grant itself access: the extension asks you first, naming the exact site, and
remembers your answer. The same prompt appears before a plugin opens a login
window and captures the credentials that site issues.

Patterns with a wildcard host (`https://*/*`) are rejected outright -- a plugin
has to name the site it wants. Review or revoke anything you have allowed under
"Sites plugins may use your login for" in the extension popup.

## Installation

Firefox: https://addons.mozilla.org/en-US/firefox/addon/infogata-extension/

Chrome:

1. [Download the Chrome zip from the latest release](https://github.com/InfoGata/infogata-extension/releases/latest)
2. Unzip the extension file
3. Follow these instructions: https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked

## Building

### Development
```sh
npm install
npm run dev            # Chrome development server
npm run dev:firefox    # Firefox development server
```

### Production builds
```sh
npm install
npm run build          # Build for Chrome
npm run build:firefox  # Build for Firefox
```

### Create distribution packages
```sh
npm run zip            # Create Chrome extension zip
npm run zip:firefox    # Create Firefox extension zip
```

### Testing
```sh
npm test               # Run Vitest tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage
```

## Privacy

The extension has no backend and collects nothing. See [PRIVACY.md](PRIVACY.md)
for what is stored locally and what happens to requests and login credentials.

## Credits

Styling and assets of the popup come from [hoppscotch/hoppscotch-extension](https://github.com/hoppscotch/hoppscotch-extension)
