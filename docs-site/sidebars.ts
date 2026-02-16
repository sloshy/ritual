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
        'commands/card',
        'commands/random',
        'commands/scry',
        'commands/price',
        'commands/add-card',
        'commands/collection',
        'commands/build-site',
        'commands/serve',
      ],
    },
    'development',
  ],
}

export default sidebars
