// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'
import starlightLinksValidator from 'starlight-links-validator'

const SITE = 'https://ritual.rpeters.dev'

export default defineConfig({
  site: SITE,
  // The Changelog page renders the repository's CHANGELOG.md, one level up.
  vite: { server: { fs: { allow: ['..'] } } },
  integrations: [
    starlight({
      title: 'Ritual',
      description: 'An All-In-One "Magic: The Gathering" Toolkit',
      favicon: '/app.svg',
      // Link previews: Starlight already emits og:title/description and
      // `twitter:card: summary_large_image`; this gives both the image they
      // need. Regenerate the PNGs with scripts/docs-og-image.ts.
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: `${SITE}/og.png` } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image:alt',
            content: 'Ritual: your Magic: The Gathering decks and collection as plain files.',
          },
        },
        { tag: 'meta', attrs: { name: 'twitter:image', content: `${SITE}/og.png` } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
      ],
      editLink: { baseUrl: 'https://github.com/sloshy/ritual/edit/main/docs-site/' },
      // From each page's last commit. The deploy workflow checks out full
      // history (fetch-depth: 0), which this needs.
      lastUpdated: true,
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
            'workspace',
            'card-cache',
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
                'commands/doctor',
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
            {
              label: 'Admin API',
              collapsed: true,
              items: [{ autogenerate: { directory: 'admin/api' } }],
            },
          ],
        },
        { label: 'Hosting', items: ['docker'] },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }, 'attribution'],
        },
        { slug: 'development' },
      ],
    }),
  ],
})
