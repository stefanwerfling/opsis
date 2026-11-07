import { defineConfig } from 'vite';

const apiTarget = process.env['OPSIS_API_URL'] ?? 'http://127.0.0.1:4777';

export default defineConfig({
  resolve: {
    // Use the TypeScript sources of @opsis/core directly (no prior build needed).
    conditions: ['source'],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // The Host header is kept (changeOrigin: false), so the server's host/origin guard
    // sees localhost:5173 for both Host and Origin and accepts the request.
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2023',
    sourcemap: true,
  },
});
