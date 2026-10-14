import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    sourcemap: mode !== 'demo',
    // The demo build is shared as a single page, so fonts are embedded rather than separate files.
    assetsInlineLimit: mode === 'demo' ? 10_000_000 : 4096,
  },
}));
