export const HookMessageType = {
  Response: "infogata-extension-response",
  Request: "infogata-extension-request",
} as const;
export type MessageType = typeof HookMessageType[keyof typeof HookMessageType];

export const ContentMessageType = {
  NetworkRequest: "network-request",
} as const;
export type ContentMessageType =
  typeof ContentMessageType[keyof typeof ContentMessageType];
