import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  server: { port: 5190 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { maplibre: ['maplibre-gl'], echarts: ['echarts'], react: ['react', 'react-dom', 'zustand'] },
      },
    },
  },
});
