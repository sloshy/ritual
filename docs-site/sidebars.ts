import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'configuration',
    'docker',
    {
      type: 'category',
      label: 'Commands',
      link: {
        type: 'generated-index',
        title: 'CLI Commands',
        description: 'All available commands in the MTG CLI.',
        slug: '/commands',
      },
      items: [
        {
          type: 'category',
          label: 'Account & Auth',
          items: ['commands/login'],
        },
        {
          type: 'category',
          label: 'Deck Management',
          items: [
            'commands/new-deck',
            'commands/import',
            'commands/import-account',
            'commands/get-primer',
            'commands/deck-sync',
            'commands/price',
          ],
        },
        {
          type: 'category',
          label: 'Collection Management',
          items: ['commands/collection', 'commands/price-collection'],
        },
        {
          type: 'category',
          label: 'Wanted List Management',
          items: ['commands/wanted', 'commands/price-wanted'],
        },
        {
          type: 'category',
          label: 'Card Lookup',
          items: ['commands/card', 'commands/scry', 'commands/random'],
        },
        {
          type: 'category',
          label: 'Site',
          items: ['commands/build-site', 'commands/serve', 'commands/init-site', 'commands/admin'],
        },
        {
          type: 'category',
          label: 'Cache',
          items: ['commands/cache', 'commands/cache-server'],
        },
        {
          type: 'category',
          label: 'Scripting',
          items: ['commands/add-card', 'commands/add-note', 'commands/clear-note'],
        },
        {
          type: 'category',
          label: 'Utilities',
          items: ['commands/config-set', 'commands/git-detect-changes', 'commands/list-all-cards'],
        },
        {
          type: 'category',
          label: 'Legal',
          items: ['commands/license', 'commands/dep-license'],
        },
      ],
    },
    {
      type: 'category',
      label: 'Admin Site',
      link: {
        type: 'generated-index',
        title: 'Admin Site',
        description: 'Documentation for the Ritual admin interface.',
        slug: '/admin',
      },
      items: ['admin/editors', 'admin/deck-manager', 'admin/api'],
    },
    'development',
  ],
}

export default sidebars
