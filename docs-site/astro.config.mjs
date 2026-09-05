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
      // Root-only: these docs are English and are not localized (localizing
      // Ritual's *UI* is a separate thing — see src/content/docs/localization.md).
      // Declaring the root locale explicitly costs nothing and is what a future
      // translated docs tree would extend.
      locales: { root: { label: 'English', lang: 'en' } },
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
        {
          label: 'Concepts',
          items: [
            'list-format',
            'list-resolution',
            'configuration',
            'cli-conventions',
            'localization',
          ],
        },
        {
          label: 'Features',
          items: ['custom-art', 'list-images'],
        },
        {
          label: 'Commands',
          items: [
            { label: 'Overview', slug: 'commands' },
            {
              label: 'Lists',
              items: [
                'commands/lists',
                'commands/new',
                'commands/rename',
                'commands/delete',
                'commands/edit',
                'commands/metadata',
                'commands/categories',
                'commands/set-list-image',
                'commands/history',
                'commands/diff',
                'commands/get-primer',
              ],
            },
            {
              label: 'Cards',
              items: [
                'commands/add-card',
                'commands/remove-card',
                'commands/set-card',
                'commands/note',
                'commands/move',
              ],
            },
            {
              label: 'Import & Export',
              items: [
                'commands/import',
                'commands/import-account',
                'commands/import-changes',
                'commands/export',
              ],
            },
            {
              label: 'Lookup & Pricing',
              items: ['commands/card', 'commands/scry', 'commands/price', 'commands/sell'],
            },
            {
              label: 'Site',
              items: [
                'commands/build-site',
                'commands/serve',
                'commands/init-site',
                'commands/admin',
              ],
            },
            {
              label: 'Integrations',
              items: [
                'commands/login',
                'commands/deck-sync',
                'commands/collection-sync',
                'commands/mcp',
                'commands/skills',
              ],
            },
            {
              label: 'Utilities',
              items: [
                'commands/cache',
                'commands/cleanup',
                'commands/detect-changes',
                'commands/list-all-cards',
                'commands/config',
                'commands/locale',
                'commands/license',
                'commands/dep-license',
              ],
            },
          ],
        },
        {
          label: 'Public Site',
          items: [
            { label: 'Overview', slug: 'public-site' },
            'public-site/browsing',
            'public-site/filtering',
            'public-site/prices',
            'public-site/editing',
            'public-site/combined-view',
            'public-site/find',
            'public-site/find-printings',
            'public-site/trade',
            'public-site/sell',
            'public-site/mobile',
            'public-site/hosted',
          ],
        },
        {
          label: 'Admin Site',
          items: [
            { label: 'Overview', slug: 'admin' },
            'admin/editors',
            'admin/manage-lists',
            'admin/dashboard',
            'admin/import',
            'admin/move-cards',
            'admin/history',
            'admin/sync-decks',
            'admin/sync-collection',
            'admin/api',
          ],
        },
        { label: 'Hosting', items: ['docker'] },
        { slug: 'development' },
      ],
    }),
  ],
})
