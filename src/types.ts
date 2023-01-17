export const ContentMessageType = {
  NetworkRequest: "network-request",
} as const;
export type ContentMessageType =
  typeof ContentMessageType[keyof typeof ContentMessageType];

export type HookMessage = {
  type: "infogata-extension-request";
  input: RequestInfo;
  init: RequestInit;
  uid: number;
};

export type ContentMessage = {
  type: "infogata-extension-response";
  result: NetworkRequest;
  uid: number;
};

export interface SharedRequest {
  headers: Record<string, string>;
  status: number;
  statusText: string;
  url: string;
}

export interface HandleRequestResponse extends SharedRequest {
  base64: string | ArrayBuffer;
}

export interface NetworkRequest extends SharedRequest {
  body: Blob | ArrayBuffer;
}
