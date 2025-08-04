import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'InfoGata Extension',
    description: 'Extension for Audiogata, Videogata, and ReaderGata',
    version: '1.1.0',
    permissions: ['storage', 'tabs', 'scripting', 'webRequest', 'declarativeNetRequest'],
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
  },
  experimental: {
    entrypointLoader: true,
  },
});
