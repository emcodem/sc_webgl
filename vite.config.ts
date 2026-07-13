import { defineConfig } from 'vite';

// Static web app, deployed to GitHub Pages. `base` is relative so the built assets resolve
// regardless of the repo-name subpath the site ends up served from.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'es2022',
    sourcemap: true
  }
});
