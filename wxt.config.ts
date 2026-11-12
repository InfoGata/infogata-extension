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
  zip: {
    // Test coverage reports are local and git-ignored, but wxt zips sources
    // from disk, so a leftover run used to end up in the AMO source archive.
    excludeSources: ["coverage/**"],
  },
  manifest: ({ browser }) => ({
    name: 'InfoGata Extension',
    description: 'Extension for Audiogata, Videogata, ReaderGata, and SocialGata',
    // `scripting` and `declarativeNetRequest` are MV3 APIs: every call to them
    // is behind `isMv3`. Firefox (MV2) injects with `tabs.executeScript`, which
    // the host permission covers, and rewrites headers with blocking
    // `webRequest`. Requesting them there would add an install warning for
    // permissions nothing uses.
    permissions: [
      'storage',
      'tabs',
      'webRequest',
      ...(browser === 'firefox'
        ? ['webRequestBlocking']
        : ['scripting', 'declarativeNetRequest']),
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_popup: 'popup.html',
    },
    // No web_accessible_resources. content-script.js used to be listed here for
    // every URL, which let any page probe for it and fingerprint the extension.
    // It is injected with executeScript({ file }), which does not need the
    // resource to be web accessible -- hook.js is injected the same way and was
    // never listed.
    browser_specific_settings: {
      gecko: {
        id: 'infogata-extension@infogata.com',
        // Nothing is collected, used, transferred, or shared outside the local
        // browser: no InfoGata server, no analytics, no telemetry. Requests the
        // extension makes are the plugin's own, to sites the user's plugins
        // target, and captured login credentials go back to the page that asked
        // for them and nowhere else. See PRIVACY.md.
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  }),
});
