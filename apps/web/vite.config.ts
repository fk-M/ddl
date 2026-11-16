import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // 构建时注入版本号，更新检查用它跟 GitHub Release 的 tag 比对
    __APP_VERSION__: JSON.stringify(process.env.DDL_VERSION_NAME ?? '0.1.0'),
  },
  resolve: {
    alias: {
      '@ddl/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/health': { target: 'http://127.0.0.1:3001' },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  root: rootDir,
});
