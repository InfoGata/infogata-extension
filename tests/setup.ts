import { URLPattern } from "urlpattern-polyfill";

if (typeof (globalThis as any).URLPattern !== "function") {
  (globalThis as any).URLPattern = URLPattern;
}

// Under jsdom, the global TextEncoder comes from Node's realm, so the Uint8Array
// it returns is not `instanceof` jsdom's Uint8Array. esbuild asserts that
// invariant when it loads, and throws. Re-wrap the result in the current realm.
if (!(new TextEncoder().encode("") instanceof Uint8Array)) {
  const NodeTextEncoder = TextEncoder;
  (globalThis as any).TextEncoder = class extends NodeTextEncoder {
    encode(input?: string) {
      return new Uint8Array(super.encode(input));
    }
  };
}
