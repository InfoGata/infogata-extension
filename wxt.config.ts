import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'InfoGata Extension',
    description: 'Extension for Audiogata, Videogata, ReaderGata, and SocialGata',
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
