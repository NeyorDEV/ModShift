import { defineConfig } from 'vitepress';

// Site de documentation (VitePress). Déployé sur GitHub Pages par .github/workflows/docs.yml,
// une fois Pages activé à la main dans les réglages du dépôt.
export default defineConfig({
  title: 'ModShift',
  description: 'Migrate a Minecraft modpack to another Minecraft version and/or mod loader.',
  lang: 'en-US',
  // Pages de projet : https://neyordev.github.io/ModShift/
  base: '/ModShift/',
  cleanUrls: true,
  lastUpdated: false,
  head: [['meta', { name: 'theme-color', content: '#1bd96a' }]],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/cli' },
      { text: 'FAQ', link: '/faq' },
      { text: 'Changelog', link: 'https://github.com/NeyorDEV/ModShift/blob/main/CHANGELOG.md' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Commands and options', link: '/guide/commands' },
          { text: 'Interactive mode', link: '/guide/interactive' },
          { text: 'Web interface', link: '/guide/web-ui' },
          { text: 'Configuration file', link: '/guide/configuration' },
          { text: 'Changing loader', link: '/guide/changing-loader' },
          { text: 'Client and server', link: '/guide/client-server' },
          { text: 'Sources and CurseForge', link: '/guide/sources' },
          { text: 'Cache and offline mode', link: '/guide/cache' },
          { text: 'GitHub Action', link: '/guide/github-action' },
          { text: 'Performance', link: '/guide/performance' },
          { text: 'How it works', link: '/guide/how-it-works' },
          { text: 'Programmatic API', link: '/guide/api' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Command line', link: '/cli' },
          { text: 'Loaders', link: '/loaders' },
          { text: 'Plugin guide (sources)', link: '/plugins' },
          { text: '.mrpack format', link: '/mrpack-format' },
          { text: 'CurseForge API', link: '/curseforge-api' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'FAQ', link: '/faq' },
          { text: 'Known limitations', link: '/limitations' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/NeyorDEV/ModShift' }],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/NeyorDEV/ModShift/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message:
        'Released under the MIT License. Not affiliated with Modrinth, CurseForge or Mojang.',
    },
  },
});
