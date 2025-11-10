import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    watch: {
      // Improve reliability of HMR on some Windows/OneDrive setups
      usePolling: true,
      interval: 150,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: 'localhost',
    port: 5174,
  },
});
