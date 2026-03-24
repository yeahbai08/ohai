# 设备能力模型与 Schema 设计

本文档定义 OHAI 的设备能力模型（Capability Model）和 Schema 文件格式。设备能力模型描述设备"能做什么"，Schema 文件是这一描述的机器可读实现。协议运行时的消息格式、MQTT 主题、消息流程等详见 [协议框架](./protocol-framework.md)。

## 1. 设计理念

### 1.1 Capability-Based 组合模型

OHAI 采用 **基于能力（Capability-Based）** 的设备模型。一台设备由多个能力组合而成，而非按设备类型硬编码。

例如，一台"智能灯泡"不是一个不可分割的整体，而是由以下能力组合而成：

| 能力 | 含义 |
|---|---|
| `ohai.switch` | 开关控制 |
| `ohai.brightness` | 亮度控制 |
| `ohai.color_temperature` | 色温控制 |

这种设计带来的好处：

- **复用**：标准能力（`ohai.*`）由 OHAI 在中央注册表中定义一次，设备 Schema 只需**按键名引用**，无需重复编写。智能灯泡和智能插座都引用 `ohai.switch`，控制逻辑和 UI 自动复用。
- **组合**：设备的能力集是灵活的。一台基础灯泡只引用 `ohai.switch`，高端灯泡可以加上 `ohai.brightness` + `ohai.color_temperature` + `ohai.color`。
- **可扩展**：厂商可以定义自己的能力（`{vendor}.*` 命名空间），无需修改协议。
- **AI 友好**：每个能力有独立的语义，AI 引擎可以按能力理解和操作设备，而非学习每个厂商的私有接口。

### 1.2 与其他协议的设计对比

| | OHAI Capability | Matter Cluster | ZCL Cluster | SmartThings Capability | HA Entity |
|---|---|---|---|---|---|
| **粒度** | 单一职责能力 | 功能集群 | 功能集群 | 单一职责能力 | 按领域划分 |
| **组合方式** | 自由组合 | Endpoint 包含多 Cluster | Endpoint 包含多 Cluster | Profile 组合多 Capability | 每个实体一个领域 |
| **标准 + 自定义** | `ohai.*` + `{vendor}.*` | 标准 Cluster + 厂商 Cluster | 标准 + 厂商 Profile | 标准 + 自定义 | 内置 + 自定义 Platform |
| **状态-命令关联** | `affects` 显式声明 | 隐式（属性+命令同在 Cluster） | 隐式 | 隐式 | 隐式（服务调用→状态变更） |
| **AI 语义** | `semantic` 字段原生支持 | 无 | 无 | 无 | 无 |

OHAI 的核心差异化在于：**`affects` 机制将命令与状态的关系显式化**，以及 **`semantic` 字段为 AI 提供原生语义理解**。

### 1.3 三层架构

OHAI 的设备交互分为三层，职责清晰分离：

| 层级 | 由谁定义 | 内容 |
|---|---|---|
| **协议框架层** | OHAI 协议（不可修改） | JSON-RPC 2.0 信封、MQTT 主题、QoS 策略、错误码 |
| **标准能力层** | OHAI 标准库（可选实现） | `ohai.*` 命名空间下的预定义能力（switch、brightness 等） |
| **厂商能力层** | 设备开发者（自由定义） | `{vendor}.*` 命名空间下的自定义能力 |

---

## 2. 核心概念

每个 **Capability**（能力）包含三种元素：

### 2.1 State（状态）

设备的 **可观测状态**。State 是设备在某一时刻的"快照"，由 Server 维护为 [Device Shadow](./protocol-framework.md#状态同步与设备影子)。

- 每个 State 有明确的类型（`boolean`、`integer`、`number`、`string`）和约束（`minimum`、`maximum`、`enum` 等）
- State 可带 `semantic` 标签，供 AI 引擎跨设备理解
- State 可带 `unit` 标注物理单位

示例：灯泡亮度是一个 State —— `brightness: 80`（整数，0-100，单位 %）

### 2.2 Command（命令）

改变设备状态或触发设备动作的指令。OHAI 定义三种命令类型，每种对应不同的 MQTT QoS 等级和投递语义：

| 命令类型 | QoS | 幂等 | `affects` 字段 | 适用场景 |
|---|---|---|---|---|
| `state_cmd` | 1（至少一次） | 是 | **必填**（可为空 `[]`） | 设置目标状态（亮度、温度、开关…） |
| `instant_cmd` | 0（至多一次） | 否 | **禁止** | 实时触发（播放、拍照、TTS…） |
| `once_cmd` | 2（恰好一次） | 否 | **禁止** | 关键操作（喂食、服药记录…） |

命令类型的详细设计理念见 [消息协议 - 命令分类与投递语义](./secure-message-design.md#_1-3-命令分类与投递语义)。

### 2.3 Event（事件）

设备 **主动上报** 的异步消息，不由 Server 命令触发。事件描述"发生了什么"，而非"状态是什么"。

- 事件可携带状态更新：通过 `reports` 字段声明此事件同时更新了哪些 States
- Server 收到事件后根据 [自动化规则](./protocol-framework.md#ai-自动化集成) 或 AI 引擎进行响应

示例：用户按下灯泡的物理按键 → 设备上报 `physical_toggle` 事件，同时 `reports: ["on"]` 告知 Server 开关状态已变更。

---

## 3. 命令与状态的结构化关联

### 3.1 `affects` 机制

`affects` 是 OHAI 能力模型的核心设计。它在 Schema 层面将命令与其影响的状态 **显式关联**：

```yaml
commands:
  set_brightness:
    cmd_type: state_cmd
    affects: [brightness]     # ← 此命令会修改 brightness 状态
    ...
```

**规则**：

1. **`state_cmd` 必须有 `affects` 字段**，哪怕为空数组 `[]`。这强制开发者在设计时做出有意识的决策："这条命令影响哪些状态？"
2. **`instant_cmd` 和 `once_cmd` 禁止有 `affects` 字段**。如果一条命令改变了持久状态，它就应该是 `state_cmd`。
3. **`affects` 中的值必须是同一 Capability 的 `states` 中已声明的键名**。Server 在注册时做交叉校验。

### 3.2 开发者引导效果

这种设计在结构上引导开发者做出正确的设计决策：

**场景**：开发者正在为灯泡编写"设置亮度"命令。

1. 写下 `cmd_type: state_cmd` → Schema 要求提供 `affects` 字段
2. 写下 `affects: [brightness]` → 必须在 `states` 中声明 `brightness`
3. `params` 中的 `brightness` 参数与 `states.brightness` 类型一致 → 命令-状态关系清晰

**如果开发者犯了错**：把一个修改状态的命令标为 `instant_cmd`，则 `states` 中会出现"没有任何命令 affects 它"的孤立状态 → Server 注册时发出警告。

### 3.3 Events 的 `reports` 机制

与 `affects` 对称，Events 通过 `reports` 声明它携带了哪些状态的更新：

```yaml
events:
  physical_toggle:
    reports: [on]             # ← 此事件携带 on 状态的新值
    params:
      type: object
      properties:
        on: { type: boolean }
```

Server 收到带 `reports` 的事件后，自动用事件参数中的对应值更新 Device Shadow。这闭合了状态同步回路：

```
命令下发 ──affects──► 状态变更 ──Device Shadow 更新
事件上报 ──reports──► 状态变更 ──Device Shadow 更新
```

---

## 4. Schema 文件格式

每个设备产品（每个固件版本）提供一个 `schema.json`（或 `schema.yaml`）文件。

### 4.1 顶层结构

```jsonc
{
  "$schema": "https://ohai.dev/schema/v2/device-schema.json",
  "schema_version": "2.0",
  "vendor": "example-vendor",
  "product": "smart-light-bulb",
  "firmware_version": "1.2.0",
  "capabilities": { /* 能力定义 */ },
  "panel": { /* 可选：Adaptive Card 控制面板 */ }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `$schema` | string | 否 | Meta-Schema URL，供编辑器校验和自动补全 |
| `schema_version` | string | 是 | 固定为 `"2.0"` |
| `vendor` | string | 是 | 厂商标识符（小写字母、数字、连字符） |
| `product` | string | 是 | 产品标识符（同上） |
| `firmware_version` | string | 是 | 固件版本号（SemVer 格式） |
| `capabilities` | object | 是 | 能力定义集合（至少一个） |
| `panel` | object | 否 | Adaptive Card 控制面板定义 |

`schema_id = keccak256(vendor + product + firmware_version)` 唯一标识一个 Schema。

### 4.2 Capability 引用与定义

OHAI 的 `capabilities` 支持两种写法：**引用标准能力**和**完整定义自定义能力**。

#### 引用标准能力

标准能力（`ohai.*`）由 OHAI 标准库预定义（见[第 5 节](#_5-标准能力库)），设备 Schema 只需按键名引用，无需重复编写内部定义：

```jsonc
{
  "capabilities": {
    "ohai.switch": {},                // 引用标准定义，空对象即可
    "ohai.brightness": {},            // 同上
    "ohai.color_temperature": {}      // 同上
  }
}
```

Server 注册时看到 `ohai.*` 键名与空对象（或仅含 `overrides` 的对象），自动从标准库填充完整的 `states`、`commands`、`events` 定义。

#### 覆盖标准能力的部分约束

某些设备需要微调标准能力的约束（如亮度范围、色温范围），可通过 `overrides` 字段部分覆盖：

```jsonc
{
  "capabilities": {
    "ohai.brightness": {
      "overrides": {
        "states": {
          "brightness": {
            "maximum": 50           // 此灯泡亮度仅支持到 50%，其余继承标准定义
          }
        }
      }
    }
  }
}
```

`overrides` 采用深度合并策略：只覆盖指定的字段，未指定的字段保持标准定义不变。可覆盖的内容限于 **值约束**（`minimum`、`maximum`、`enum`、`unit`），不允许覆盖结构性字段（`type`、`cmd_type`、`affects`、`reports`）。

#### 完整定义自定义能力

厂商自定义能力（`{vendor}.*`）没有标准定义可引用，必须提供完整的 `description`、`states`、`commands`、`events`：

```jsonc
{
  "capabilities": {
    "example-vendor.blink": {
      "description": "闪烁提示（用于设备识别）",
      "states":   { /* ... */ },
      "commands": { /* ... */ },
      "events":   { /* ... */ }
    }
  }
}
```

**能力键名规则**：
- 标准能力：`ohai.<name>`（如 `ohai.switch`、`ohai.brightness`）
- 厂商自定义：`<vendor>.<name>`（如 `example-vendor.blink`）

对于完整定义的能力，`states`、`commands`、`events` 都是必填字段，但允许为空对象 `{}`（例如纯传感器可以没有 commands）。

### 4.3 State 定义

```jsonc
"states": {
  "on": {
    "type": "boolean",
    "description": "是否开启",
    "semantic": "power_state"
  },
  "brightness": {
    "type": "integer",
    "minimum": 0,
    "maximum": 100,
    "unit": "%",
    "description": "亮度百分比",
    "semantic": "brightness_level"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 是 | 值类型：`boolean`、`integer`、`number`、`string` |
| `description` | string | 是 | 状态说明（会传入 LLM 上下文） |
| `semantic` | string | 否 | AI 语义标签（见 [4.7 节](#_4-7-semantic-语义标签)） |
| `minimum` / `maximum` | number | 否 | 数值约束 |
| `unit` | string | 否 | 物理单位（如 `"%"`、`"K"`、`"°C"`） |
| `enum` | array | 否 | 枚举值列表（type 为 string 时） |

### 4.4 Command 定义

```jsonc
"commands": {
  "set_on": {
    "cmd_type": "state_cmd",
    "affects": ["on"],
    "description": "设置开关状态",
    "params": {
      "type": "object",
      "properties": {
        "on": { "type": "boolean" }
      },
      "required": ["on"],
      "additionalProperties": false
    },
    "result": {
      "type": "object",
      "properties": {
        "on": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `cmd_type` | string | 是 | `"state_cmd"`、`"instant_cmd"` 或 `"once_cmd"` |
| `affects` | string[] | state_cmd 必填 | 此命令影响的 states 列表（可为空 `[]`） |
| `description` | string | 是 | 命令说明（会传入 LLM 上下文） |
| `params` | JSON Schema | 是 | 命令参数定义（[JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)） |
| `result` | JSON Schema | 否 | 成功回复的数据定义 |

::: warning 命令类型约束
- `state_cmd`：**必须**提供 `affects` 字段，即使为空数组 `[]`。这迫使开发者有意识地审视命令与状态的关系。
- `instant_cmd` / `once_cmd`：**禁止**出现 `affects` 字段。如果命令会修改持久状态，请使用 `state_cmd`。
:::

::: tip 错误处理
命令执行失败时，设备从 [错误码规范](./error-codes.md) 中定义的封闭枚举中选取错误码回复，不允许自定义错误码或附加自由文本。
:::

### 4.5 Event 定义

```jsonc
"events": {
  "physical_toggle": {
    "description": "物理按键切换了开关",
    "reports": ["on"],
    "params": {
      "type": "object",
      "properties": {
        "on": { "type": "boolean" }
      },
      "required": ["on"],
      "additionalProperties": false
    }
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `description` | string | 是 | 事件说明 |
| `reports` | string[] | 否 | 此事件携带哪些 states 的更新 |
| `params` | JSON Schema | 是 | 事件负载定义 |

### 4.6 Semantic 语义标签 {#_4-7-semantic-语义标签}

`semantic` 是一个受控词汇表中的标识符，帮助 AI 引擎跨厂商、跨设备统一理解同一语义的状态。例如，厂商 A 的灯泡将开关状态命名为 `on`，厂商 B 的插座命名为 `power`，但两者都标注 `semantic: "power_state"`，AI 引擎可以统一理解。

**标准语义标签**（部分列表）：

| 标签 | 含义 | 典型类型 |
|---|---|---|
| `power_state` | 电源开关状态 | boolean |
| `brightness_level` | 亮度等级 | integer (0-100) |
| `color_temperature` | 色温 | integer (K) |
| `temperature_reading` | 温度读数 | number (°C) |
| `humidity_reading` | 湿度读数 | number (%) |
| `lock_state` | 门锁状态 | boolean |
| `battery_level` | 电池电量 | integer (0-100) |
| `motion_detected` | 是否检测到运动 | boolean |
| `contact_state` | 门窗开合状态 | boolean |
| `occupancy` | 是否有人 | boolean |

---

## 5. 标准能力库

OHAI 预定义了一组 `ohai.*` 标准能力，作为**中央注册表**供设备 Schema 引用。设备按需组合，引用时无需重复编写内部定义（见 [4.2 节](#_4-2-capability-引用与定义)）。

标准能力的完整定义详见 [标准能力库](./standard-capabilities.md)。

### 5.1 厂商自定义能力

标准能力无法覆盖的功能，厂商使用 `{vendor}.<name>` 命名空间定义：

```yaml
capabilities:
  petkit.feeder:
    description: 宠物喂食器投食控制
    states:
      remaining_portions:
        type: integer
        minimum: 0
        description: 剩余份数
    commands:
      dispense:
        cmd_type: once_cmd        # 关键操作，恰好一次
        description: 投放一份食物
        params:
          type: object
          properties:
            portions: { type: integer, minimum: 1, maximum: 5 }
          required: [portions]
          additionalProperties: false
        result:
          type: object
          properties:
            dispensed: { type: integer }
          additionalProperties: false
    events:
      food_low:
        description: 食物储量不足
        params:
          type: object
          properties:
            remaining_grams: { type: number }
          required: [remaining_grams]
          additionalProperties: false
```

---

## 6. 完整示例

### 6.1 智能灯泡

组合能力：`ohai.switch` + `ohai.brightness` + `ohai.color_temperature` + 厂商自定义 `example.blink`

::: details 展开完整 schema.yaml
```yaml
$schema: https://ohai.dev/schema/v2/device-schema.json
schema_version: "2.0"
vendor: example-vendor
product: smart-light-bulb
firmware_version: "1.2.0"

capabilities:
  ohai.switch: {}                    # 引用标准能力，无需重复定义
  ohai.brightness: {}
  ohai.color_temperature: {}

  example-vendor.blink:              # 厂商自定义能力，需完整定义
    description: 闪烁提示（用于设备识别）
    states: {}
    commands:
      blink:
        cmd_type: instant_cmd       # 实时触发，过期不补发
        description: 闪烁指定次数
        params:
          type: object
          properties:
            times: { type: integer, minimum: 1, maximum: 10 }
            interval_ms: { type: integer, minimum: 100, maximum: 2000 }
          required: [times, interval_ms]
          additionalProperties: false
        result: {}
    events:
      overheat_warning:
        description: 灯泡温度超过安全阈值
        params:
          type: object
          properties:
            temperature_c: { type: number }
          required: [temperature_c]
          additionalProperties: false

panel:
  # 见第 10 节 Adaptive Cards 面板设计
```
:::

### 6.2 温湿度传感器

组合能力：`ohai.sensor.temperature` + `ohai.sensor.humidity` + `ohai.sensor.battery`

::: details 展开完整 schema.yaml
```yaml
$schema: https://ohai.dev/schema/v2/device-schema.json
schema_version: "2.0"
vendor: example-vendor
product: temp-humidity-sensor
firmware_version: "2.0.1"

capabilities:
  ohai.sensor.temperature: {}        # 引用标准能力
  ohai.sensor.humidity: {}
  ohai.sensor.battery: {}
```
:::

### 6.3 智能门锁

组合能力：`ohai.lock` + `ohai.sensor.battery`

::: details 展开完整 schema.yaml
```yaml
$schema: https://ohai.dev/schema/v2/device-schema.json
schema_version: "2.0"
vendor: example-vendor
product: smart-door-lock
firmware_version: "3.1.0"

capabilities:
  ohai.lock: {}                      # 引用标准能力
  ohai.sensor.battery: {}
```
:::

### 6.4 智能喂食器

组合能力：`ohai.switch` + `petkit.feeder`（厂商自定义能力使用 `once_cmd`）

::: details 展开完整 schema.yaml
```yaml
$schema: https://ohai.dev/schema/v2/device-schema.json
schema_version: "2.0"
vendor: petkit
product: smart-feeder-pro
firmware_version: "4.0.0"

capabilities:
  ohai.switch: {}                    # 引用标准能力

  petkit.feeder:                     # 厂商自定义能力，需完整定义
    description: 宠物喂食控制
    states:
      remaining_portions:
        type: integer
        minimum: 0
        description: 剩余份数
    commands:
      dispense:
        cmd_type: once_cmd            # 恰好一次：丢失则宠物挨饿，重复则过量喂食
        description: 投放食物
        params:
          type: object
          properties:
            portions: { type: integer, minimum: 1, maximum: 5, description: 投放份数 }
          required: [portions]
          additionalProperties: false
        result:
          type: object
          properties:
            dispensed: { type: integer, description: 实际投放份数 }
            remaining: { type: integer, description: 剩余份数 }
          additionalProperties: false
    events:
      food_low:
        description: 食物储量不足
        reports: [remaining_portions]
        params:
          type: object
          properties:
            remaining_portions: { type: integer }
            remaining_grams: { type: number }
          required: [remaining_portions]
          additionalProperties: false
      dispense_complete:
        description: 投食完成
        reports: [remaining_portions]
        params:
          type: object
          properties:
            dispensed: { type: integer }
            remaining_portions: { type: integer }
          required: [dispensed, remaining_portions]
          additionalProperties: false
```
:::

---

## 7. Schema 校验规则与元 Schema

### 7.1 OHAI Meta-Schema

Server 使用以下 JSON Schema 校验开发者提交的 `schema.json` 的结构合法性。`panel` 字段由 Adaptive Cards 语法校验器单独处理。

::: details 展开完整 Meta-Schema
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://ohai.dev/schema/v2/device-schema.json",
  "title": "OHAI Device Schema",
  "type": "object",
  "required": ["schema_version", "vendor", "product", "firmware_version", "capabilities"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "schema_version": { "const": "2.0" },
    "vendor": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "description": "厂商标识符（小写字母、数字、连字符）"
    },
    "product": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "description": "产品标识符"
    },
    "firmware_version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "固件版本号（SemVer）"
    },
    "capabilities": {
      "type": "object",
      "minProperties": 1,
      "patternProperties": {
        "^(ohai\\.[a-z][a-z0-9_.]*|[a-z][a-z0-9-]*\\.[a-z][a-z0-9_.]*)$": {
          "$ref": "#/$defs/capability"
        }
      },
      "additionalProperties": false
    },
    "panel": {
      "type": "object",
      "description": "Adaptive Card 控制面板（由 Adaptive Cards 校验器单独校验）"
    }
  },

  "$defs": {
    "capability": {
      "oneOf": [
        {
          "type": "object",
          "description": "引用标准能力（ohai.* 键名，空对象或仅含 overrides）",
          "additionalProperties": false,
          "properties": {
            "overrides": { "$ref": "#/$defs/capability_overrides" }
          }
        },
        {
          "type": "object",
          "description": "完整定义自定义能力",
          "required": ["description", "states", "commands", "events"],
          "additionalProperties": false,
          "properties": {
            "description": { "type": "string", "minLength": 1 },
            "states": {
              "type": "object",
              "patternProperties": {
                "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/state_definition" }
              },
              "additionalProperties": false
            },
            "commands": {
              "type": "object",
              "patternProperties": {
                "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/command_definition" }
              },
              "additionalProperties": false
            },
            "events": {
              "type": "object",
              "patternProperties": {
                "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/event_definition" }
              },
              "additionalProperties": false
            }
          }
        }
      ]
    },

    "capability_overrides": {
      "type": "object",
      "description": "部分覆盖标准能力的值约束",
      "additionalProperties": false,
      "properties": {
        "states": {
          "type": "object",
          "description": "覆盖 states 中的值约束（minimum、maximum、enum、unit）",
          "patternProperties": {
            "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/state_overrides" }
          },
          "additionalProperties": false
        }
      }
    },

    "state_overrides": {
      "type": "object",
      "description": "可覆盖的 state 值约束字段，不允许覆盖 type 等结构性字段",
      "additionalProperties": false,
      "properties": {
        "minimum": { "type": "number" },
        "maximum": { "type": "number" },
        "unit": { "type": "string" },
        "enum": { "type": "array", "minItems": 1 }
      }
    },

    "state_definition": {
      "type": "object",
      "required": ["type", "description"],
      "additionalProperties": false,
      "properties": {
        "type": { "enum": ["boolean", "integer", "number", "string"] },
        "description": { "type": "string", "minLength": 1 },
        "semantic": { "type": "string" },
        "minimum": { "type": "number" },
        "maximum": { "type": "number" },
        "unit": { "type": "string" },
        "enum": { "type": "array", "minItems": 1 }
      }
    },

    "command_definition": {
      "type": "object",
      "required": ["cmd_type", "description", "params"],
      "additionalProperties": false,
      "properties": {
        "cmd_type": { "enum": ["state_cmd", "instant_cmd", "once_cmd"] },
        "description": { "type": "string", "minLength": 1 },
        "affects": {
          "type": "array",
          "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" }
        },
        "params": { "type": "object" },
        "result": { "type": "object" }
      },
      "allOf": [
        {
          "if": {
            "properties": { "cmd_type": { "const": "state_cmd" } }
          },
          "then": {
            "required": ["affects"]
          }
        },
        {
          "if": {
            "properties": { "cmd_type": { "enum": ["instant_cmd", "once_cmd"] } }
          },
          "then": {
            "not": { "required": ["affects"] }
          }
        }
      ]
    },

    "event_definition": {
      "type": "object",
      "required": ["description", "params"],
      "additionalProperties": false,
      "properties": {
        "description": { "type": "string", "minLength": 1 },
        "reports": {
          "type": "array",
          "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" }
        },
        "params": { "type": "object" }
      }
    }
  }
}
```
:::

### 7.2 语义校验（程序逻辑）

Meta-Schema 只能校验结构合法性。Server 在设备注册时还会执行以下**语义校验**：

1. `ohai.*` 键名的能力必须在标准能力库中存在（未知的标准能力键名拒绝注册）
2. `overrides` 中引用的 state 键名必须在对应标准能力的 `states` 中存在
3. `overrides` 的值约束必须是标准定义的子集（如标准定义 `maximum: 100`，override 只能 ≤ 100）
4. 非 `ohai.*` 键名的能力必须提供完整定义（`description`、`states`、`commands`、`events`）
5. `affects` 中的每个值必须是同一 Capability 的 `states` 中已声明的键名
6. `reports` 中的每个值必须是同一 Capability 的 `states` 中已声明的键名
7. 如果 `params` 中存在与 `affects` 指向的 state 同名的属性，其类型约束应与 state 定义兼容
8. 每个 State 应至少被一个 Command `affects` 或一个 Event `reports`（否则发出警告：孤立状态）
9. `semantic` 值应来自 OHAI 标准语义词汇表（未知值发出警告但不拒绝注册）

### 7.3 校验时机

| 时机 | 校验内容 |
|---|---|
| **设备注册** | Meta-Schema 结构校验 + 语义校验 + Panel 校验（Adaptive Cards） |
| **命令下发前** | AI 引擎生成的参数经对应命令的 `params` Schema 校验 |
| **回复接收时** | 设备回复的 `result` 经对应 Schema 校验；`error` 的 code/message 经 [错误码规范](./error-codes.md) 校验，不合法则丢弃并记录日志 |
| **事件接收时** | 事件负载经对应事件的 `params` Schema 校验，不合法则丢弃并记录日志 |

### 7.4 Schema 版本演进

- 新增 Capability、State、Command、Event：**向后兼容**，直接添加即可
- 修改现有字段类型或约束：**不兼容**，需更新 `firmware_version` 并注册新 Schema
- 删除 Capability 或命令：**不兼容**，需更新 `firmware_version`
- 使用 `additionalProperties: false` 确保所有字段都被显式声明

---

## 8. JSON 与 YAML 双格式支持

开发者可以选择用 **JSON** 或 **YAML** 编写 Schema 文件：

| | JSON (`schema.json`) | YAML (`schema.yaml`) |
|---|---|---|
| **优势** | 工具链原生支持、与 JSON Schema 一致 | 支持注释、无括号嵌套、可读性更好 |
| **适合场景** | AI 工具生成、程序化处理 | 人工编写、代码审查 |
| **注册时** | 直接提交 | 工具链自动转换为 JSON 后提交 |

两种格式语义等价。OHAI CLI 工具（`ohai schema validate`）和未来提供的 **Schema 编写 Skills**（AI 辅助编写工具）均同时支持两种格式的读写和校验。**Server 只接受 JSON 格式注册**，YAML 在客户端侧转换。

::: tip 使用 AI 编写 Schema
OHAI 将提供专用的 Schema 编写 Skills（Claude Code / Cursor 等 AI 编辑器的技能插件）。开发者只需用自然语言描述设备功能，Skills 即可自动生成符合 Meta-Schema 规范的 `schema.yaml`，并执行本地校验。
:::

---

## 9. Schema 到 LLM Tool Calling 的映射

OHAI Server 将设备 Schema 自动映射为 LLM 的 Tool Calling 定义。由于 Schema 中每条命令的 `params` 使用标准 JSON Schema 描述，与 LLM Tool Calling 的参数定义格式（OpenAI / Anthropic API 均使用 JSON Schema）天然一致，映射过程无需格式转换。

**映射规则**：

| Schema 字段 | LLM Tool 字段 |
|---|---|
| Capability `description` + Command `description` | Tool `description` |
| Command `params` (JSON Schema) | Tool `input_schema` |
| `<capability>:<command>` | Tool `name` |
| State `semantic` 标签 | 注入 Tool description 提供额外语义上下文 |

**示例映射**（`ohai.brightness:set_brightness` → LLM Tool）：

```json
{
  "name": "ohai.brightness:set_brightness",
  "description": "亮度控制 — 设置亮度（绝对值）。影响状态: brightness (当前值: 60%)",
  "input_schema": {
    "type": "object",
    "properties": {
      "brightness": { "type": "integer", "minimum": 0, "maximum": 100 }
    },
    "required": ["brightness"],
    "additionalProperties": false
  }
}
```

Server 在构建 LLM 上下文时，会将设备当前 Shadow 状态注入 Tool description，使 LLM 生成绝对目标值时有充足的上下文参考。

---

## 10. 设备控制面板：Adaptive Cards

厂商可在 `schema.json` 的 `panel` 字段中提供一个 [Adaptive Card](https://adaptivecards.io/) 定义，描述设备在 Console App 中的控制面板 UI。

### 10.1 设计原则

- **声明式 UI**：厂商用 Adaptive Card JSON 声明面板布局和交互元素，Console App 决定最终渲染样式（适配手机、平板、桌面等不同设备形态）
- **数据绑定**：Card 模板中使用 Adaptive Cards 标准的 `${...}` 模板语法引用设备 States，Console App 实时注入 Device Shadow 数据进行渲染
- **命令绑定**：通过 `Action.Execute` 的 `verb` 字段映射到 Schema 中定义的命令，Console App 据此下发命令
- **趋势图扩展**：OHAI 定义扩展元素 `OhaiChart` 引用 States 的历史数据，Console App 从 DuckDB 查询后渲染
- **可选**：如果厂商不提供 Panel，Console App 根据 States 和 Commands 的类型约束自动生成默认面板

### 10.2 数据绑定

Panel 模板中使用 `${...}` 语法引用运行时数据。Console App 在渲染时将 Device Shadow 数据注入模板上下文：

| 绑定语法 | 含义 | 示例 |
|---|---|---|
| `${<capability>:<state>}` | 当前状态值（来自 Device Shadow） | `${ohai.switch:on}` |
| `${$device.alias}` | 设备别名 | `${$device.alias}` |
| `${$device.online}` | 设备是否在线 | `${$device.online}` |

### 10.3 命令绑定

`Action.Execute` 通过 `verb` 字段指定命令的完整路径 `<capability>:<command_name>`，`data` 字段为命令参数。参数值可以来自 Input 控件（通过控件 ID 引用）或硬编码值：

```jsonc
{
  "type": "Action.Execute",
  "title": "设置亮度",
  "verb": "ohai.brightness:set_brightness",   // 命令路径
  "data": {
    "brightness": "${brightness_input}"        // 引用 Input 控件的值
  }
}
```

Console App 收到 Action.Execute 时：
1. 解析 `verb` 得到目标 `capability` 和 `command`
2. 从 `data` 中组装命令参数
3. 用对应命令的 `params` JSON Schema 校验参数
4. 通过 Server API 下发命令

### 10.4 趋势图扩展元素

Adaptive Cards 没有原生图表组件，OHAI 定义扩展类型 `OhaiChart`：

```jsonc
{
  "type": "OhaiChart",
  "chartType": "line",                                    // line | bar | gauge
  "source": "ohai.sensor.temperature:temperature",        // <capability>:<state>
  "timeRange": "24h",                                     // 默认时间范围
  "label": "温度趋势"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `chartType` | string | 是 | `line`（折线图）、`bar`（柱状图）、`gauge`（仪表盘） |
| `source` | string | 是 | 引用 `<capability>:<state>` 路径 |
| `timeRange` | string | 否 | 默认展示时间范围（`1h`、`24h`、`7d`、`30d`），默认 `24h` |
| `label` | string | 否 | 图表标题 |

Console App 根据 `source` 从 DuckDB 查询对应状态的历史遥测数据进行渲染。

### 10.5 完整示例：智能灯泡面板

```jsonc
{
  "panel": {
    "type": "AdaptiveCard",
    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
    "version": "1.5",
    "body": [
      {
        "type": "TextBlock",
        "text": "${$device.alias}",
        "size": "Large",
        "weight": "Bolder"
      },
      {
        "type": "ColumnSet",
        "columns": [
          {
            "type": "Column",
            "width": "stretch",
            "items": [
              { "type": "TextBlock", "text": "电源", "weight": "Bolder" },
              {
                "type": "Input.Toggle",
                "id": "switch_on",
                "title": "",
                "value": "${ohai.switch:on}",
                "valueOn": "true",
                "valueOff": "false"
              }
            ]
          },
          {
            "type": "Column",
            "width": "stretch",
            "items": [
              { "type": "TextBlock", "text": "亮度 ${ohai.brightness:brightness}%" },
              {
                "type": "Input.Number",
                "id": "brightness_input",
                "min": 0,
                "max": 100,
                "value": "${ohai.brightness:brightness}"
              }
            ]
          }
        ]
      },
      {
        "type": "TextBlock",
        "text": "色温 ${ohai.color_temperature:color_temp}K"
      },
      {
        "type": "Input.Number",
        "id": "color_temp_input",
        "min": 2700,
        "max": 6500,
        "value": "${ohai.color_temperature:color_temp}"
      }
    ],
    "actions": [
      {
        "type": "Action.Execute",
        "title": "开关",
        "verb": "ohai.switch:set_on",
        "data": { "on": "${switch_on}" }
      },
      {
        "type": "Action.Execute",
        "title": "设置亮度",
        "verb": "ohai.brightness:set_brightness",
        "data": { "brightness": "${brightness_input}" }
      },
      {
        "type": "Action.Execute",
        "title": "设置色温",
        "verb": "ohai.color_temperature:set_color_temp",
        "data": { "color_temp": "${color_temp_input}" }
      }
    ]
  }
}
```

### 10.6 Panel 校验规则

Server 在设备注册时对 Panel 执行以下校验：

1. Panel 整体通过 Adaptive Cards 语法校验（结构合法的 Adaptive Card）
2. `Action.Execute` 的 `verb` 必须匹配 Schema 中某个 `<capability>:<command>` 键
3. `data` 中引用的参数名必须符合对应命令的 `params` JSON Schema
4. `${<capability>:<state>}` 绑定表达式中的路径必须在 Schema 的 `states` 中存在
5. `OhaiChart.source` 引用的路径必须在 Schema 中存在且对应数值类型状态（`integer` 或 `number`）

### 10.7 自动生成默认面板

如果厂商未提供 `panel`，Console App 基于 Schema 中的 States 和 Commands 类型约束自动生成默认面板：

| State / Param 类型 | 默认 UI 控件 |
|---|---|
| `boolean` | Toggle 开关 |
| `integer` 或 `number`（有 min/max） | Slider 滑块 |
| `integer` 或 `number`（无 min/max） | Number Input 数字输入框 |
| `string`（有 enum） | ChoiceSet 下拉选择 |
| `string`（无 enum） | Text Input 文本输入框 |

事件中带 `reports` 的数值型 States 自动生成趋势图（`OhaiChart` line chart, 24h）。
