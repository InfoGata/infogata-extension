export const HookMessageType = {
  Response: "mediagata-extension-response",
  Request: "mediagata-extension-request",
} as const;
export type MessageType = typeof HookMessageType[keyof typeof HookMessageType];

export const ContentMessageType = {
  NetworkRequest: "network-request",
} as const;
export type ContentMessageType =
  typeof ContentMessageType[keyof typeof ContentMessageType];
