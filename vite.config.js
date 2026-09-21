import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        presentation: './presentation.html'
      }
    }
  },
  server: {
    port: 5173,
    open: true
  }
});
