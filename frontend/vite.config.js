import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API-kall går til Node-serveren (npm run server), så nøkkelen aldri når nettleseren.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
