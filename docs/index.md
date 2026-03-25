---
layout: home

hero:
  name: "OHAI(Open Home AI) Protocol"
  text: "AI 驱动的智能家居开放协议"
  tagline: 打破生态壁垒，用 AI 统一你的智能家居。
  image:
    src: /logo.svg
    alt: OHAI Protocol
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 在 GitHub 上查看
      link: https://github.com/ohai-protocol/ohai

features:
  - icon: 🤖
    title: AI 驱动控制
    details: 利用大语言模型理解自然语言指令，自动化复杂的跨设备交互，让整个智能家居系统更加智能。
  - icon: 🔓
    title: 打破生态壁垒
    details: 厂商中立的开放协议，实现不同制造商和物联网平台之间设备的无缝互操作。
  - icon: ⚡
    title: 高度可定制
    details: 自定义自动化规则、场景和工作流，匹配你的生活方式。告别千篇一律的智能家居体验。
  - icon: 🔗
    title: 跨设备自动化
    details: 在不同品牌的设备之间创建智能联动。灯光、温控和音箱作为一个统一的系统协同工作。
  - icon: 🛡️
    title: 零信任安全架构
    details: 多层安全设计——不受信任的第三方设备运行在隔离的 Sub Agent 中，上下文完全分离。安全能力探测协议确保提示词注入无法触及 AI 核心，严格的 Schema 校验阻止所有自由文本攻击向量。
  - icon: 🧩
    title: 可扩展 SDK
    details: 提供 JavaScript、Python 等多语言 SDK。轻松构建自定义集成、设备驱动和 AI Agent。
---

<style>
.VPHome {
  max-width: 1152px;
  margin: 0 auto;
}
</style>

<div style="padding: 48px 24px; text-align: center; max-width: 720px; margin: 0 auto;">

## 工作原理

OHAI（Open Home AI）定义了 **AI Agent** 与 **IoT 设备** 之间的轻量级消息协议。AI Agent 理解用户意图——无论是语音、文字还是自动化触发——并将其转化为标准化的设备命令。

```
┌──────────┐  文字/语音/图片       ┌──────────────┐
│   用户   │ ──────────────────▶   │   AI Agent   │
│   意图   │                       │ (基于大模型)  │
└──────────┘                       └──────┬───────┘
                                          │ OHAI 协议
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                    ┌──────────┐   ┌──────────┐   ┌──────────┐
                    │  设备 A  │   │  设备 B  │   │  设备 C  │
                    │ (品牌 X) │   │ (品牌 Y) │   │ (品牌 Z) │
                    └──────────┘   └──────────┘   └──────────┘
```

</div>

<div style="padding: 0 24px 48px; max-width: 720px; margin: 0 auto;">

## 安全性：无法被欺骗的 AI

与传统智能家居平台不同，OHAI 为 AI 时代而生——在这个时代，**每一个第三方设备都可能是潜在的威胁**。我们的多层零信任安全架构确保即使设备被完全攻破，也无法操纵你的 AI 助手。

**Agent 隔离** — 每个不受信任的设备运行在独立的 Sub Agent 中，拥有自己的 LLM 上下文。处理用户对话和自动化规则的 Main Agent 与之完全隔离。没有共享上下文，就没有提示词注入的可能。

**安全能力探测** — Main Agent 通过结构化的探测协议发现设备能力，设备只能从预设选项中选择。设备无法注入自由文本、伪造恶意回复，也无法影响 AI 提出的问题。AI 提问，设备从封闭集合中选答案。

**Schema 强制边界** — 所有设备通信都经过严格的 Schema 校验，禁止自由文本字符串。每一个字符串字段都必须是封闭枚举。每一个响应都在进入系统前经过程序化验证。没有例外。

<div style="margin-top: 24px;">
  <a href="/protocol/secure-capability-prob" style="display: inline-block; padding: 10px 24px; background: var(--vp-c-brand-1); color: white; border-radius: 8px; text-decoration: none; font-weight: 500;">了解我们的安全模型 →</a>
</div>

</div>

<div style="padding: 0 24px 48px; text-align: center; max-width: 720px; margin: 0 auto;">

<div style="margin-top: 32px;">
  <a href="/guide/getting-started" style="display: inline-block; padding: 10px 24px; background: var(--vp-c-brand-1); color: white; border-radius: 8px; text-decoration: none; font-weight: 500;">阅读指南 →</a>
</div>

</div>
