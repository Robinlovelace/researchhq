import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rawBase = process.env.RESEARCHHQ_BASE_PATH ?? '';
const normalizedBase: '' | `/${string}` =
  rawBase && rawBase !== '/' ? `/${rawBase.replace(/^\/+|\/+$/g, '')}` : '';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({
        pages: 'build',
        assets: 'build',
        fallback: '404.html',
        precompress: false,
        strict: true
      }),
      paths: {
        base: normalizedBase
      },
      prerender: {
        handleHttpError: 'warn'
      }
    })
  ]
});
