# 协议概览

本文档概述 OHAI 协议的核心设计理念与架构分层，为后续各规范文档提供全局视角。

## 1. Capability-Based 组合模型

OHAI 采用 **基于能力（Capability-Based）** 的设备模型。每台设备由若干能力组合而成，而非按设备类型硬编码。

以"智能灯泡"为例，它并非一个不可分割的整体，而是由以下能力组合：

| 能力 | 含义 |
|---|---|
| `ohai.switch` | 开关控制 |
| `ohai.brightness` | 亮度控制 |
| `ohai.color_temperature` | 色温控制 |

这一设计具备以下特性：

- **复用** — 标准能力（`ohai.*`）由 OHAI 中央注册表定义一次，设备 Schema 按键名引用即可，无需重复编写。智能灯泡和智能插座均引用 `ohai.switch`，控制逻辑与 UI 自动复用。
- **组合** — 设备的能力集可灵活组合。基础灯泡仅引用 `ohai.switch`，高端灯泡可叠加 `ohai.brightness` + `ohai.color_temperature` + `ohai.color`。
- **可扩展** — 厂商可在 `{vendor}.*` 命名空间下定义自有能力，无需修改协议本身。
- **AI 友好** — 每个标准能力具备独立语义，AI 引擎可按能力粒度理解和操作设备；对于厂商自定义能力，AI 引擎通过[安全能力探测协议](./secure-capability-prob.md)推导其能力，无需依赖厂商提供的自由文本描述。

## 2. 与其他协议的设计对比

| | OHAI Capability | Matter Cluster | ZCL Cluster | SmartThings Capability | HA Entity |
|---|---|---|---|---|---|
| **粒度** | 单一职责能力 | 功能集群 | 功能集群 | 单一职责能力 | 按领域划分 |
| **组合方式** | 自由组合 | Endpoint 包含多 Cluster | Endpoint 包含多 Cluster | Profile 组合多 Capability | 每个实体一个领域 |
| **标准 + 自定义** | `ohai.*` + `{vendor}.*` | 标准 Cluster + 厂商 Cluster | 标准 + 厂商 Profile | 标准 + 自定义 | 内置 + 自定义 Platform |
| **AI 能力发现** | [安全能力探测协议](./secure-capability-prob.md) | 无 | 无 | 无 | 无 |

OHAI 的核心差异化在于：以及 **[安全能力探测协议](./secure-capability-prob.md)使 AI 引擎能安全地发现和理解设备能力**。

## 3. 三层架构

OHAI Server 与设备之间的消息格式分为三层：

| 层级 | 定义方 | 内容 |
|---|---|---|
| **协议框架层** | OHAI 协议（不可修改） | JSON-RPC 2.0 信封、MQTT 主题、QoS 策略、错误码 |
| **标准能力层** | OHAI 标准库（可选引用） | `ohai.*` 命名空间下的预定义能力（switch、brightness 等），包含推荐的默认安全策略 |
| **厂商能力层** | 设备开发者（自由定义） | `{vendor}.*` 命名空间下的自定义能力 |

## 4. 文档导航

| 文档 | 内容 |
|---|---|
| [设备能力模型](./device-model.md) | 能力的核心概念（State、Command、Event）、`affects`/`reports` 关联机制、语义标签、自动化安全策略 |
| [设备 Schema 规范](./schema.md) | Schema 文件格式、引用与覆盖机制、校验规则、Meta-Schema、完整示例 |
| [标准能力库](./standard-capabilities.md) | `ohai.*` 命名空间下全部标准能力的定义 |
| [AI 集成](./ai-integration.md) | Schema 到 LLM Tool Calling 的映射、Adaptive Cards 控制面板 |
| [错误码规范](./error-codes.md) | 封闭枚举错误码体系、回复格式、重试策略 |
