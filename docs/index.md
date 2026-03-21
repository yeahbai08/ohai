---
layout: home

hero:
  name: "OHAI(Open Home AI) Protocol"
  text: "AI-Driven Open Protocol for Smart Home"
  tagline: Break ecosystem barriers. Unify your smart home with AI.
  image:
    src: /logo.svg
    alt: OHAI Protocol
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/ohai-protocol/ohai

features:
  - icon: 🤖
    title: AI-Powered Control
    details: Leverage large language models to understand natural language commands and automate complex device interactions across your entire smart home.
  - icon: 🔓
    title: Break Ecosystem Barriers
    details: A vendor-neutral open protocol that enables seamless interoperability between devices from different manufacturers and IoT platforms.
  - icon: ⚡
    title: Highly Customizable
    details: Define your own automation rules, scenes, and workflows that match your lifestyle. No more one-size-fits-all smart home experiences.
  - icon: 🔗
    title: Cross-Device Automation
    details: Create intelligent linkages between devices from different brands. Your lights, thermostat, and speakers work together as one unified system.
  - icon: 🛡️
    title: Privacy First
    details: Self-hosted and local-first architecture. Your home data stays in your home. Full control over what gets shared and what stays private.
  - icon: 🧩
    title: Extensible SDK
    details: Comprehensive SDKs for JavaScript, Python, and more. Build custom integrations, device drivers, and AI agents with ease.
---

<style>
.VPHome {
  max-width: 1152px;
  margin: 0 auto;
}
</style>

<div style="padding: 48px 24px; text-align: center; max-width: 720px; margin: 0 auto;">

## How It Works

OHAI(Open Home AI) defines a lightweight message protocol between **AI agents** and **IoT devices**. An AI agent interprets user intent—whether through voice, text, or automated triggers—and translates it into standardized device commands.

```
┌──────────┐  Text/Voice/Images    ┌──────────────┐
│   User   │ ──────────────────▶   │   AI Agent   │
│  Intent  │                       │  (LLM-based) │
└──────────┘                       └──────┬───────┘
                                          │ OHAI Protocol
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                    ┌──────────┐   ┌──────────┐   ┌──────────┐
                    │ Device A │   │ Device B │   │ Device C │
                    │ (Brand X)│   │ (Brand Y)│   │ (Brand Z)│
                    └──────────┘   └──────────┘   └──────────┘
```

<div style="margin-top: 32px;">
  <a href="/guide/getting-started" style="display: inline-block; padding: 10px 24px; background: var(--vp-c-brand-1); color: white; border-radius: 8px; text-decoration: none; font-weight: 500;">Read the Guide →</a>
</div>

</div>
