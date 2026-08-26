# Security Policy

## Reporting a vulnerability

Please report privately rather than in a public issue.

Use GitHub's private reporting:
<https://github.com/InfoGata/infogata-extension/security/advisories/new>.

Include what you can — the version, the browser, what an attacker gains, and the
steps to reproduce. A proof-of-concept plugin or page is ideal but not required.

You should get an acknowledgement within a week. This is a small project with no
bounty programme; what you will get is credit in the release notes, unless you
would rather not be named.

## Supported versions

The latest released version is the one that gets fixes. There are no long-term
support branches.

## What counts

The extension exists to make requests a web page cannot make itself, so the
whole security story is about what a plugin can talk the extension into doing.
Reports along these lines are especially welcome:

- A plugin obtaining the user's cookies for a host the user never allowed, or
  otherwise getting `credentials: "include"` onto a request that should be
  anonymous.
- Bypassing the consent window: answering a prompt from outside the extension's
  own consent page, forging a decision, or getting a grant recorded for a host
  other than the one displayed.
- The login flow capturing headers or cookies for a domain the prompt did not
  name.
- A site registering redirect rules that impersonate another app, or a redirect
  that navigates somewhere other than the origin the popup displayed.
- Any page outside the user's authorized-origins list reaching the background
  worker's privileged fetch.
- Escaping the origin checks on the content script or the `window.InfoGata` hook.

`CLAUDE.md` lists the invariants these depend on, and the reasoning behind each
lives in the commit that introduced it.

## What does not count

- Reports that require the user to have already authorized a hostile origin in
  the popup, or to have already allowed a host at the consent prompt. Those are
  the user's decisions, and the extension is doing what it was told.
- The breadth of the `<all_urls>` host permission by itself. It is inherent to
  what the extension does; `STORE.md` explains why. A demonstration that the
  permission is used for something *beyond* a plugin's explicit request is very
  much in scope.
- Findings in the InfoGata web apps or their plugins rather than the extension —
  report those on the relevant repository.
- Dependency advisories with no reachable path from extension code. The build
  ships no third-party runtime dependency with a known advisory; `npm audit`
  findings are currently confined to build tooling.
