// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'

export default defineConfig({
  site: 'https://ritual.rpeters.dev',
  integrations: [
    starlight({
      title: 'Ritual',
      description: 'An All-In-One "Magic: The Gathering" Toolkit',
      favicon: '/app.svg',
      logo: { src: './src/assets/app.svg', alt: 'Ritual flame logo' },
      customCss: ['./src/styles/custom.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/sloshy/ritual',
        },
      ],
      plugins: [
        starlightLinksValidator({
          // Docs legitimately reference localhost URLs (e.g. `ritual serve`).
          errorOnLocalLinks: false,
        }),
      ],
      sidebar: [
        { label: 'Getting Started', link: '/' },
        { slug: 'configuration' },
        { slug: 'docker' },
        {
          label: 'Commands',
          items: [
            { label: 'Overview', slug: 'commands' },
            { label: 'Account & Auth', items: ['commands/login'] },
            {
              label: 'Deck Management',
              items: [
                'commands/new-deck',
                'commands/import-account',
                'commands/get-primer',
                'commands/deck-sync',
              ],
            },
            {
              label: 'Card Management',
              items: [
                'commands/edit',
                'commands/price',
                'commands/move',
                'commands/history',
                'commands/import',
                'commands/import-csv',
                'commands/import-changes',
                'commands/export',
              ],
            },
            {
              label: 'Card Lookup',
              items: ['commands/card', 'commands/scry', 'commands/random'],
            },
            {
              label: 'Site',
              items: [
                'commands/build-site',
                'commands/serve',
                'commands/serve-site',
                'commands/init-site',
                'commands/admin',
              ],
            },
            {
              label: 'Integrations',
              items: ['commands/mcp', 'commands/skills'],
            },
            {
              label: 'Cache',
              items: ['commands/cache', 'commands/cache-server', 'commands/cache-feed'],
            },
            {
              label: 'Scripting',
              items: ['commands/add-card', 'commands/add-note', 'commands/clear-note'],
            },
            {
              label: 'Utilities',
              items: [
                'commands/cleanup',
                'commands/config-set',
                'commands/git-detect-changes',
                'commands/hash',
                'commands/list-all-cards',
              ],
            },
            {
              label: 'Reference',
              items: ['commands/list-resolution'],
            },
            {
              label: 'Legal',
              items: ['commands/license', 'commands/dep-license'],
            },
          ],
        },
        {
          label: 'Public Site',
          items: [
            'public-site/filtering',
            'public-site/combined-view',
            'public-site/find',
            'public-site/mobile',
          ],
        },
        {
          label: 'Admin Site',
          items: [
            { label: 'Overview', slug: 'admin' },
            'admin/editors',
            'admin/move-cards',
            'admin/manage-lists',
            'admin/history',
            'admin/api',
          ],
        },
        { slug: 'development' },
      ],
    }),
  ],
})
