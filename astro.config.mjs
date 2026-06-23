import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'static',
  integrations: [tailwind()],
  // Set base to match your GitHub repo name exactly.
  // If repo is at github.com/dptonkin/petshow → base: '/petshow'
  // If using a custom domain or root → base: '/'
  base: '/petshow',
  site: 'https://dptonkin.github.io',
});
