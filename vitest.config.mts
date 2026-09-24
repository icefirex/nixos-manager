import { defineConfig } from 'vitest/config';
import path from 'path';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess() })],
  test: {
    include: ['src/main/**/*.test.{js,ts}', 'src/lib/**/*.test.ts', 'tests/**/*.test.{js,ts}'],
    globals: true,
  },
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'tests/mocks/electron.ts'),
    },
    // Testing Library svelte: force client-side (DOM) svelte runtime in tests
    conditions: process.env.VITEST ? ['browser'] : [],
  },
});
