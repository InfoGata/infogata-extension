/**
 * Which hosts a plugin may borrow the user's login for.
 *
 * Cookies are the whole prize here: a request sent with `credentials: "include"`
 * reads a site exactly as the signed-in user, and the response body goes back to
 * the page that asked. The set of hosts that may happen for therefore cannot
 * come from the page -- it is a user decision, recorded here and revocable from
 * the popup.
 */

import { urlMatchesPattern } from "./redirect-utils";
import type { ManifestAuthentication, NetworkRequestOptions } from "./types";

export type HostDecision = "allow" | "deny";

export interface CredentialHostEntry {
  decision: HostDecision;
  /** The app origin whose plugin asked, so the popup can say who wanted it. */
  requester: string;
  decidedAt: number;
}

export type CredentialHostMap = Record<string, CredentialHostEntry>;

export const CREDENTIAL_HOSTS_KEY = "credentialHosts";

/**
 * Hosts are compared case-insensitively and without a port, so the popup shows
 * one row per site rather than one per origin the plugin happened to use.
 */
export const normalizeHost = (value: string): string | undefined => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  try {
    // Accept a bare host as well as a full URL.
    const url = trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.hostname || undefined;
  } catch {
    return undefined;
  }
};

export const hostFromUrl = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
};

/**
 * The host half of a plugin's siteMatch pattern, when the pattern names a site
 * specifically enough to be worth asking the user about.
 *
 * A pattern whose host is a bare wildcard is rejected outright: it is not a
 * declaration of which site the plugin needs, it is a request for every site at
 * once, and no consent prompt can meaningfully describe it. A leading `*.` is fine as long as a real registrable domain
 * follows, so `*.bandcamp.com` works and `*.com` does not.
 */
export const credentialPatternHost = (pattern: string): string | undefined => {
  const schemeEnd = pattern.indexOf("://");
  if (schemeEnd === -1) return undefined;
  const scheme = pattern.slice(0, schemeEnd);
  if (scheme !== "http" && scheme !== "https" && scheme !== "*") {
    return undefined;
  }

  const rest = pattern.slice(schemeEnd + 3);
  const slash = rest.indexOf("/");
  const hostSpec = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  if (!hostSpec) return undefined;

  // Strip a port before validating; it never changes which site this is.
  const host = hostSpec.replace(/:\d+$/, "");

  if (!host.includes("*")) {
    return /^[a-z0-9.-]+$/.test(host) ? host : undefined;
  }
  if (!host.startsWith("*.")) return undefined;

  const base = host.slice(2);
  if (base.includes("*") || !/^[a-z0-9.-]+$/.test(base)) return undefined;
  // "*.com" would hand over an entire TLD; require a registrable domain.
  if (base.split(".").filter(Boolean).length < 2) return undefined;
  return base;
};

/** Does `host` fall under the site named by `patternHost`? */
export const hostMatchesPatternHost = (
  host: string,
  patternHost: string
): boolean =>
  host === patternHost || host.endsWith(`.${patternHost}`);

export const loadCredentialHosts = async (): Promise<CredentialHostMap> => {
  try {
    const items = await browser.storage.local.get([CREDENTIAL_HOSTS_KEY]);
    const stored = items?.[CREDENTIAL_HOSTS_KEY];
    if (typeof stored === "string") {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") return parsed as CredentialHostMap;
    }
  } catch (e) {
    console.warn("[InfoGata] Unable to read credential hosts:", e);
  }
  return {};
};

export const storeCredentialHosts = async (hosts: CredentialHostMap) => {
  await browser.storage.local.set({
    [CREDENTIAL_HOSTS_KEY]: JSON.stringify(hosts),
  });
};

/**
 * Development-only escape hatch: answer every consent prompt with "allow"
 * instead of opening a window.
 *
 * Iterating on a plugin means a new host every few minutes, and a prompt each
 * time makes that unworkable. Every read of this flag is behind
 * `import.meta.env.DEV`, so the branch is compiled out of a release -- a
 * "skip consent" switch that survived into production would quietly undo the
 * guarantee the consent window exists to make.
 */
export const DEV_AUTO_CONSENT_KEY = "devAutoConsent";

export const loadDevAutoConsent = async (): Promise<boolean> => {
  try {
    const items = await browser.storage.local.get([DEV_AUTO_CONSENT_KEY]);
    return items?.[DEV_AUTO_CONSENT_KEY] === true;
  } catch {
    return false;
  }
};

export const storeDevAutoConsent = async (enabled: boolean) => {
  await browser.storage.local.set({ [DEV_AUTO_CONSENT_KEY]: enabled });
};

/**
 * Which host, if any, this request is asking to borrow the user's login for.
 *
 * The patterns come from the page, so they are treated as a nomination and
 * nothing more: a pattern has to name a real site (`credentialPatternHost`
 * rejects wildcard hosts), and the request URL has to actually be on that
 * site. Without both checks a plugin could pass a bare-wildcard host and turn
 * the scoped credential access below into every site the user is signed in to.
 */
export const credentialHostFor = (
  input: string,
  options?: NetworkRequestOptions
): string | undefined => {
  const host = hostFromUrl(input);
  if (!host) return undefined;

  for (const pattern of options?.siteMatchPatterns ?? []) {
    const patternHost = credentialPatternHost(pattern);
    if (!patternHost) {
      console.warn(
        `[InfoGata] Ignoring siteMatch pattern with a wildcard host: ${pattern}`
      );
      continue;
    }
    if (
      hostMatchesPatternHost(host, patternHost) &&
      urlMatchesPattern(input, pattern)
    ) {
      return host;
    }
  }

  // The login flow's own domains, which the user approved when they signed in.
  const auth = options?.auth;
  if (auth?.loginUrl) {
    if (loginPageHosts(auth).includes(host)) return host;
    const domains = Object.keys(auth.domainHeadersToFind ?? {});
    if (domains.some((d) => host.endsWith(d))) return host;
  }

  return undefined;
};

/**
 * The hosts a login window's pages are on: where it starts, and where it
 * ends. They can differ -- a site whose sign-in lives on its own service
 * (auth.example.com) sends the reader back to the site proper, and that is
 * the host the plugin's requests then need the login for. A `completionUrl`
 * may end in `?*`, which `URL` reads as a query and ignores.
 */
export const loginPageHosts = (
  auth: Pick<ManifestAuthentication, "loginUrl" | "completionUrl">
): string[] => {
  const hosts = [auth.loginUrl, auth.completionUrl]
    .map((url) => (url ? hostFromUrl(url) : undefined))
    .filter((h): h is string => !!h);
  return [...new Set(hosts)];
};
