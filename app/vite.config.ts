import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/target/**', '**/dist/**', '**/playwright-report/**', '**/test-results/**']
    }
  },
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/i18nSetup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    exclude: ['e2e/**', 'dist/**', 'node_modules/**']
  }
});
