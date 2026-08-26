import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  hooks: {
    /**
     * The debug page is a development tool: it drives the background worker's
     * privileged fetch with whatever URL and headers you type. Shipping it put
     * ~200 kB of React in every release and handed a store reviewer a page that
     * looks exactly like the thing the extension promises not to be. The popup
     * button that opens it is already dev-only, so nothing references it.
     */
    "entrypoints:resolved": (wxt, entrypoints) => {
      if (wxt.config.mode !== "production") return;
      for (const entrypoint of entrypoints) {
        if (entrypoint.name === "debug") entrypoint.skipped = true;
      }
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: 'InfoGata Extension',
    description: 'Extension for Audiogata, Videogata, ReaderGata, and SocialGata',
    version: '1.2.0',
    permissions: [
      'storage',
      'tabs',
      'scripting',
      'webRequest',
      'declarativeNetRequest',
      ...(browser === 'firefox' ? ['webRequestBlocking'] : []),
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_popup: 'popup.html',
    },
    web_accessible_resources: [
      {
        resources: ['content-script.js'],
        matches: ['<all_urls>'],
      },
    ],
    browser_specific_settings: {
      gecko: {
        id: 'infogata-extension@infogata.com',
      },
    },
  }),
});
