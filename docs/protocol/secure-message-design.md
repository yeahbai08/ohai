# OHAI 消息协议

本文档定义 OHAI 系统中 Device、Client 与 Server 之间的应用层消息格式（CBOR 序列化 + JSON Schema 校验）、MQTT Topic 层级、设备能力注册机制以及 AI 引擎集成方式。传输层安全（mTLS、TLS + Token）详见 [架构安全设计](./secure-net-design.md)。

## 设计原则

### 1.1 系统将安全放在首位

协议设计时充分考虑安全风险，尤其是提示词注入攻击（Prompt Injection）。通过以下措施降低风险：
- **严格的消息格式**：对设备的自由输入零信任。系统会在设计层面杜绝将来自设备的任何未经验证的字符串数据传入大模型，防止提示词注入。
- **设备能力注册**：设备注册阶段使用的 Schema 必须通过 OVR（开放厂商注册表）的哈希比对验证（生产环境），或者由用户手动检查和校验（开发者模式）。详见 [OVR 开放规范](./secure-net-design.md#八-open-vendor-registry-ovr-开放规范)。
- **安全敏感设备确认**：用户可以自定义设备（产品）的敏感等级。对于门锁、摄像头等安全敏感设备，命令下发前需用户显式确认，防止恶意命令自动执行。
- **最小权限原则**：设备只能访问与自身相关的 MQTT 主题，无法读取或控制其他设备。

### 1.2 为何用 CBOR + JSON Schema?

OHAI 采用 **CBOR**（[RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html)）作为消息序列化格式，配合 **JSON Schema**（[Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)）进行数据结构校验。

#### 为何选择 CBOR 作为序列化格式？

- **更小的消息体积**：CBOR 是二进制编码，比 JSON 更紧凑，适合带宽受限的 IoT 设备。
- **无需预编译 Schema**：不同于 Protobuf 需要 `.proto` 文件预编译生成代码，CBOR 是自描述的二进制格式，序列化/反序列化不依赖代码生成，降低了设备开发者的工具链负担。
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

#### ② `instant_cmd` — 即时命令（QoS 0，非幂等）

**"现在执行，或者放弃。"**

时效敏感的一次性触发。使用 QoS 0（至多一次投递），意味着：
- MQTT Broker **不持久化**此消息，不在设备离线时排队
- 设备从网络故障恢复后**不会**收到过期的即时命令
- 消息可能因网络抖动丢失，这是**可接受的**

**设计意图**：某些命令在发出的那一刻才有意义。5 分钟前的"播放下一首"在用户已经手动切歌后重发，是错误的；10 分钟前的 TTS 语音播报在设备恢复后突然朗读，是荒谬的。QoS 0 从协议层面杜绝了这类"幽灵命令"。

**典型场景**：媒体控制（播放/暂停/上一首/下一首）、TTS 语音播报、拍照、开始清扫等实时交互类操作。

#### ③ `durable_cmd` — 持久命令（QoS 2，非幂等）

**"无论如何，必须执行恰好一次。"**

使用 QoS 2（恰好一次投递），意味着：
- MQTT Broker **持久化**此消息，设备离线时排队等待
- 设备恢复后**保证送达**且**不会重复执行**（QoS 2 四步握手协议保证）
- 代价是更高的握手开销（PUBLISH → PUBREC → PUBREL → PUBCOMP）

**设计意图**：某些非幂等命令无论何时执行都有意义，丢失则会导致严重后果。比如报警器响了之后，"解除报警"命令因设备短暂离线而丢失，导致报警无法解除，这是不可接受的。`durable_cmd` 确保此类关键命令最终必达。

**典型场景**：解除报警、触发安防场景、扫地机器人返回充电座等——命令即使延迟到达也仍然有效且必须执行的操作。

---

**三种命令的对比总结**：

|              | `state_cmd`   | `instant_cmd` | `durable_cmd`  |
|--------------|---------------|---------------|----------------|
| **QoS**      | 1（至少一次） | 0（至多一次） | 2（恰好一次）  |
| **幂等性**   | 幂等          | 非幂等        | 非幂等         |
| **离线排队** | Broker 缓存   | 不缓存        | Broker 缓存    |
| **重复送达** | 安全（幂等）  | 不会发生      | 协议保证不重复 |
| **适用场景** | 状态设置      | 实时交互      | 关键操作       |
| **推荐程度** | 首选          | 按需          | 按需           |

具体操作分类见 [5.3 节](#_5-3-命令分类与-qos-策略)。

---

## Schema 注册与认证

Schema（JSON Schema 格式）定义了设备的能力、属性和命令，是设备与 AI 引擎交互的基础。为了防止恶意设备注册虚假 Schema 进行提示词注入攻击，OHAI 使用 OVR（开放厂商注册表）验证 Schema 的完整性和来源：厂商将 JSON Schema 文件及其 SHA-256 哈希通过域名端点发布并在 OVR 注册，Server 在设备注册时将设备提供的 Schema 原文哈希与 OVR 记录比对，匹配则自动接受，不匹配则拒绝。OVR 中无记录的 Schema 进入开发者模式，由用户在 Console App 中手动审核后决定是否接受。OVR 将所有 Schema 公开托管、公众可审计，以降低提示词注入风险（详见 [Schema 公开可见性与 AI 安全](./secure-net-design.md#schema-公开可见性与-ai-安全)）。

Schema 中包含厂商名、产品名以及固件版本号。这三者唯一标识了一个 Schema（`schema_id = keccak256(vendor_name + product_name + firmware_version)`）。设备在注册时提供这三者信息以及 `device_id`，Server 根据 `schema_id` 从本地缓存查找对应的 Schema 哈希进行比对，验证通过后将 Schema 与 `device_id` 绑定，并存储在设备目录中。AI 引擎在生成命令时会根据设备别名（如果有）或 `device_id` 查找对应的 JSON Schema，确保生成的命令符合设备能力定义。由于 JSON Schema 与 LLM Tool Calling 的参数定义格式一致，Server 可直接将设备 Schema 映射为 LLM 工具定义，无需额外的格式转换。

Schema 的信任等级取决于验证结果和厂商背景。详细的信任分层模型、社区审计机制和安全分析见 [OVR 开放规范](./secure-net-design.md#八-open-vendor-registry-ovr-开放规范)。

## Schema 格式要求

## 设备注册与别名

在整个系统中，Console App 是受信任的，它完全代表用户。在用户使用 Console App 辅助设备入网后，Console 会向设备分配一个全局唯一的 `device_id`，并将其写入设备的 NOC 证书 CN 字段。设备通过 MQTT 连接时使用该证书进行 mTLS 认证，Server 根据 CN 字段识别设备身份。

同时设备的 `device_id` 也会被注册到 Server 的设备目录中，用户可以在 Console App 中为设备设置一个友好的别名（例如"客厅主吊灯"），此操作会将该别名与 `device_id` 进行绑定。AI 引擎在生成命令时会优先使用别名，如果别名存在歧义则回退到 `device_id`。

## MQTT Topic 层级与权限

### 3.1 Topic 命名规范

### 3.2 ACL 权限控制

Server（MQTT Broker）基于 mTLS 证书 CN 或 Access Token 实施 Topic 级访问控制：

- 主题中包含设备自身的 `device_id`；
- 设备**只能**发布和订阅自身 `device_id` 下的主题，以及订阅 `system/announce` 主题，无法读取或控制其他设备。
- 违反 ACL 的消息被 Broker 丢弃并强制断开连接（可以选择加入黑名单）。

---

## Device ↔ Server 消息协议


---

## Client ↔ Server 消息协议

### 6.1 会话管理

### 6.2 文本交互

### 6.3 语音流式传输

**流式传输流程**：

```
Client                                    Server
  │                                         │
  │ ── audio (stream_state=start) ────────> │ ASR 引擎初始化
  │    codec: "opus/16000/1"                │
  │    chunk-idx: 0                         │
  │                                         │
  │ ── audio (stream_state=data) ─────────> │ 流式识别…
  │    chunk-idx: 1, audio_data: [Opus帧]   │
  │                                         │
  │ ── audio (stream_state=data) ─────────> │ 流式识别…
  │    chunk-idx: 2, audio_data: [Opus帧]   │
  │                                         │
  │ ── audio (stream_state=end) ──────────> │ ASR 完成，交给 LLM
  │    chunk-idx: 3                         │
  │                                         │
  │ <── server_resp (stream) ────────────── │ AI 响应
  │                                         │
```

- 每个 MQTT PUBLISH 最大 **8 KB**（适配常见 Broker 限制）
- Server 端执行流式 ASR（边接收边识别），实现低延迟交互
- MQTT User Property 携带 `session-id`、`chunk-idx`、`stream-state`、`content-type: audio/opus`

### 6.4 图片传输

图片在发送前已知大小，采用分片传输：

- 每片最大 **16 KB**
- 图片总大小上限 **5 MB**
- MQTT User Property 携带 `content-type: image/jpeg`（或 `image/png`）
- Server 使用 `session-id` + `msg_id` 作为重组键

### 6.6 安全敏感设备确认流程

标记为 `security_critical: true` 的设备（门锁、摄像头、报警器、车库门），其命令需用户显式确认

**流程**：
1. AI 引擎生成涉及安全敏感设备的命令
2. Server 暂存命令，向 Client 发送 `confirm_req`
3. Client 展示确认界面（例如"AI 想要解锁前门，是否允许？"）
4. 用户确认或拒绝，Client 回复 `confirm_resp`
5. 确认通过后 Server 下发命令；超时或拒绝则丢弃

---

## Server 内部：AI 引擎与数据层

### 7.1 LLM 请求处理流程

### 7.2 Schema 到 LLM Tool Calling 的映射

### 7.3 DuckDB 遥测数据存储

Server 内置 DuckDB 作为遥测数据的时序存储引擎。DuckDB 为嵌入式列式数据库，适合在边缘设备（树莓派、NAS、路由器）上运行分析查询。

---

## 消息完整性与安全

### 8.1 传输层安全

| 通信方 | 安全机制 | 详情 |
|---|---|---|
| Device ↔ Server | mTLS 1.3（双向证书认证） | 设备持 NOC，Server 持 Root CA |
| Client ↔ Server | TLS 1.3 + Access Token (JWT) | Token 由 TrustAnchor 签发 |

详见 [架构安全设计](./secure-net-design.md) 第二至四节。

