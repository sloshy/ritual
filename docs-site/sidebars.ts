import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
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
        'commands/new-deck',
        'commands/import',
        'commands/import-account',
        'commands/login',
        'commands/cache',
        'commands/cache-server',
        'commands/card',
        'commands/random',
        'commands/scry',
        'commands/price',
        'commands/price-collection',
        'commands/price-wanted',
        'commands/add-card',
        'commands/deck-sync',
        'commands/collection',
        'commands/wanted',
        'commands/build-site',
        'commands/init-site',
        'commands/serve',
        'commands/admin',
        'commands/get-primer',
        'commands/git-detect-changes',
        'commands/license',
        'commands/dep-license',
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
