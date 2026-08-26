export type BackgroundOpenLogin = {
  type: "open-login";
  auth: ManifestAuthentication;
  pluginId: string;
};

export type BackgroundExecuteHook = {
  type: "execute-hook";
};

export interface SerializableRequestInit {
  headers?: HeadersInit;
  mode?: RequestMode;
  method?: string;
  credentials?: RequestCredentials;
  body?: string;
  bodyIsBase64?: boolean;
}

export type BackgroundNetworkRequest = {
  type: "network-request";
  input: string;
  init?: SerializableRequestInit;
  options?: NetworkRequestOptions;
};

export type BackgroundMessage =
  | BackgroundExecuteHook
  | BackgroundNetworkRequest
  | BackgroundOpenLogin
  | BackgroundRegisterRedirects
  | BackgroundDismissRedirect
  | BackgroundGetRedirectRules
  | BackgroundSetRedirectEnabled
  | BackgroundUndismissRedirect
  | BackgroundDeleteRedirect
  | BackgroundSetDefaultRedirectOrigin
  | BackgroundConsentDecision
  | BackgroundGetCredentialHosts
  | BackgroundRevokeCredentialHost;

/** Why the user is being asked to hand a plugin their login for a host. */
export type ConsentKind = "request" | "login";

export type BackgroundConsentDecision = {
  type: "consent-decision";
  id: string;
  allowed: boolean;
  hosts: string[];
};

export type BackgroundGetCredentialHosts = {
  type: "get-credential-hosts";
};

export type BackgroundRevokeCredentialHost = {
  type: "revoke-credential-host";
  host: string;
};

export type HookRequest = {
  type: "infogata-extension-request";
  input: string;
  init?: SerializableRequestInit;
  uid: number;
  options?: NetworkRequestOptions;
};

export type HookOpenLogin = {
  type: "infogata-extension-openlogin-hook";
  auth: ManifestAuthentication;
  pluginId: string;
};

export type HookGetVersion = {
  type: "infogata-extension-getversion-hook";
  uid: number;
};

export type HookMessage = HookRequest | HookOpenLogin | HookGetVersion | HookRegisterRedirects;

export type ContentResponse = {
  type: "infogata-extension-response";
  result?: NetworkRequest;
  /**
   * Set when the request never produced a response. Without it the page has no
   * way to tell a failure from a message that simply never arrived, and its
   * promise stays pending forever.
   */
  error?: RequestFailure;
  uid: number;
};

export interface RequestFailure {
  message: string;
  name?: string;
}

export type ContentGetVersion = {
  type: "infogata-extension-getversion-content";
  result: string;
  uid: number;
};

export type ContentNotifyLogin = {
  type: "infogata-extension-notify-login";
  pluginId: string;
  headers: Record<string, string>;
  domainHeaders: Record<string, Record<string, string>>;
};

export type ContentMessage =
  | ContentResponse
  | ContentGetVersion
  | ContentNotifyLogin;

export type NotifyLogin = {
  type: "notify-login";
  pluginId: string;
  headers: Record<string, string>;
  domainHeaders: Record<string, Record<string, string>>;
};

export type TabMessage = NotifyLogin;

export type LoginMessage = LoginButtonMessage;

export type LoginButtonMessage = {
  type: "login-button";
  selector: string;
};

export interface SharedRequest {
  headers: Record<string, string>;
  status: number;
  statusText: string;
  url: string;
}

export interface HandleRequestResponse extends SharedRequest {
  base64: string | ArrayBuffer | null;
}

/** What the background worker answers a `network-request` with. */
export type HandleRequestResult =
  | HandleRequestResponse
  | { error: RequestFailure };

export interface NetworkRequest extends SharedRequest {
  body: Blob | ArrayBuffer | null;
}

export interface NetworkRequestOptions {
  auth?: ManifestAuthentication;
  /**
   * The plugin's declared siteMatch patterns. These *nominate* a host for
   * credentialed access; they do not grant it. The background worker rejects
   * patterns with a wildcard host, and asks the user before sending cookies to
   * any host it has no stored decision for. See `src/credential-hosts.ts`.
   */
  siteMatchPatterns?: string[];
}

export interface ManifestAuthentication {
  loginUrl: string;
  cookiesToFind?: string[];
  loginButton?: string;
  headersToFind?: string[];
  completionUrl?: string;
  domainHeadersToFind?: Record<string, string[]>;
}

export interface LoginTab {
  windowTab: Browser.tabs.Tab;
  senderTab: Browser.tabs.Tab;
  auth: ManifestAuthentication;
  foundCookies: boolean;
  foundHeaders: boolean;
  foundDomainHeaders: boolean;
  foundCompletionUrl: boolean;
  pluginId: string;
  headers: Record<string, string>;
  domainHeaders: Record<string, Record<string, string>>;
}

export interface ExecuteScriptOptions {
  world?: chrome.scripting.ExecutionWorld;
  file: string;
}

export interface RedirectPatternRule {
  pattern: string;
  redirectPath: string;
}

export interface SiteRedirectRule {
  pluginId: string;
  pluginName: string;
  appName: string;
  appOrigin: string;
  siteMatchPatterns: string[];
  redirectPath: string;
  patternRedirects?: RedirectPatternRule[];
}

export interface RedirectPreferences {
  globalEnabled: boolean;
  dismissedRuleKeys: string[];
  defaultOrigins?: Record<string, string>; // pluginId -> chosen appOrigin
}

export type HookRegisterRedirects = {
  type: "infogata-extension-register-redirects";
  rules: SiteRedirectRule[];
};

export type BackgroundRegisterRedirects = {
  type: "register-redirects";
  rules: SiteRedirectRule[];
};

export type BackgroundDismissRedirect = {
  type: "dismiss-redirect";
  ruleKey: string;
};

export type BackgroundGetRedirectRules = {
  type: "get-redirect-rules";
};

export type BackgroundSetRedirectEnabled = {
  type: "set-redirect-enabled";
  enabled: boolean;
};

export type BackgroundUndismissRedirect = {
  type: "undismiss-redirect";
  ruleKey: string;
};

export type BackgroundDeleteRedirect = {
  type: "delete-redirect";
  ruleKey: string;
};

export type BackgroundSetDefaultRedirectOrigin = {
  type: "set-default-redirect-origin";
  pluginId: string;
  appOrigin: string;
};
