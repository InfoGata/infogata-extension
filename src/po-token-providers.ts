/**
 * Sites the extension can mint proof-of-origin tokens for.
 *
 * Some sites (YouTube) run BotGuard and refuse to stream much to a client that
 * cannot show a token minted by it. BotGuard only yields a usable token when it
 * runs on the site's own origin, which a plugin never does, so the extension
 * loads the site in a hidden frame inside the app's tab and mints there.
 *
 * The page-facing API only names an origin and a content binding. Everything
 * specific to a site lives in this table, so a site change is a change here.
 */

export type PoTokenProvider = {
  /** Loaded in the hidden frame. Its marker query is what the header rule matches. */
  frameUrl: string;
  /** Tokens are bound to this; anything else is refused before a frame exists. */
  bindingPattern: RegExp;
  /** An inline script on the frame's page whose argument carries the challenge. */
  challengeCall: string;
  /** Identifies the site to the integrity token exchange. */
  requestKey: string;
  /** Path on the provider's origin that exchanges a BotGuard response for an integrity token. */
  integrityTokenPath: string;
};

export const PO_TOKEN_MINTER_MARKER = "infogata-po-minter";

export const PO_TOKEN_PROVIDERS: Record<string, PoTokenProvider> = {
  "https://www.youtube.com": {
    frameUrl: `https://www.youtube.com/?${PO_TOKEN_MINTER_MARKER}=1`,
    // Video ids
    bindingPattern: /^[A-Za-z0-9_-]{11}$/,
    challengeCall: "window.ytAtN(",
    requestKey: "O43z0dpjhgX20SCx4KAo",
    integrityTokenPath: "/api/jnn/v1/GenerateIT",
  },
};

/**
 * Values a plugin may substitute when a site changes them faster than the
 * extension can ship. Both are data: the key is opaque, and the path stays on
 * the provider's origin.
 */
export type PoTokenOverrides = {
  requestKey?: string;
  integrityTokenPath?: string;
};

/** What the page script needs, with any overrides applied. */
export type PoTokenMintConfig = {
  origin: string;
  marker: string;
  challengeCall: string;
  requestKey: string;
  integrityTokenPath: string;
};

/** Where po-minter.js leaves its API on the frame's window. */
export const PO_MINTER_GLOBAL = "__infogataPoMinter";

export type PoMinterApi = {
  mint: (config: PoTokenMintConfig, contentBinding: string) => Promise<string>;
};

export type PoTokenRequestCheck =
  | { ok: true; provider: PoTokenProvider; config: PoTokenMintConfig }
  | { ok: false; error: string };

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// The second character is not a slash: "//host/path" is protocol-relative and
// would take the exchange to another origin.
const PATH_PATTERN = /^\/[A-Za-z0-9_\-.][A-Za-z0-9_\-/.]{0,199}$/;

/** Everything the page sends is checked here before any frame is created. */
export const checkPoTokenRequest = (
  origin: unknown,
  contentBinding: unknown,
  overrides?: unknown
): PoTokenRequestCheck => {
  const provider =
    typeof origin === "string" && Object.hasOwn(PO_TOKEN_PROVIDERS, origin)
      ? PO_TOKEN_PROVIDERS[origin]
      : undefined;
  if (typeof origin !== "string" || !provider) {
    return { ok: false, error: `Cannot mint tokens for ${String(origin)}` };
  }
  if (typeof contentBinding !== "string" || !provider.bindingPattern.test(contentBinding)) {
    return { ok: false, error: "Invalid content binding" };
  }

  const config: PoTokenMintConfig = {
    origin,
    marker: PO_TOKEN_MINTER_MARKER,
    challengeCall: provider.challengeCall,
    requestKey: provider.requestKey,
    integrityTokenPath: provider.integrityTokenPath,
  };

  if (overrides !== undefined) {
    if (typeof overrides !== "object" || overrides === null) {
      return { ok: false, error: "Invalid overrides" };
    }
    const { requestKey, integrityTokenPath } = overrides as PoTokenOverrides;
    if (requestKey !== undefined) {
      if (typeof requestKey !== "string" || !REQUEST_KEY_PATTERN.test(requestKey)) {
        return { ok: false, error: "Invalid requestKey override" };
      }
      config.requestKey = requestKey;
    }
    if (integrityTokenPath !== undefined) {
      // A path, not a url, so the exchange cannot leave the provider's origin;
      // `..` is refused because it has no business in an endpoint path.
      if (
        typeof integrityTokenPath !== "string" ||
        !PATH_PATTERN.test(integrityTokenPath) ||
        integrityTokenPath.includes("..")
      ) {
        return { ok: false, error: "Invalid integrityTokenPath override" };
      }
      config.integrityTokenPath = integrityTokenPath;
    }
  }

  return { ok: true, provider, config };
};
