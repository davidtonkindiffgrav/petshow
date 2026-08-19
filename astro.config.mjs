import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  integrations: [
    tailwind(),
    sitemap({
      filter: (page) => !/\/(admin|auth|organiser|participant)\//.test(page),
    }),
  ],
  base: '/',
  site: 'https://www.furtofeathers.com',
});
