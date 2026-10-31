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
      components: {
        Footer: './src/components/Footer.astro',
        // Starlight's header has no navigation of its own; the one overridable
        // header slot carries a link to the live demo (see the file).
        SocialIcons: './src/components/HeaderLinks.astro',
      },
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
        {
          label: 'Start Here',
          items: ['start/install', 'start/first-deck', 'start/tour'],
        },
        {
          label: 'Guides',
          items: [
            'guides/publish-site',
            'guides/archidekt-sync',
            'guides/collection-trade-sell',
            'guides/ai-agents',
            'guides/public-edits',
          ],
        },
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
              label: 'Get started',
              items: [
                'commands/new',
                'commands/import',
                'commands/add-card',
                'commands/edit',
                'commands/admin',
              ],
            },
            {
              label: 'Look up and price',
              items: ['commands/lists', 'commands/card', 'commands/scry', 'commands/price'],
            },
            {
              label: 'Publish',
              items: ['commands/build-site', 'commands/serve'],
            },
            {
              label: 'Lists',
              items: [
                'commands/rename',
                'commands/delete',
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
                'commands/remove-card',
                'commands/set-card',
                'commands/note',
                'commands/move',
              ],
            },
            {
              label: 'Import & Export',
              items: ['commands/import-account', 'commands/import-changes', 'commands/export'],
            },
            {
              label: 'Lookup & Pricing',
              items: ['commands/sell'],
            },
            {
              label: 'Site',
              items: ['commands/init-site'],
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
                'commands/self-update',
                'commands/config',
                'commands/locale',
                'commands/license',
              ],
            },
            {
              label: 'Advanced',
              items: [
                'commands/migrate',
                'commands/detect-changes',
                'commands/list-all-cards',
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
        { slug: 'attribution' },
      ],
    }),
  ],
})
