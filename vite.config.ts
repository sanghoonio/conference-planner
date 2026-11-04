import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any static path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [react()],
});
