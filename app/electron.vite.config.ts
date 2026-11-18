import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The permission inspector runs as its own script for every tool call (0028 section 3).
        input: { index: resolve('src/main/index.ts'), inspect: resolve('src/core/permissions/inspectEntry.ts') },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        // A sandboxed preload must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
