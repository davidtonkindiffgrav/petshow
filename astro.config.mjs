import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static',
  integrations: [tailwind()],
  base: '/petshow',
  site: 'https://davidtonkindiffgrav.github.io',
});
