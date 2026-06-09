import { URLPattern } from "urlpattern-polyfill";

if (typeof (globalThis as any).URLPattern !== "function") {
  (globalThis as any).URLPattern = URLPattern;
}
