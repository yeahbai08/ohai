import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid({
  title: 'OHAI Protocol',
  description: 'Open Home AI Protocol - AI-powered open protocol for smart home devices',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  vite: {
    optimizeDeps: {
      include: ['mermaid', 'dayjs'],
    },
    ssr: {
      noExternal: ['mermaid'],
    },
  },

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
          text: '协议规范',
          items: [
            { text: '协议概览', link: '/protocol/overview' },
            { text: '架构与安全设计', link: '/protocol/secure-net-design' },
            { text: '消息协议', link: '/protocol/secure-message-design' },
            { text: '协议框架', link: '/protocol/protocol-framework' },
            { text: '设备能力模型', link: '/protocol/device-model' },
            { text: '设备 Schema 规范', link: '/protocol/schema' },
            { text: '标准能力库', link: '/protocol/standard-capabilities' },
            { text: 'AI 集成', link: '/protocol/ai-integration' },
            { text: '设备控制面板', link: '/protocol/device-panel-ui' },
            { text: '错误码规范', link: '/protocol/error-codes' },
          ],
        },
        {
          text: '附录',
          items: [
            { text: 'AI 能力探测协议', link: '/protocol/secure-capability-prob' },
            { text: '错误码完备性论证', link: '/protocol/error-code-completeness-proof' },
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
