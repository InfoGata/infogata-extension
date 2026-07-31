export type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === "string" &&
  THEME_PREFERENCES.includes(value as ThemePreference);

export const getThemePreference = async (): Promise<ThemePreference> => {
  try {
    const items = await browser.storage.local.get([THEME_STORAGE_KEY]);
    const stored = items?.[THEME_STORAGE_KEY];
    if (isThemePreference(stored)) {
      return stored;
    }
  } catch (e) {
    console.log("Unable to read theme preference:", e);
  }

  return "system";
};

export const storeThemePreference = async (theme: ThemePreference) => {
  await browser.storage.local.set({ [THEME_STORAGE_KEY]: theme });
};

/**
 * "system" leaves data-theme off entirely so the prefers-color-scheme fallback
 * in popup.css decides. Guarded because popup-script.test.ts stubs `document`.
 */
export const applyTheme = (theme: ThemePreference) => {
  if (typeof document === "undefined" || !document.documentElement) return;

  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
};
