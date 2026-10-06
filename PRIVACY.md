# Privacy Policy — InfoGata Extension

_Last updated: 2026-10-04_

## The short version

The InfoGata Extension does not collect anything. There is no InfoGata server
involved, no analytics, no telemetry, and no error reporting. Nothing the
extension reads or stores ever leaves your browser.

## What the extension stores

All of it lives in `browser.storage.local`, on your machine, and is readable and
erasable from the extension's popup or by uninstalling the extension.

| What | Why |
| --- | --- |
| Authorized origins | The list of sites allowed to talk to the extension (by default the four InfoGata apps). You control this list in the popup. |
| Credential decisions | Which hosts you have allowed or blocked a plugin from using your login for, and which app asked. |
| Site redirect rules | Rules registered by an InfoGata app so the extension can offer to open a matching page in that app. |
| Redirect preferences | Whether redirects are on, which rules you have silenced, and your preferred app per plugin. |
| Theme preference | Whether the popup follows your system theme or is pinned to light or dark. |

None of this is transmitted anywhere.

## What the extension does with network requests

The extension's purpose is to make requests on behalf of plugins running inside
an InfoGata app, because a web page cannot fetch most third-party sites itself
(browsers block it under CORS).

- The request goes to whatever site the plugin asked for, and the response is
  handed back to the page that asked. It does not pass through any server of
  ours, because there isn't one.
- **Requests are sent without your cookies by default.** A plugin can nominate a
  site it needs your login for, but it cannot grant itself access: the extension
  asks you first, in a window that names the exact site, and remembers your
  answer. You can review and revoke every such decision in the popup.
- The extension does not read, log, or retain the contents of these responses.

## Signing in to a site

Some plugins can ask the extension to open a login window for a site, so the
plugin can act as you there afterwards.

- This always asks you first, and the prompt names every domain involved and the
  specific cookies and headers that will be captured.
- If you agree, the credentials that site issues during the login are passed
  back to the InfoGata app page that requested them. That page runs in your
  browser, on a site you authorized. The credentials are not sent to InfoGata,
  and the extension does not store them.
- If you decline, no login window opens and nothing is captured.

## Playing YouTube

YouTube only streams about a minute of a video to a player that cannot show a
token from YouTube's own anti-abuse check, and that check only works on
youtube.com itself. So when an InfoGata app plays a YouTube video, the extension
gets that token for it:

- It loads youtube.com in a hidden frame inside the app's tab, runs YouTube's
  check there, and hands the resulting token to the app page that asked. The
  token is tied to the video being played.
- **The frame does not use your YouTube account.** It is loaded without your
  cookies, every request YouTube's page makes from it goes out without any
  cookies, and YouTube's responses cannot set cookies. A cookie YouTube's page
  sets for itself in the frame is never sent back to YouTube. YouTube sees an
  anonymous visitor.
- YouTube does see what any website you contact sees: your IP address and
  browser, and that the frame was opened from an InfoGata app.
- The frame is removed after ten minutes without playback, or when you close or
  leave the app. Nothing from it is stored, and nothing is sent to InfoGata.
- Plugins cannot run their own code in the frame. They can only ask for a token
  for a video.

## Permissions

The extension requests access to all sites. It has to: which sites a plugin
needs is decided by the plugins you install, so the list cannot be known ahead
of time. That access is used only to make the requests a plugin explicitly asks
for. It is not used to read pages you browse — the extension only injects code
into the origins on your authorized list.

`STORE.md` in this repository explains, permission by permission, what each one
is used for.

## Children

The extension is not directed at children and collects nothing from anyone.

## Changes

Material changes to this policy will be recorded in this file, and the date at
the top will be updated. The file's history is public in the repository.

## Contact

Open an issue at <https://github.com/InfoGata/infogata-extension/issues>.
