import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'OHAI Protocol',
  description: 'Open Home AI Protocol - AI-powered open protocol for smart home devices',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Protocol', link: '/protocol/overview' },
      { text: 'SDK', link: '/sdk/overview' },
      {
        text: 'Resources',
        items: [
          { text: 'GitHub', link: 'https://github.com/ohai-protocol/ohai' },
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is OHAI?', link: '/guide/what-is-ohai' },
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
        },
      ],
      '/protocol/': [
        {
          text: 'Protocol',
          items: [
            { text: 'Overview', link: '/protocol/overview' },
            { text: 'Message Format', link: '/protocol/message-format' },
            { text: 'Device Model', link: '/protocol/device-model' },
            { text: 'AI Integration', link: '/protocol/ai-integration' },
          ],
        },
        {
          text: 'Design Specifications',
          items: [
            { text: 'Architecture & Security', link: '/protocol/secure-net-design' },
            { text: 'Message Protocol', link: '/protocol/secure-message-design' },
            { text: 'Blockchain Registry', link: '/protocol/blockchain-registry' },
          ],
        },
      ],
      '/sdk/': [
        {
          text: 'SDK',
          items: [
            { text: 'Overview', link: '/sdk/overview' },
            { text: 'JavaScript / TypeScript', link: '/sdk/javascript' },
            { text: 'Python', link: '/sdk/python' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ohai-protocol/ohai' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present OHAI Contributors',
    },

    search: {
      provider: 'local',
    },
  },
})
