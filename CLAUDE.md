# OHAI Project Guidelines

## Project Overview

OHAI (Open Home AI) is an AI-driven open protocol for smart home devices. This repository contains the documentation website built with VitePress.

## Tech Stack

- **Framework**: VitePress 1.x (Vue + Vite based static site generator)
- **Package Manager**: pnpm
- **Language**: TypeScript / Markdown

## Project Structure

```
ohai/
├── docs/                      # VitePress documentation source
│   ├── .vitepress/
│   │   ├── config.mts         # VitePress configuration (nav, sidebar, theme)
│   │   └── theme/
│   │       ├── index.ts       # Theme entry (extends default theme)
│   │       └── custom.css     # Custom CSS (brand colors, hero styles)
│   ├── public/
│   │   └── logo.svg           # Site logo
│   ├── index.md               # Homepage (hero + features layout)
│   ├── changelog.md           # Changelog page
│   ├── guide/                 # Guide section
│   │   ├── getting-started.md
│   │   └── what-is-ohai.md
│   ├── protocol/              # Protocol specification section
│   │   ├── overview.md
│   │   ├── message-format.md
│   │   ├── device-model.md
│   │   ├── ai-integration.md
│   │   ├── capability-model.md
│   │   ├── standard-capabilities.md
│   │   └── error-codes.md
│   └── sdk/                   # SDK documentation section
│       ├── overview.md
│       ├── javascript.md
│       └── python.md
├── package.json
├── README.md
└── CLAUDE.md                  # This file
```

## Commands

- `pnpm dev` — Start development server (http://localhost:5173)
- `pnpm build` — Build for production
- `pnpm preview` — Preview production build locally

## Conventions

- All documentation content is in Markdown under `docs/`
- Navigation and sidebar are configured in `docs/.vitepress/config.mts`
- Brand color is `#646cff` (indigo/violet)
- Use VitePress built-in components (`::: tip`, `::: warning`, etc.) for callouts
- Pages under construction use the `::: tip Work in Progress` callout pattern
- Keep the homepage content in `docs/index.md` using VitePress frontmatter `layout: home`
