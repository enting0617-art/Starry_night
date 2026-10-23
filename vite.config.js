import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendUrl = process.env.LOCAL_CHAT_BACKEND_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT || 5173),
    proxy: {
      '/api': backendUrl,
    },
  },
});
