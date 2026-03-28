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
    title: AI 是大脑，不是助手
    details: 自然语言直接控制设备，智能编排自动化场景。不用写规则，让家自己思考。
  - icon: 🔓
    title: 打破生态壁垒
    details: 厂商中立的开放协议。不同品牌的灯光、温控、音箱，在同一系统内无缝协作。
  - icon: 🏠
    title: 数据不出家门
    details: Server 和大模型完全运行在局域网内，在架构层面保护隐私。
  - icon: 🔐
    title: 硬件级入网认证
    details: 伪造设备无法入网，篡改固件无法运行。零认证费用，任何厂商可安全加入。
  - icon: 🛡️
    title: AI 攻不破，设备逃不出
    details: 零信任架构——第三方设备完全隔离运行，提示词注入无法触及 AI 核心。
  - icon: 🧩
    title: 一套 SDK，全芯片覆盖
    details: ESP32、RISC-V、ARM Cortex-M——无论什么芯片，即刻接入 OHAI 生态。
  - icon: 🧱
    title: 能力积木，自由组合
    details: 设备不是固定类型，而是标准能力的自由拼装。自定义能力统一格式，即插即用。
  - icon: 🎨
    title: 一次声明，全平台渲染
    details: 厂商声明一次面板 UI，所有平台原生呈现。
---

<style>
.VPHome {
  max-width: 1152px;
  margin: 0 auto;
}
</style>

<div style="padding: 48px 24px; max-width: 820px; margin: 0 auto;">

## 工作原理

每台设备通过安全配网接入 **OHAI Server**。Server 为每台设备启动一个**完全隔离的 Sub Agent**——独立的 LLM 上下文，互不可见。**Main Agent** 负责编排所有 Sub Agent 并处理用户交互。用户通过 **Console App** 以自然语言访问和管理整个智能家居系统。

<img src="/architecture.svg" alt="OHAI Architecture" style="width: 100%; margin: 24px 0;" />

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
