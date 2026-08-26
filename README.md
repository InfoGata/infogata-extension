# InfoGata Browser Extension

Lets plugins in the InfoGata apps reach the sites they were written for.

[AudioGata](https://www.audiogata.com), [VideoGata](https://www.videogata.com),
[ReaderGata](https://www.readergata.com) and
[SocialGata](https://www.socialgata.com) are plugin-based web apps for playing
audio, watching video, reading, and following social feeds. A plugin teaches an
app to talk to one source — YouTube, SoundCloud, Bandcamp, whatever someone has
written a plugin for.

The catch is that they run in a browser tab, and a web page is not allowed to
fetch most other sites. That is the same-origin policy, and it is the reason a
plugin that works perfectly in principle returns nothing in practice. The usual
workaround is to route everything through a CORS proxy — a server, run by
somebody, that sees every request you make.

This extension is the alternative. It makes those requests locally, from your
own browser, so no third party is in the middle and there is no server to trust.
Some plugins need it; others work better with it.

**Install it if** a plugin tells you to, or if a source you want isn't loading.
It does nothing on its own — it only acts when one of the four apps asks.

## What it does

1. **Fetches without a CORS proxy.** Plugins ask the extension for a URL and get
   the response back. Nothing leaves your machine except the request itself, to
   the site the plugin named.
2. **Lets a plugin use a site you're signed in to**, when you allow it — so a
   plugin can reach your own library, playlists, or feed on a site that requires
   a login.

## Using your login

By default every request a plugin makes is sent anonymously, without your
cookies. A plugin can *nominate* a site it needs your login for, but it cannot
grant itself access: the extension asks you first, naming the exact site, and
remembers your answer. The same prompt appears before a plugin opens a login
window and captures the credentials that site issues.

Patterns with a wildcard host (`https://*/*`) are rejected outright — a plugin
has to name the site it wants. Review or revoke anything you have allowed under
"Sites plugins may use your login for" in the extension popup.

## Installation

Firefox: https://addons.mozilla.org/en-US/firefox/addon/infogata-extension/

Chrome:

1. [Download the Chrome zip from the latest release](https://github.com/InfoGata/infogata-extension/releases/latest)
2. Unzip the extension file
3. Follow these instructions: https://developer.chrome.com/docs/extensions/mv3/getstarted/development-basics/#load-unpacked

## Privacy

The extension has no backend and collects nothing — no analytics, no telemetry,
no error reporting. Everything it stores stays in your browser. See
[PRIVACY.md](PRIVACY.md) for the details, and [SECURITY.md](SECURITY.md) to
report a vulnerability.

## Building

Requires Node 22 or newer.

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

### Checks
```sh
npm run typecheck      # tsc --noEmit
npm test               # Run Vitest tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage
```

## Contributing

Issues and pull requests are welcome. CI runs the typecheck, the tests, and both
browser builds on every pull request, so run `npm run typecheck && npm test`
before you push.

Changes to what the extension is allowed to do — permissions, the consent flow,
what a plugin can ask for — should update [STORE.md](STORE.md) and
[PRIVACY.md](PRIVACY.md) in the same commit. A justification that disagrees with
the manifest is what gets a store submission rejected.

## Credits

Styling and assets of the popup come from [hoppscotch/hoppscotch-extension](https://github.com/hoppscotch/hoppscotch-extension)

## License

MIT — see [LICENSE](LICENSE).
