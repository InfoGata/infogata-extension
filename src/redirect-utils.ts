import { SiteRedirectRule } from "./types";

export const urlMatchesPattern = (url: string, pattern: string): boolean => {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(url);
};

export const resolvePatternRedirect = (
  url: string,
  rule: SiteRedirectRule
): string | undefined => {
  if (!rule.patternRedirects || rule.patternRedirects.length === 0) {
    return undefined;
  }
  const URLPatternCtor = (globalThis as any).URLPattern;
  if (typeof URLPatternCtor !== "function") {
    return undefined;
  }
  for (const pr of rule.patternRedirects) {
    let result: any;
    try {
      result = new URLPatternCtor(pr.pattern).exec(url);
    } catch {
      continue;
    }
    if (!result) continue;
    const groups: Record<string, string> = {};
    for (const part of [
      "protocol",
      "username",
      "password",
      "hostname",
      "port",
      "pathname",
      "search",
      "hash",
    ] as const) {
      const partGroups = result[part]?.groups;
      if (partGroups) {
        for (const [k, v] of Object.entries(partGroups)) {
          if (typeof v === "string") groups[k] = v;
        }
      }
    }
    return pr.redirectPath.replace(
      /:([A-Za-z_][A-Za-z0-9_]*)/g,
      (_, name) => encodeURIComponent(groups[name] ?? "")
    );
  }
  return undefined;
};
