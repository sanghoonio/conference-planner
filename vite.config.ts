import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Absolute base: views live at real paths (/posters, /calendar), so assets must not resolve relative to them.
export default defineConfig({
  base: '/',
  plugins: [react()],
});
