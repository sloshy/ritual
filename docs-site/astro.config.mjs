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
                'commands/deck',
                'commands/new-deck',
                'commands/import',
                'commands/import-account',
                'commands/get-primer',
                'commands/deck-sync',
                'commands/price',
              ],
            },
            {
              label: 'Collection Management',
              items: ['commands/collection', 'commands/price-collection'],
            },
            {
              label: 'Wanted List Management',
              items: ['commands/wanted', 'commands/price-wanted'],
            },
            {
              label: 'Card Management',
              items: ['commands/move', 'commands/history', 'commands/import-csv'],
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
              items: ['commands/cache', 'commands/cache-server'],
            },
            {
              label: 'Scripting',
              items: ['commands/add-card', 'commands/add-note', 'commands/clear-note'],
            },
            {
              label: 'Utilities',
              items: [
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
