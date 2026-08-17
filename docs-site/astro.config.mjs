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
        { slug: 'configuration' },
        { slug: 'localization' },
        { slug: 'custom-art' },
        { slug: 'docker' },
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
              label: 'Cache',
              items: ['commands/cache'],
            },
            {
              label: 'Utilities',
              items: [
                'commands/cleanup',
                'commands/detect-changes',
                'commands/list-all-cards',
                'commands/config',
                'commands/locale',
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
            'public-site/hosted',
            'public-site/filtering',
            'public-site/sell',
            'public-site/combined-view',
            'public-site/find',
            'public-site/find-printings',
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
            'admin/sync-decks',
            'admin/sync-collection',
            'admin/api',
          ],
        },
        { slug: 'development' },
      ],
    }),
  ],
})
