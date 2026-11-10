import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Relative base so the build works on GitHub Pages under /windowwise/.
// Two pages: the app and the embeddable widget.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        embed: resolve(import.meta.dirname, 'embed.html'),
      },
    },
  },
});
