import { Tabs } from "webextension-polyfill";

export type BackgroundOpenLogin = {
  type: "open-login";
  auth: ManifestAuthentication;
  pluginId: string;
};

export type BackgroundExecuteHook = {
  type: "execute-hook";
};

export type BackgroundNetworkRequest = {
  type: "network-request";
  input: string;
  init?: RequestInit;
  options?: NetworkRequestOptions;
};

export type BackgroundMessage =
  | BackgroundExecuteHook
  | BackgroundNetworkRequest
  | BackgroundOpenLogin;

export type HookRequest = {
  type: "infogata-extension-request";
  input: string;
  init?: RequestInit;
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

export type HookMessage = HookRequest | HookOpenLogin | HookGetVersion;

export type ContentResponse = {
  type: "infogata-extension-response";
  result: NetworkRequest;
  uid: number;
};

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

export interface NetworkRequest extends SharedRequest {
  body: Blob | ArrayBuffer | null;
}

export interface NetworkRequestOptions {
  auth?: ManifestAuthentication;
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
  windowTab: Tabs.Tab;
  senderTab: Tabs.Tab;
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
