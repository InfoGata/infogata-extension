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
  result: any;
  uid: number;
};
