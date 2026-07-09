import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // проксируем API на бэкенд disbit, чтобы работать с теми же данными
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
});
