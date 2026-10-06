import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:3000' } },
  test: {
    globals: true, environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
} as any);
