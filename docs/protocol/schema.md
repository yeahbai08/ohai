# 设备 Schema 规范

本文档定义 OHAI 设备 Schema 的文件格式、引用机制、覆盖规则、校验体系以及版本演进策略。

关于能力模型的核心概念（State、Command、Event、`affects`、`reports`），详见 [设备能力模型](./device-model.md)。

---

## 1. Schema 文件格式

每个设备产品（每个固件版本）提供一个 `schema.json`（或 `schema.yaml`）文件。

### 1.1 顶层结构

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
| `capabilities` | object | 是 | 能力定义集合（至少包含一个能力） |
| `panel` | object | 否 | Adaptive Card 控制面板定义（详见 [AI 集成 - 控制面板](./ai-integration.md#_2-设备控制面板-adaptive-cards)） |

`schema_id = keccak256(vendor + "\0" + product + "\0" + firmware_version)` 唯一标识一个 Schema。字段之间使用空字节（`\0`）分隔，防止不同字段值拼接后产生哈希碰撞（如 `vendor="ab", product="cd"` 与 `vendor="a", product="bcd"`）。

---

## 2. Capability 引用与定义

`capabilities` 字段支持两种写法：**引用标准能力**和**完整定义自定义能力**。

### 2.1 引用标准能力

标准能力（`ohai.*`）由 OHAI 标准库预定义（详见 [标准能力库](./standard-capabilities.md)），设备 Schema 按键名引用即可，无需重复编写内部定义：

```jsonc
{
  "capabilities": {
    "ohai.switch": {},                // 引用标准定义，空对象即可
    "ohai.brightness": {},
    "ohai.color_temperature": {}
  }
}
```

Server 注册时检测到 `ohai.*` 键名与空对象（或仅含 `overrides` 的对象），自动从标准库填充完整的 `states`、`commands`、`events` 定义。

### 2.2 覆盖标准能力的部分约束

部分设备需要微调标准能力的约束（如亮度范围、色温范围），可通过 `overrides` 字段部分覆盖：

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

`overrides` 采用深度合并策略：仅覆盖指定字段，未指定字段保持标准定义不变。

**States 覆盖** — 可覆盖的内容限于 **值约束**（`minimum`、`maximum`、`enum`、`unit`），不允许覆盖结构性字段（`type`、`cmd_type`、`affects`、`reports`）。

**Commands 覆盖** — 仅允许覆盖 `ai_policy`，且只能 **单向升级**（`allow → confirm → deny`），不允许降级。厂商可在标准能力定义的安全下限之上进一步加严策略，但无法放宽。

```jsonc
{
  "capabilities": {
    "ohai.lock": {
      "overrides": {
        "commands": {
          "set_locked": {
            "ai_policy_by_params": [
              { "when": { "locked": false }, "policy": "deny" }   // 标准定义为 confirm，厂商升级为 deny
            ]
          }
        }
      }
    }
  }
}
```

Commands 覆盖规则：
- 仅允许覆盖 `ai_policy` 和 `ai_policy_by_params`，不允许覆盖 `cmd_type`、`affects`、`params`、`result` 等结构性字段
- 覆盖的策略值必须严于或等于标准定义（`allow < confirm < deny`），Server 注册时校验，不满足则拒绝注册
- `ai_policy_by_params` 的覆盖采用 **逐条合并**：覆盖中声明的 `when` 条件如果与标准定义的某条 `when` 匹配相同参数组合，则取两者中更严格的策略；新增的 `when` 条件直接追加

::: tip 三层策略覆盖模型
`ai_policy` 的生效策略由三层叠加决定：**标准能力定义**（安全下限）→ **厂商 Schema 覆盖**（设备固件）→ **用户设备配置**（Console App 运行时设置）。每层只能升级不能降级。详见 [设备能力模型 - 自动化安全策略](./device-model.md#_4-自动化安全策略-automation-policy)。
:::

### 2.3 完整定义自定义能力

厂商自定义能力（`{vendor}.*`）无标准定义可引用，须提供完整的 `description`、`states`、`commands`、`events`：

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

对于完整定义的能力，`states`、`commands`、`events` 均为必填字段，但允许为空对象 `{}`（例如纯传感器可以没有 commands）。

---

## 3. State / Command / Event 定义格式

### 3.1 State 定义

```jsonc
"states": {
  "on": {
    "type": "boolean",
    "description": "是否开启"
  },
  "brightness": {
    "type": "integer",
    "minimum": 0,
    "maximum": 100,
    "unit": "%",
    "description": "亮度百分比"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 是 | 值类型：`boolean`、`integer`、`number`、`string` |
| `description` | string | 是 | 状态说明（传入 LLM 上下文） |
| `minimum` / `maximum` | number | 否 | 数值约束 |
| `unit` | string | 否 | 物理单位（如 `"%"`、`"K"`、`"°C"`） |
| `enum` | array | 否 | 枚举值列表（type 为 string 时） |

### 3.2 Command 定义

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
| `description` | string | 是 | 命令说明（传入 LLM 上下文） |
| `params` | JSON Schema | 是 | 命令参数定义（[JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)） |
| `result` | JSON Schema | 否 | 成功回复的数据定义 |

::: warning 命令类型约束
- `state_cmd`：**必须**声明 `affects` 字段，即使为空数组 `[]`。
- `instant_cmd` / `once_cmd`：**禁止**声明 `affects` 字段。若命令会修改持久状态，应使用 `state_cmd`。
:::

::: tip 错误处理
命令执行失败时，设备从 [错误码规范](./error-codes.md) 定义的封闭枚举中选取错误码回复，不允许自定义错误码或附加自由文本。
:::

### 3.3 Event 定义

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

---

## 4. 完整示例

### 4.1 智能灯泡

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

  example-vendor.blink:              # 厂商自定义能力，须完整定义
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
```
:::

### 4.2 温湿度传感器

组合能力：`ohai.sensor.temperature` + `ohai.sensor.humidity` + `ohai.sensor.battery`

::: details 展开完整 schema.yaml
```yaml
$schema: https://ohai.dev/schema/v2/device-schema.json
schema_version: "2.0"
vendor: example-vendor
product: temp-humidity-sensor
firmware_version: "2.0.1"

capabilities:
  ohai.sensor.temperature: {}
  ohai.sensor.humidity: {}
  ohai.sensor.battery: {}
```
:::

### 4.3 智能门锁

组合能力：`ohai.lock` + `ohai.sensor.battery`

::: details 展开完整 schema.yaml
```yaml
$schema: https://ohai.dev/schema/v2/device-schema.json
schema_version: "2.0"
vendor: example-vendor
product: smart-door-lock
firmware_version: "3.1.0"

capabilities:
  ohai.lock: {}
  ohai.sensor.battery: {}
```
:::

### 4.4 智能喂食器

组合能力：`ohai.switch` + `petkit.feeder`（厂商自定义能力，使用 `once_cmd`）

::: details 展开完整 schema.yaml
```yaml
$schema: https://ohai.dev/schema/v2/device-schema.json
schema_version: "2.0"
vendor: petkit
product: smart-feeder-pro
firmware_version: "4.0.0"

capabilities:
  ohai.switch: {}

  petkit.feeder:
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

## 5. 校验规则与 Meta-Schema

### 5.1 Meta-Schema

Server 使用以下 JSON Schema 校验开发者提交的 `schema.json` 的结构合法性。`panel` 字段由 Adaptive Cards 校验器单独处理。

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
      "description": "部分覆盖标准能力的约束",
      "additionalProperties": false,
      "properties": {
        "states": {
          "type": "object",
          "description": "覆盖 states 的值约束（minimum、maximum、enum、unit）",
          "patternProperties": {
            "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/state_overrides" }
          },
          "additionalProperties": false
        },
        "commands": {
          "type": "object",
          "description": "覆盖 commands 的 ai_policy（仅允许单向升级）",
          "patternProperties": {
            "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/command_policy_overrides" }
          },
          "additionalProperties": false
        }
      }
    },

    "command_policy_overrides": {
      "type": "object",
      "description": "仅允许覆盖命令的自动化安全策略，不允许覆盖结构性字段",
      "additionalProperties": false,
      "properties": {
        "ai_policy": { "enum": ["allow", "confirm", "deny"] },
        "ai_policy_by_params": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["when", "policy"],
            "properties": {
              "when": { "type": "object" },
              "policy": { "enum": ["allow", "confirm", "deny"] }
            },
            "additionalProperties": false
          }
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
        "ai_policy": { "enum": ["allow", "confirm", "deny"] },
        "ai_policy_by_params": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["when", "policy"],
            "properties": {
              "when": { "type": "object" },
              "policy": { "enum": ["allow", "confirm", "deny"] }
            },
            "additionalProperties": false
          }
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

### 5.2 语义校验

Meta-Schema 仅校验结构合法性。Server 在设备注册时还须执行以下 **语义校验**：

1. `ohai.*` 键名的能力必须在标准能力库中存在（未知的标准能力键名拒绝注册）
2. `overrides` 中引用的 state 键名必须在对应标准能力的 `states` 中存在
3. `overrides` 的值约束必须是标准定义的子集（如标准定义 `maximum: 100`，override 只能 ≤ 100）
4. `overrides` 中的 `ai_policy` 覆盖必须严于或等于标准定义（`allow < confirm < deny`），不满足则拒绝注册
5. `overrides` 中引用的 command 键名必须在对应标准能力的 `commands` 中存在
6. 非 `ohai.*` 键名的能力必须提供完整定义（`description`、`states`、`commands`、`events`）
7. `affects` 中的每个值必须是同一 Capability 的 `states` 中已声明的键名
8. `reports` 中的每个值必须是同一 Capability 的 `states` 中已声明的键名
9. 若 `params` 中存在与 `affects` 指向的 state 同名的属性，其类型约束应与 state 定义兼容
10. 每个 State 应至少被一个 Command `affects` 或一个 Event `reports`（否则发出警告：孤立状态）
11. 若设备标记为 `security_critical: true`，其所有命令的 `cmd_type` 不得为 `instant_cmd`（安全关键操作必须有送达保证，QoS 0 不满足此要求）

### 5.3 校验时机

| 时机 | 校验内容 |
|---|---|
| **设备注册** | Meta-Schema 结构校验 + 语义校验 + Panel 校验（Adaptive Cards 语法 + 命令/状态绑定 + 禁止外部 URL） |
| **命令下发前** | AI 引擎生成的参数经对应命令的 `params` Schema 校验 |
| **回复接收时** | 设备回复的 `result` 经对应 Schema 校验；`error` 的 code/message 经 [错误码规范](./error-codes.md) 校验，不合法则丢弃并记录日志 |
| **事件接收时** | 事件负载经对应事件的 `params` Schema 校验，不合法则丢弃并记录日志 |

### 5.4 版本演进

- **向后兼容变更**：新增 Capability、State、Command、Event，直接添加即可
- **不兼容变更**：修改现有字段类型或约束、删除 Capability 或命令，须更新 `firmware_version` 并注册新 Schema
- 所有字段使用 `additionalProperties: false` 确保显式声明

---

## 6. JSON 与 YAML 双格式支持

开发者可选择使用 **JSON** 或 **YAML** 编写 Schema 文件：

| | JSON (`schema.json`) | YAML (`schema.yaml`) |
|---|---|---|
| **优势** | 工具链原生支持、与 JSON Schema 一致 | 支持注释、无括号嵌套、可读性更佳 |
| **适用场景** | AI 工具生成、程序化处理 | 人工编写、代码审查 |
| **注册时** | 直接提交 | 工具链自动转换为 JSON 后提交 |

两种格式语义等价。OHAI CLI 工具（`ohai schema validate`）同时支持两种格式的读写与校验。**Server 仅接受 JSON 格式注册**，YAML 在客户端侧转换。

::: tip 使用 AI 编写 Schema
OHAI 将提供专用的 Schema 编写 Skills（适用于 Claude Code / Cursor 等 AI 编辑器的技能插件）。开发者只需用自然语言描述设备功能，Skills 即可自动生成符合 Meta-Schema 规范的 `schema.yaml`，并执行本地校验。
:::
