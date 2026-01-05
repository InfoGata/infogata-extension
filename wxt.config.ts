import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: 'InfoGata Extension',
    description: 'Extension for Audiogata, Videogata, ReaderGata, and SocialGata',
    version: '1.1.0',
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
  }),
  experimental: {
    entrypointLoader: true,
  },
});
