import { defineConfig } from 'vitest/config';
import { WxtVitest } from "wxt/testing";

export default defineConfig({
  test: {
    mockReset: true,
    restoreMocks: true,
    setupFiles: ["./tests/setup.ts"]
  },
  plugins: [WxtVitest()]
});