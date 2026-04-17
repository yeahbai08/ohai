# OHAI 消息协议

本文档定义 OHAI 系统的应用层消息协议的设计原则、安全机制和注册流程。

- **设备能力模型与 Schema 格式**：详见 [设备能力模型](./device-model.md) 和 [设备 Schema 规范](./schema.md)
- **协议框架（消息格式、MQTT 主题、消息流程、AI 自动化）**：详见 [OHAI 协议框架](./protocol-framework.md)
- **传输层安全（mTLS、TLS + Token）**：详见 [架构安全设计](./secure-net-design.md)

## 设计原则

### 1.1 系统将安全放在首位

协议设计时充分考虑安全风险，尤其是提示词注入攻击（Prompt Injection）。通过以下措施降低风险：
- **严格的消息格式**：对设备的自由输入零信任。系统会在设计层面杜绝将来自设备的任何未经验证的字符串数据传入大模型，防止提示词注入。
- **设备能力注册**：设备仅上报身份三元组（vendor、product、firmware_version），Schema 由 Server 从 OVR 本地缓存查找，设备不参与 Schema 传输。OVR 中无记录时进入开发者模式，由用户手动审核。详见 [Schema 注册与认证](#schema-注册与认证) 和 [OVR 开放规范](./secure-net-design.md#open-vendor-registry-ovr-开放规范)。
- **安全敏感设备确认**：用户可以自定义设备（产品）的敏感等级。对于门锁、摄像头等安全敏感设备，命令下发前需用户显式确认，防止恶意命令自动执行。
- **最小权限原则**：设备只能访问与自身相关的 MQTT 主题，无法读取或控制其他设备。

### 1.2 为何用 CBOR + JSON Schema?

OHAI 采用 **CBOR**（[RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html)）作为消息序列化格式，配合 **JSON Schema**（[Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)）进行数据结构校验。

#### 为何选择 CBOR 作为序列化格式？

- **更小的消息体积**：CBOR 是二进制编码，比 JSON 更紧凑，适合带宽受限的 IoT 设备。
- **无需预编译 Schema**：不同于 Protobuf 需要 `.proto` 文件预编译生成代码，CBOR 是自描述的二进制格式，序列化/反序列化不依赖代码生成，降低了设备开发者的工具链负担。
- **LLM 友好**：在设备消息（CBOR）和 AI 消息（JSON）之间进行格式转换非常容易，而 JSON 转为 Protobuf 则需要预先知道消息的确切类型。
- **与 JSON 数据模型一致**：CBOR 的数据模型是 JSON 的超集，可以与 JSON 无损互转（[RFC 8949 §6.1](https://www.rfc-editor.org/rfc/rfc8949.html#section-6.1)）。这意味着我们可以直接在设备消息（CBOR）和 AI 能理解的消息（JSON）之间进行无缝转换。
- **原生支持二进制数据**：CBOR 原生支持字节串（byte string）类型，无需 Base64 编码即可高效携带固件片段、音频帧等二进制负载。
- **活跃的多语言生态**：主流语言均有高质量的 CBOR 库（C/C++ 的 [tinycbor](https://github.com/niclas-pfeifer/tinycbor)、Python 的 [cbor2](https://pypi.org/project/cbor2/)、JavaScript 的 [cbor-x](https://github.com/niclas-pfeifer/cbor-x) 等），资源受限的 MCU 也有轻量实现。

#### 为何用 JSON Schema 做数据结构校验？

- **与 CBOR 天然兼容**：由于 CBOR 与 JSON 数据模型一致，JSON Schema 可以直接用于校验 CBOR 解码后的数据结构，无需额外的 IDL。
- **人类可读**：JSON Schema 本身是 JSON 格式，开发者可以直接阅读和编辑，不需要学习额外的 IDL 语法（如 `.proto` 文件）。
- **工具链丰富**：JSON Schema 拥有成熟的校验库（[ajv](https://ajv.js.org/)、[jsonschema](https://pypi.org/project/jsonschema/) 等）、可视化编辑器和文档生成工具，生态远比 Protobuf Schema 更开放。
- **LLM 友好**：JSON Schema 是大模型最熟悉的结构化描述格式（OpenAI、Anthropic 等 API 的 Tool Calling / Structured Output 均原生使用 JSON Schema），Server 将设备 Schema 映射为 LLM 工具定义时无需格式转换。
- **向后兼容**：通过 `additionalProperties`、`oneOf` 等关键字，JSON Schema 天然支持字段的增删和多版本共存，便于协议迭代。

### 1.3 命令分类与投递语义

OHAI 定义三种命令类型。设备开发者在设计 Schema 时，必须根据每条命令的业务语义从中选择一种：

#### ① `state_cmd` — 状态命令（QoS 1，幂等）

设置设备的**绝对目标状态**，无论执行多少次、以何顺序到达，结果始终一致。

OHAI **建议尽量使用 `state_cmd`**。它在系统性能和可靠性之间实现了最佳平衡——QoS 1 仅需两步握手（PUBLISH → PUBACK）即可保证送达，而幂等性天然容忍 Broker 重传，无需 QoS 2 的四步握手开销。

| 正确（幂等） | 错误（非幂等） |
|---|---|
| 亮度设置到 80% | 亮度增大 20% |
| 音量设置到 50 | 音量调大一点 |
| 空调设置到 22°C | 温度降低 2 度 |
| 门锁设置为已锁定 | 切换门锁状态 |

**为何鼓励幂等设计？**

1. **消除竞态条件**：多条命令同时在途时，相对调整的最终结果取决于执行顺序；绝对目标值无论如何到达，结果不变。
2. **命令重放安全**：QoS 1 可能重传，幂等命令重复执行不产生副作用。
3. **简化 LLM 输出**：大模型生成绝对目标值远比计算增量可靠——无需知道设备当前状态即可生成命令。

**典型场景**：灯光亮度/色温、空调温度、音量、开关状态、门锁状态、窗帘位置——智能家居中绝大多数操作天然适合 `state_cmd`。

::: tip 能力模型中的 affects 机制
在 [设备能力模型](./device-model.md#_2-命令与状态的结构化关联) 中，`state_cmd` 必须通过 `affects` 字段显式声明它影响的状态，这在 Schema 层面将命令与状态关联起来，引导开发者做出正确的设计决策。
:::

#### ② `instant_cmd` — 即时命令（QoS 0，非幂等）

**"现在执行，或者放弃。"**

时效敏感的一次性触发。使用 QoS 0（至多一次投递），意味着：
- MQTT Broker **不持久化**此消息，不在设备离线时排队
- 设备从网络故障恢复后**不会**收到过期的即时命令
- 消息可能因网络抖动丢失，这是**可接受的**

**设计意图**：某些命令在发出的那一刻才有意义。5 分钟前的"播放下一首"在用户已经手动切歌后重发，是错误的；10 分钟前的 TTS 语音播报在设备恢复后突然朗读，是荒谬的。QoS 0 从协议层面杜绝了这类"幽灵命令"。

**典型场景**：媒体控制（播放/暂停/上一首/下一首）、TTS 语音播报、拍照、开始清扫等实时交互类操作。

#### ③ `once_cmd` — 单次命令（QoS 2，非幂等）

**"无论如何，必须执行恰好一次。"**

使用 QoS 2（恰好一次投递），意味着：
- MQTT Broker **持久化**此消息，设备离线时排队等待
- 设备恢复后**保证送达**且**不会重复执行**（QoS 2 四步握手协议保证）
- 代价是更高的握手开销（PUBLISH → PUBREC → PUBREL → PUBCOMP）

**设计意图**：某些非幂等命令无论何时执行都有意义，丢失或重复执行都会导致严重后果。比如智能喂食器的"投放一份食物"命令，丢失意味着宠物挨饿，重复执行则会多投一份导致过量喂食。`once_cmd` 确保此类关键命令恰好执行一次。

**典型场景**：智能喂食器投放食物、智能药盒记录"已服药"、固件升级指令（含分片序号）等——命令延迟到达仍然有效，但重复执行会产生副作用的操作。

---

**三种命令的对比总结**：

|              | `state_cmd`   | `instant_cmd` | `once_cmd`  |
|--------------|---------------|---------------|----------------|
| **QoS**      | 1（至少一次） | 0（至多一次） | 2（恰好一次）  |
| **幂等性**   | 幂等          | 非幂等        | 非幂等         |
| **离线排队** | Broker 缓存   | 不缓存        | Broker 缓存    |
| **重复送达** | 安全（幂等）  | 不会发生      | 协议保证不重复 |
| **适用场景** | 状态设置      | 实时交互      | 关键操作       |
| **推荐程度** | 首选          | 按需          | 按需           |

命令类型在协议框架中的投递行为和超时处理详见 [协议框架 - 命令分类与投递语义](./protocol-framework.md#_3-命令分类与投递语义)。

---

## Schema 注册与认证

Schema（`schema.json`）定义了设备的能力、命令和事件，是设备与 AI 引擎交互的基础。Schema 的能力模型详见 [设备能力模型](./device-model.md)，文件格式详见 [设备 Schema 规范](./schema.md)。

Schema 中包含厂商名（`vendor`）、产品名（`product`）以及固件版本号（`firmware_version`），三者唯一标识一个 Schema（`schema_id = keccak256(vendor + "\0" + product + "\0" + firmware_version)`）。

### 设备身份上报

设备的 `vendor`、`product`、`firmware_version` 信息固化在设备固件中。这些信息在两个阶段上报：

**Phase 1（BLE 配网阶段）**：Console 在 SPAKE2+ 加密通道建立后、凭据注入之前，从设备读取 `vendor`、`product`、`firmware_version`（与 DAC 读取同步进行）。Console 将此信息连同 `device_id` 转发给 Server，Server 据此执行 Schema 查找（见下文），**在配网完成之前即完成 Schema 绑定**。

**每次 MQTT 上线（Phase 2 及后续重连）**：设备在 mTLS 连接建立后，发送首条消息 `device_info`（JSON-RPC Notification，无需回复），上报当前固件身份：

```jsonc
// Topic: ohai/device/{device_id}/state
{
  "jsonrpc": "2.0",
  "method": "device_info",
  "params": {
    "vendor": "example-vendor",
    "product": "smart-light-bulb",
    "firmware_version": "1.2.0"
  }
}
```

Server 收到后与设备目录中记录的 `firmware_version` 比对：
- **一致** → 跳过，继续正常流程（请求 `state_report` 等）
- **不一致**（设备已 OTA 升级） → 使用新的三元组重新执行 Schema 查找流程，成功后更新设备目录中的 Schema 绑定。查找失败时（OVR 中尚无新版本 Schema），Server 保留旧 Schema 继续运行，同时通知 Console App 提醒用户

`device_info` 必须是设备上线后的**第一条消息**，Server 在收到 `device_info` 之前不向该设备下发任何命令。这确保 Server 始终基于设备当前固件版本的 Schema 进行交互。

### Schema 查找：生产模式

生产环境中，Schema 的信任源头是**厂商域名 → OVR → Server 本地缓存**这条链路（详见 [OVR 开放规范](./secure-net-design.md#open-vendor-registry-ovr-开放规范)）。**设备不参与 Schema 的传输**——Server 凭设备身份三元组从 OVR 本地缓存中查找 Schema，而非从设备获取。这从架构上杜绝了恶意设备注册虚假 Schema 进行提示词注入攻击的可能。

查找流程：

1. Server 根据 `schema_id` 在本地 OVR 缓存中查找 Schema
2. **命中** → 自动接受，将 Schema 与 `device_id` 绑定，写入设备目录
3. **未命中** → 向 OVR 发起实时查询（设备可能使用了尚未同步到本地的新 Schema）
4. **OVR 也无记录** → 进入开发者模式（见下文）

OVR 将所有 Schema 公开托管、公众可审计，安全研究人员和自动化工具可检测提示注入模式，OVR 可实时向 Server 推送风险标记（详见 [Schema 公开可见性与 AI 安全](./secure-net-design.md#schema-公开可见性与-ai-安全)）。

### Schema 查找：开发者模式

当 OVR 中无对应 Schema 记录时（常见于开发中的设备、未注册 OVR 的小厂商、或用户自制设备），进入开发者模式。此模式允许高级用户在不依赖 OVR 的情况下使用设备，但需要用户主动承担 Schema 的信任责任。

需要明确的是：**开发者模式只改变 Schema 的信任来源，不改变 Main Agent 的安全边界。** 无论 Schema 来自 OVR 还是由用户手动上传，Main Agent 都不会直接消费原始 Schema 中的自由文本说明；Server 仍然以 Schema 的结构约束作为能力探测的输入，最终提供给 Main Agent 的仍是探测后生成的近似能力模型。

开发者模式流程：

1. Server 在 OVR 中未找到 Schema，通知 Console App："此设备的 Schema 未在 OVR 注册"
2. 用户在 Console App 中上传 `schema.json` 文件（如从厂商文档、GitHub 仓库等途径获取）
3. Server 对提交的 Schema 执行 **Meta-Schema 结构校验 + 语义校验**（详见 [校验规则](./schema.md#_5-校验规则与-meta-schema)），校验不通过则拒绝
4. Console App 向用户展示 Schema 内容（能力列表、命令、事件），并明确提示：**"此 Schema 未经 OVR 验证，请确认其来源可信"**
5. 用户确认接受 → Schema 以 **"未验证 (unverified)"** 信任等级写入设备目录，与 `device_id` 绑定

::: warning 开发者模式的安全边界
开发者模式下 Schema 未经 OVR 公众审计，主要风险是**语义真实性风险**而非 Main Agent 上下文污染：上传的 Schema 可能夸大、遗漏或错误描述设备能力，导致后续能力探测得到偏差的近似模型，进而影响控制行为或自动化判断。Console App 在设备列表中应持续标注该设备为"未验证"状态，直到 Schema 在 OVR 上注册后自动升级信任等级。
:::

### Schema 绑定与使用

无论通过哪种模式获取，Schema 最终与 `device_id` 绑定并存储在 Server 的设备目录中。AI 引擎在生成命令时根据设备别名或 `device_id` 查找对应的 Schema，确保生成的命令符合设备能力定义。

Schema 的信任等级取决于验证结果和厂商背景。详细的信任分层模型、社区审计机制和安全分析见 [OVR 开放规范](./secure-net-design.md#open-vendor-registry-ovr-开放规范)。

---

## 设备注册与别名

在整个系统中，Console App 是受信任的，它完全代表用户。在用户使用 Console App 辅助设备入网后，Console 会向设备分配一个全局唯一的 `device_id`，并将其写入设备的 NOC 证书 CN 字段。设备通过 MQTT 连接时使用该证书进行 mTLS 认证，Server 根据 CN 字段识别设备身份。

同时设备的 `device_id` 也会被注册到 Server 的设备目录中，用户可以在 Console App 中为设备设置一个友好的别名（例如"客厅主吊灯"），此操作会将该别名与 `device_id` 进行绑定。AI 引擎在生成命令时会优先使用别名，如果别名存在歧义则回退到 `device_id`。

---

## Device ↔ Server 消息协议

Device 与 Server 之间的完整消息协议（MQTT Topic 设计、ACL 权限控制、消息格式、消息流程、状态同步、系统广播、错误处理）详见 [OHAI 协议框架](./protocol-framework.md)。

---

## Client ↔ Server 消息协议

客户端与 Server 之间的交互通过 HTTP API 实现。

### 语音流式传输

为避免超声攻击或伪装成用户进行语音输入，暂时不支持 Client 直接向 Server 传输音频数据，Client 端需要自行实现 ASR 并让用户确认文本后以文本形式发送命令。

---

## 安全敏感设备确认流程

标记为 `security_critical: true` 的设备（门锁、摄像头、报警器、车库门），其命令需用户显式确认。

**流程**：
1. AI 引擎生成涉及安全敏感设备的命令
2. Server 暂存命令，向 Client 发送 `confirm_req`
3. Client 展示确认界面（例如"AI 想要解锁前门，是否允许？"）
4. 用户确认或拒绝，Client 回复 `confirm_resp`
5. 确认通过后 Server 下发命令；超时或拒绝则丢弃

**命令类型约束**：`security_critical: true` 的设备，其 Schema 中所有命令的 `cmd_type` 不得为 `instant_cmd`。Server 在设备注册时校验此规则，违反则拒绝注册。原因：`instant_cmd` 使用 QoS 0 不保证送达，用户完成确认流程后命令可能因网络抖动丢失，导致用户误以为操作已执行（如"锁门"命令丢失但用户已离家）。安全关键操作必须有送达保证（`state_cmd` QoS 1 或 `once_cmd` QoS 2）。

---

## AI 自动化规则与数据分析

AI 自动化是 OHAI 的核心功能之一。自动化规则使用 LLM 生成的 Elixir 代码模块实现，每条规则是一个独立的 Elixir 模块，遵循 `OHAI.Rule` 模板，可调用系统 API 控制设备、读取状态和查询历史数据。详见 [AI 集成 - AI 自动化集成](./ai-integration.md#_2-ai-自动化集成)。

设备厂家提供的控制面板 UI（基于 Adaptive Cards）详见 [AI 集成 - 设备控制面板](./ai-integration.md#_2-设备控制面板-adaptive-cards)。

---

## 消息完整性与安全

### 传输层安全

| 通信方 | 安全机制 | 详情 |
|---|---|---|
| Device ↔ Server | mTLS 1.3（双向证书认证） | 设备持 NOC，Server 持 Root CA |
| Client ↔ Server | TLS 1.3 + Access Token (JWT) | Token 由 TrustAnchor 签发 |

详见 [架构安全设计](./secure-net-design.md) 第二至四节。
