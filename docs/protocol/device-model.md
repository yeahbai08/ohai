# 设备能力模型

本文档定义 OHAI 设备能力模型的核心概念：State、Command、Event 三种元素，以及将它们结构化关联的 `affects`、`reports` 机制和 `ai_policy` 安全策略。

关于 Schema 文件的具体格式与校验规则，详见 [设备 Schema 规范](./schema.md)。

---

## 1. 核心概念

每个 **Capability**（能力）由三种元素组成：

### 1.1 State（状态）

设备的 **可观测状态**。State 是设备在某一时刻的快照，由 Server 维护为 Device Shadow。

- 每个 State 具有明确的类型（`boolean`、`integer`、`number`、`string`）和约束（`minimum`、`maximum`、`enum` 等）
- State 可标注 `unit` 物理单位

示例：灯泡亮度是一个 State — `brightness: 80`（整数，0–100，单位 %）。

### 1.2 Command（命令）

改变设备状态或触发设备动作的指令。OHAI 定义三种命令类型，分别对应不同的 MQTT QoS 等级与投递语义：

| 命令类型 | QoS | 幂等 | `affects` 字段 | 适用场景 |
|---|---|---|---|---|
| `state_cmd` | 1（至少一次） | 是 | **必填**（可为空 `[]`） | 设置目标状态（亮度、温度、开关…） |
| `instant_cmd` | 0（至多一次） | 否 | **禁止** | 实时触发（播放、拍照、TTS…） |
| `once_cmd` | 2（恰好一次） | 否 | **禁止** | 关键操作（喂食、服药记录…） |

### 1.3 Event（事件）

设备 **主动上报** 的异步消息，不由 Server 命令触发。事件描述"发生了什么"，而非"状态是什么"。

- 事件可通过 `reports` 字段声明其同时更新了哪些 States（详见 [2.2 节](#_2-2-reports-机制)）
- Server 收到事件后根据自动化规则或 AI 引擎进行响应

示例：用户按下灯泡物理按键 → 设备上报 `physical_toggle` 事件，同时通过 `reports: ["on"]` 告知 Server 开关状态已变更。

---

## 2. 命令与状态的结构化关联

### 2.1 `affects` 机制

`affects` 是 OHAI 能力模型的核心设计，在 Schema 层面将命令与其影响的状态 **显式关联**：

```yaml
commands:
  set_brightness:
    cmd_type: state_cmd
    affects: [brightness]     # 此命令影响 brightness 状态
    ...
```

**规则**：

1. **`state_cmd` 必须声明 `affects` 字段**，即使为空数组 `[]`。这要求开发者在设计阶段明确每条命令的状态影响范围。
2. **`instant_cmd` 和 `once_cmd` 禁止声明 `affects` 字段**。若命令会修改持久状态，应使用 `state_cmd`。
3. **`affects` 中的值必须引用同一 Capability 内 `states` 中已声明的键名**。Server 在注册时执行交叉校验。

#### 开发者引导效果

`affects` 机制在结构上引导开发者做出正确的设计决策：

**场景**：开发者为灯泡编写"设置亮度"命令。

1. 声明 `cmd_type: state_cmd` → Schema 要求提供 `affects` 字段
2. 声明 `affects: [brightness]` → 必须在 `states` 中定义 `brightness`
3. `params` 中的 `brightness` 参数与 `states.brightness` 类型一致 → 命令与状态的关系清晰可追溯

**错误检测**：若开发者将修改状态的命令误标为 `instant_cmd`，则 `states` 中将出现无任何命令 `affects` 的孤立状态 → Server 注册时发出警告。

### 2.2 `reports` 机制

与 `affects` 对称，Event 通过 `reports` 声明其携带了哪些状态的更新：

```yaml
events:
  physical_toggle:
    reports: [on]             # 此事件携带 on 状态的新值
    params:
      type: object
      properties:
        on: { type: boolean }
```

Server 收到带 `reports` 的事件后，自动提取事件参数中的对应值更新 Device Shadow。`affects` 与 `reports` 共同闭合了状态同步回路：

```
命令下发 ──affects──► 状态变更 ──Device Shadow 更新
事件上报 ──reports──► 状态变更 ──Device Shadow 更新
```

---

## 3. AI 安全策略（ai_policy）

OHAI 在设备 Schema 中为每条命令声明 AI 安全策略。`ai_policy` 是 Schema 的**顶层独立字段**，与能力定义结构分离——安全策略反映设备的实际风险特征，而非能力类型的预设假设。该策略约束所有由 AI 引擎决策的操作，包括自动化规则触发的命令和 AI 响应用户语音/文本指令时生成的命令。

| 策略 | 含义 | AI 决策行为 |
|---|---|---|
| `allow` | 常规操作（默认） | AI 可直接执行 |
| `confirm` | 需要用户确认 | AI 触发时暂停，推送确认请求至 Console App |
| `deny` | 禁止 AI 执行 | Server 无条件拦截，仅允许用户在 Console App 中手动操作 |

当同一命令的不同参数值具有不同风险等级时，使用参数级策略声明。`when` 使用 JSON Schema 子集语法匹配参数值，按声明顺序首条命中生效。**未命中任何 `when` 时回退至 `confirm`**——这确保未被显式覆盖的参数组合默认需要用户确认，防止因遗漏 `when` 条件而意外放行危险操作。

**策略解析模型**：

```
effective_policy = user_config ?? device_schema ?? standard_default ?? "allow"
```

| 层级 | 定义方 | 说明 |
|---|---|---|
| **标准能力默认** | OHAI 标准库 | 标准能力库中的推荐策略，设备引用标准能力时自动继承 |
| **设备 Schema 声明** | 设备开发者 | 在 Schema 的 `ai_policy` 字段中声明，**完全替换**标准默认（可加严也可放宽） |
| **用户设备配置** | Console App | 用户在运行时调整，**完全替换**设备声明（可加严也可放宽） |

每层完全替换上一层，不再取 max()。这使设备开发者能根据设备的实际风险特征自由设定策略——例如智能宠物门可将开锁策略从标准默认的 `confirm` 放宽为 `allow`（自动开门是核心使用场景），而高安全门锁可将其加严为 `deny`。

详细的 Schema 语法见 [设备 Schema 规范 - 安全策略声明](./schema.md#_2-4-安全策略声明)。

::: warning 约束范围
`ai_policy` 约束所有由 AI 引擎决策的操作（自动化规则执行、AI 响应用户语音/文本指令生成的命令），不限制用户在 Console App 中直接点击按钮的手动操作。
:::

---

## 4. 能力设计规范

- **单一职责** — 每个能力聚焦于一个独立的功能维度（如开关、亮度、色温分别独立）
- **按需组合** — 设备按需引用标准能力，无需全部实现；灯泡引用 `ohai.switch` + `ohai.brightness`，插座仅引用 `ohai.switch`
- **命令幂等优先** — 优先使用 `state_cmd` 设置绝对目标值，确保重复执行安全
- **`affects` 显式关联** — `state_cmd` 必须声明 `affects` 字段，将命令与状态显式绑定
- **`reports` 闭合回路** — 事件通过 `reports` 声明携带的状态更新，Server 自动更新 Device Shadow
