import preact from '@preact/preset-vite';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [preact()],
    build: {
      // Electron ships a current Chromium, no need to transpile down.
      target: 'esnext',
    },
  },
});
