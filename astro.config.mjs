// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static output: every page renders at build time and works without JavaScript.
export default defineConfig({
  site: 'https://asadalk.github.io',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
});
