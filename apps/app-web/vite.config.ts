import { installGlobals } from '@remix-run/node';
import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';

installGlobals();

export default defineConfig({
  plugins: [remix()],
  server: { port: 5173 },
});
