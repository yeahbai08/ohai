# OHAI Protocol

**Open Home AI** — An AI-driven open protocol for smart home devices.

OHAI uses the power of AI to break ecosystem barriers between IoT device manufacturers and platforms. It lets consumers control devices according to their own habits, build their own smart home environment, and achieve intelligent cross-brand device automation.

## Features

- **AI-Powered** — Natural language understanding and intelligent automation via LLMs
- **Vendor Neutral** — Works with devices from any manufacturer
- **Customizable** — Define your own scenes, rules, and workflows
- **Privacy First** — Self-hosted, local-first architecture
- **Extensible** — SDKs for JavaScript, Python, and more

## Documentation

The documentation site is built with [VitePress](https://vitepress.dev/).

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9

### Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

The dev server will start at `http://localhost:5173`.

### Build

```bash
# Build for production
pnpm build

# Preview the production build locally
pnpm preview
```

The built site will be generated in `docs/.vitepress/dist`.

### Deployment

The built static files in `docs/.vitepress/dist` can be deployed to any static hosting service:

- **GitHub Pages** — Push the `dist` folder or use a CI workflow
- **Vercel / Netlify** — Connect the repo and set build command to `pnpm build`, output directory to `docs/.vitepress/dist`
- **Self-hosted** — Serve the `dist` folder with Nginx, Caddy, or any static file server

## License

[MIT](./LICENSE)
