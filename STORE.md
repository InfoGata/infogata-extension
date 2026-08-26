# Store submission notes

Copy for the Chrome Web Store and AMO review forms. Keep this in sync with
`wxt.config.ts` — if a permission is added or removed there, change it here in
the same commit, because a justification that does not match the manifest is
what gets a submission rejected.

## Single purpose

> Lets plugins running inside the InfoGata web apps (AudioGata, VideoGata,
> ReaderGata, SocialGata) fetch content from the sites those plugins support,
> which a web page cannot do on its own because of CORS.

## Permission justifications

Chrome asks for one paragraph per permission. These are written to be pasted
directly.

### `host_permissions: <all_urls>`

> The extension's only function is fetching content from the sites a user's
> plugins support. Which sites those are is decided by the plugins the user
> chooses to install, so the set cannot be enumerated in the manifest. The
> access is used solely to perform the requests a plugin explicitly asks for.
> The extension injects its content script only into the small list of origins
> the user has authorized (by default the four InfoGata apps), never into pages
> the user merely browses.

### `storage`

> Stores the user's own settings on their machine: the list of authorized
> origins, which sites they have allowed a plugin to use their login for, the
> site-redirect rules registered by the InfoGata apps, their redirect
> preferences, and their theme choice. Nothing is transmitted.

### `tabs`

> Reads the active tab's URL for three things: showing a badge on the toolbar
> icon when an installed plugin can open the current page, offering that
> redirect in the popup, and navigating the tab if the user accepts. Also used
> to identify which tab to inject the content script into.

### `scripting`

> Injects the content script into origins the user has authorized, and injects
> the small hook script into the page's main world so the InfoGata app can call
> `window.InfoGata.networkRequest()`. Both are injected on demand, only for
> authorized origins.

### `webRequest`

> Used only during a login flow the user has explicitly approved. When a user
> agrees to sign in to a site so a plugin can act on their behalf, the extension
> reads the request headers of that login window to capture the session
> credentials the plugin needs. The listener is scoped to that window's tab and
> the specific domains named in the consent prompt, and is removed as soon as
> the login finishes or the window closes.

### `declarativeNetRequest` (Chrome / MV3)

> A single static rule that removes the extension's own `Origin` header from
> requests it makes to youtube.com, which otherwise rejects them. Scoped to
> requests initiated by this extension.

### `webRequestBlocking` (Firefox / MV2 only)

> The Manifest V2 equivalent of the `declarativeNetRequest` rule above: strips
> the extension's own `Origin` header from its requests to youtube.com. Not
> requested on Chrome.

## Data usage disclosures (Chrome Web Store)

The store's data categories, and the answer for this extension:

| Category | Collected? |
| --- | --- |
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No — see the note below |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No — see the note below |

**Authentication information.** With the user's explicit, per-site consent, the
extension can carry the user's existing cookies on a request, and can capture
the credentials a site issues during a login the user approved. Those
credentials are handed to the InfoGata app page that asked for them, in the
user's own browser, and are never stored by the extension or transmitted to the
developer or any third party. Chrome's disclosure asks whether data is
*collected* — meaning transferred off the user's device — and it is not.

**Website content.** The extension fetches pages at a plugin's request and hands
the response back to the page that asked, in the same browser. It does not read,
log, or retain that content.

Certifications, all of which hold:

- Not being sold to third parties, outside of approved use cases
- Not being used or transferred for purposes unrelated to the single purpose
- Not being used or transferred to determine creditworthiness or for lending

Privacy policy URL: link to `PRIVACY.md` on the repository, or a hosted copy.

## Firefox (AMO)

`browser_specific_settings.gecko.data_collection_permissions` is set to
`{ required: ["none"] }`.

Mozilla defines data transmission as data "collected, used, transferred,
shared, or handled outside the add-on or the local browser." Everything this
extension does happens inside the local browser: there is no InfoGata server, no
analytics, and no telemetry. Requests it makes are the plugin's own, to sites
the user's plugins target, and captured credentials go back to the requesting
page and nowhere else.

**This declaration must be revisited** if the project ever adds analytics, crash
or error reporting, an update or licence check that phones home, or a
hosted proxy that requests pass through. Any of those makes `none` untrue.

AMO requires a sources archive for review because the submission is built from
minified output. `npm run zip:firefox` produces it alongside the extension zip
(`infogata-extension-<version>-sources.zip`), and CI attaches both to every
master build.

## Reviewer notes

Worth stating in the "notes to reviewer" field, since the permission set looks
broad for what the extension does:

> This extension is a request broker for four open-source web apps. It has no
> backend. Requests are sent **without cookies by default**; a plugin can
> nominate a host for credentialed access but cannot grant it — the extension
> opens a consent window naming the exact host, and stores the user's answer for
> review and revocation in the popup. Patterns with a wildcard host are rejected
> outright, so a plugin cannot ask for "every site." The same consent step gates
> the login-capture flow. Source: https://github.com/InfoGata/infogata-extension
