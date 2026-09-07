import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/main/**/*.test.js', 'tests/**/*.test.js'],
    globals: true,
  },
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'tests/mocks/electron.js'),
    },
  },
});
