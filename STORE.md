# Store submission notes

Copy for the Chrome Web Store and AMO review forms. Keep this in sync with
`wxt.config.ts` — if a permission is added or removed there, change it here in
the same commit, because a justification that does not match the manifest is
what gets a submission rejected.

## Single purpose

> Lets plugins running inside the InfoGata web apps (AudioGata, VideoGata,
> ReaderGata, SocialGata) fetch content from the sites those plugins support,
> which a web page cannot do on its own because of CORS. For sites that only
> serve media to clients that prove where they run (YouTube), it also obtains
> the token the site requires, which a web page on another origin cannot do.

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
>
> Some sites refuse any request that does not come from one of their own pages.
> For those, and only for a site the user has explicitly allowed, the extension
> opens one pinned background tab on that site and reads pages through it. The
> tab is titled so it is identifiable, is reused rather than reopened, and is
> closed once it goes unused. No tab is opened for any other site, and nothing
> read there leaves the browser.

### `scripting`

> Injects the content script into origins the user has authorized, and injects
> the small hook script into the page's main world so the InfoGata app can call
> `window.InfoGata.networkRequest()`. Both are injected on demand, only for
> authorized origins.
>
> Also used to run a single `fetch` inside the background tab described under
> `tabs`, for sites that serve their content only to their own pages. The script
> is a fetch and nothing else; it runs only on the site the user allowed, and
> its result is returned to the plugin that asked for it.
>
> Also used to obtain playback tokens from YouTube, which streams only about a
> minute of a video to a client that cannot produce one. When an authorized
> InfoGata app asks, the extension adds a hidden youtube.com frame to that app's
> own tab and injects one script packaged with the extension into it. That
> script uses the anti-abuse check youtube.com's own page loads -- the extension
> does not download or evaluate it -- and returns a token bound to the video
> being played. The frame is removed after ten idle minutes.

### `webRequest`

> Used only during a login flow the user has explicitly approved. When a user
> agrees to sign in to a site so a plugin can act on their behalf, the extension
> reads the request headers of that login window to capture the session
> credentials the plugin needs. The listener is scoped to that window's tab and
> the specific domains named in the consent prompt, and is removed as soon as
> the login finishes or the window closes.
>
> On Firefox, also used for the hidden youtube.com frame described under
> `scripting`, in place of the `declarativeNetRequest` rules Chrome uses: to let
> an InfoGata app embed that one marked URL (removing its `X-Frame-Options` and
> `Content-Security-Policy` only when an authorized app is the one embedding
> it), and to keep the frame anonymous by removing cookies from every request
> its page makes. These listeners exist only while a tab has the frame.

### `declarativeNetRequest` (Chrome / MV3)

> A single static rule that removes the extension's own `Origin` header from
> requests it makes to youtube.com, which otherwise rejects them. Scoped to
> requests initiated by this extension.
>
> Also two session rules, present only while an InfoGata app tab has the hidden
> youtube.com frame described under `scripting`. One lets the app embed that
> single marked URL by removing its `X-Frame-Options` and
> `Content-Security-Policy`, only when an authorized app is the one embedding
> it. The other keeps the frame anonymous: requests the youtube.com page makes
> in that tab go out without cookies and cannot set any, so the user's own
> YouTube account is never involved. Both are removed when the frame is.

### `webRequestBlocking` (Firefox / MV2 only)

> The Manifest V2 equivalent of the `declarativeNetRequest` rules above: strips
> the extension's own `Origin` header from its requests to youtube.com, and
> makes the header changes for the hidden youtube.com frame. Not requested on
> Chrome.

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
log, or retain that content. The hidden youtube.com frame used for playback
tokens is loaded without the user's cookies; the only thing taken from it is
the token, which goes to the app page that asked.

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

Collecting nothing is a standing commitment of the project, not an accident of
the current build. Treat a change that makes `none` untrue as a decision to be
argued for on its own merits, not a detail to be tidied up in the manifest.

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
> the login-capture flow.
>
> To play YouTube, the extension needs a token from YouTube's own anti-abuse
> check, which only works on youtube.com. It embeds a hidden youtube.com frame
> in the InfoGata app's tab (header changes scoped to that one marked URL,
> embedded by an authorized app), injects a single packaged script, and calls
> the check that youtube.com's own page loaded. The extension never fetches or
> evaluates remote code itself. The frame carries no cookies in either
> direction, and is removed when unused. Plugins pass only data (an origin from
> a fixed list and a validated video id), never code.
> Source: https://github.com/InfoGata/infogata-extension
