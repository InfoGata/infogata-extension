import { RedirectPreferences, SiteRedirectRule } from "./types";

export const getRuleKey = (rule: SiteRedirectRule): string =>
  `${rule.appOrigin}::${rule.pluginId}`;

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

export const ruleMatchesUrl = (url: string, rule: SiteRedirectRule): boolean => {
  if (resolvePatternRedirect(url, rule)) return true;
  return rule.siteMatchPatterns.some((pattern) =>
    urlMatchesPattern(url, pattern)
  );
};

export const buildRedirectUrl = (
  url: string,
  rule: SiteRedirectRule
): string =>
  `${rule.appOrigin}${resolvePatternRedirect(url, rule) ?? rule.redirectPath}`;

const isDefaultOrigin = (
  rule: SiteRedirectRule,
  preferences: RedirectPreferences
): boolean => preferences.defaultOrigins?.[rule.pluginId] === rule.appOrigin;

export const findMatchingRule = (
  url: string,
  rules: SiteRedirectRule[],
  preferences: RedirectPreferences
): SiteRedirectRule | undefined => {
  if (!preferences.globalEnabled) return undefined;
  const matches = rules.filter(
    (rule) =>
      !preferences.dismissedRuleKeys.includes(getRuleKey(rule)) &&
      ruleMatchesUrl(url, rule)
  );
  if (matches.length === 0) return undefined;
  const preferred = matches.find((rule) => isDefaultOrigin(rule, preferences));
  return preferred ?? matches[0];
};

/**
 * Every rule matching `url`, ignoring dismissals and the global toggle: the
 * popup offers these on explicit user action, which is the whole point when the
 * banner has already been closed. Within each plugin, its default origin sorts
 * first; plugins keep their registration order.
 */
export const findMatchingRules = (
  url: string,
  rules: SiteRedirectRule[],
  preferences: RedirectPreferences
): SiteRedirectRule[] => {
  const byPlugin = new Map<string, SiteRedirectRule[]>();
  for (const rule of rules) {
    if (!ruleMatchesUrl(url, rule)) continue;
    const group = byPlugin.get(rule.pluginId);
    if (group) group.push(rule);
    else byPlugin.set(rule.pluginId, [rule]);
  }
  return [...byPlugin.values()].flatMap((group) => [
    ...group.filter((rule) => isDefaultOrigin(rule, preferences)),
    ...group.filter((rule) => !isDefaultOrigin(rule, preferences)),
  ]);
};
