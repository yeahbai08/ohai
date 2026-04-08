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
  "ai_policy": { /* 可选：AI 自动化安全策略 */ },
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
| `ai_policy` | object | 否 | AI 自动化安全策略声明（详见 [2.4 安全策略声明](#_2-4-安全策略声明)） |
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

Server 注册时检测到 `ohai.*` 键名，自动从标准库加载完整的 `states`、`commands`、`events` 定义，再将设备声明的内容作为补丁（patch）合并。

### 2.2 微调标准能力

设备引用标准能力后，可直接在能力对象中声明**覆盖**、**排除**和**扩展**，无需额外的包装层：

#### 覆盖已有字段的约束

```jsonc
{
  "capabilities": {
    "ohai.brightness": {
      "states": {
        "brightness": {
          "maximum": 50               // 此灯泡亮度仅支持到 50%，其余继承标准定义
        }
      }
    }
  }
}
```

对于标准定义中**已存在**的 state/command/event 名称，仅允许覆盖**值约束**（`minimum`、`maximum`、`enum`、`unit`），不允许修改结构性字段（`type`、`cmd_type`、`affects`、`reports`）。覆盖的约束值必须是标准定义的子集（如标准 `maximum: 100`，覆盖只能 ≤ 100）。

#### 排除不支持的字段

```jsonc
{
  "capabilities": {
    "ohai.cover": {
      "exclude": ["tilt", "set_tilt"]     // 此窗帘不支持叶片角度控制
    }
  }
}
```

`exclude` 数组中的名称必须在标准定义中存在。排除 state 后，所有引用该 state 的 `affects` 和 `reports` 关系必须仍然合法（即依赖被排除 state 的 command/event 也须一并排除），否则 Server 拒绝注册。

#### 扩展新字段

```jsonc
{
  "capabilities": {
    "ohai.fan": {
      "states": {
        "direction": {                    // 标准定义中不存在 → 视为扩展
          "type": "string",
          "enum": ["forward", "reverse"],
          "description": "风扇方向"
        }
      },
      "commands": {
        "set_direction": {
          "cmd_type": "state_cmd",
          "affects": ["direction"],
          "description": "设置风扇方向",
          "params": {
            "type": "object",
            "properties": {
              "direction": { "type": "string", "enum": ["forward", "reverse"] }
            },
            "required": ["direction"],
            "additionalProperties": false
          }
        }
      }
    }
  }
}
```

对于标准定义中**不存在**的名称，视为扩展，须提供完整定义（与自定义能力中的字段定义格式相同）。扩展的 `affects` 和 `reports` 可引用标准 states 或扩展 states。

#### 三者组合

```jsonc
{
  "capabilities": {
    "ohai.cover": {
      "exclude": ["tilt", "set_tilt"],
      "states": {
        "position": { "maximum": 90 },                    // 覆盖已有字段的约束
        "obstruction": {                                   // 扩展新 state
          "type": "boolean",
          "description": "是否检测到障碍物"
        }
      },
      "events": {
        "obstruction_detected": {                          // 扩展新 event
          "description": "检测到障碍物",
          "reports": ["obstruction"],
          "params": {
            "type": "object",
            "properties": { "obstruction": { "type": "boolean" } },
            "required": ["obstruction"],
            "additionalProperties": false
          }
        }
      }
    }
  }
}
```

最终生效的能力定义 = 标准定义 − exclude + 覆盖 + 扩展。Server 在注册时计算并存储完整的生效定义。

::: tip 区分覆盖与扩展
Server 通过名称是否存在于标准定义来自动区分：已有名称 → 覆盖（仅接受约束字段），新名称 → 扩展（需完整定义）。开发者无需显式声明哪种模式。
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

### 2.4 安全策略声明

`ai_policy` 是 Schema 的**顶层独立字段**，声明每条命令的 AI 自动化安全策略。它与能力定义结构分离，使安全策略能够根据设备的实际风险特征自由设定，而非受限于能力类型的预设假设。

```jsonc
{
  "ai_policy": {
    "ohai.lock:set_locked": [
      { "when": { "locked": true }, "policy": "allow" },
      { "when": { "locked": false }, "policy": "deny" }
    ],
    "ohai.switch:set_on": "allow",
    "example-vendor.blink:blink": "allow"
  }
}
```

键名格式为 `<capability>:<command>`。值支持两种形式：

| 形式 | 语法 | 说明 |
|---|---|---|
| 命令级 | `"allow"` / `"confirm"` / `"deny"` | 所有参数组合统一策略 |
| 参数级 | `[{when, policy}, ...]` | 按声明顺序首条命中生效 |

**默认值规则**：
- 引用标准能力（`ohai.*`）的命令，未在 `ai_policy` 中声明时，继承标准能力库中的默认策略
- 自定义能力（`{vendor}.*`）的命令，未声明时默认为 `allow`
- 参数级策略中未命中任何 `when` 条件时，回退到 `confirm`（安全默认——未被显式覆盖的参数组合需要用户确认）

**策略解析模型**：

```
effective_policy = user_config ?? device_schema ?? standard_default ?? "allow"
```

每层**完全替换**上一层（不再取 max），设备开发者可根据设备实际风险自由设定策略（既可加严也可放宽标准默认值），用户可在 Console App 中进一步调整。

详见 [设备能力模型 - AI 安全策略](./device-model.md#_3-ai-安全策略-ai-policy)。

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

组合能力：`ohai.lock` + `ohai.sensor.battery`，厂商将开锁策略升级为 `deny`

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

ai_policy:
  ohai.lock:set_locked:
    - when: { locked: true }
      policy: allow
    - when: { locked: false }
      policy: deny                       # 厂商将开锁从标准默认的 confirm 升级为 deny
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

ai_policy:
  petkit.feeder:dispense: confirm          # 喂食需要用户确认，防止重复投食
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
        "^ohai\\.[a-z][a-z0-9_.]*$": {
          "$ref": "#/$defs/standard_capability_patch"
        },
        "^[a-z][a-z0-9-]*\\.[a-z][a-z0-9_.]*$": {
          "$ref": "#/$defs/custom_capability"
        }
      },
      "additionalProperties": false
    },
    "ai_policy": {
      "type": "object",
      "description": "AI 自动化安全策略声明",
      "patternProperties": {
        "^[a-z][a-z0-9_.-]*:[a-z][a-z0-9_]*$": {
          "$ref": "#/$defs/ai_policy_value"
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
    "standard_capability_patch": {
      "type": "object",
      "description": "引用标准能力（ohai.* 键名），可选覆盖/排除/扩展",
      "properties": {
        "exclude": {
          "type": "array",
          "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
          "description": "从标准定义中排除的 states/commands/events 名称"
        },
        "states": {
          "type": "object",
          "description": "覆盖已有 state 的值约束，或扩展新 state",
          "patternProperties": {
            "^[a-z][a-z0-9_]*$": {
              "oneOf": [
                { "$ref": "#/$defs/state_overrides" },
                { "$ref": "#/$defs/state_definition" }
              ]
            }
          },
          "additionalProperties": false
        },
        "commands": {
          "type": "object",
          "description": "扩展新 command（标准 command 不可在此覆盖结构）",
          "patternProperties": {
            "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/command_definition" }
          },
          "additionalProperties": false
        },
        "events": {
          "type": "object",
          "description": "扩展新 event（标准 event 不可在此覆盖结构）",
          "patternProperties": {
            "^[a-z][a-z0-9_]*$": { "$ref": "#/$defs/event_definition" }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },

    "custom_capability": {
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
    },

    "ai_policy_value": {
      "oneOf": [
        {
          "enum": ["allow", "confirm", "deny"],
          "description": "命令级策略，所有参数组合统一"
        },
        {
          "type": "array",
          "description": "参数级策略，按声明顺序首条命中生效",
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
      ]
    },

    "state_overrides": {
      "type": "object",
      "description": "覆盖已有 state 的值约束（不含 type、description 等结构性字段）",
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
2. `ohai.*` 能力中，`states`/`commands`/`events` 下**已有名称**的字段仅接受值约束覆盖（`minimum`、`maximum`、`enum`、`unit`），不接受结构性字段
3. `ohai.*` 能力中，`states`/`commands`/`events` 下**新名称**的字段须提供完整定义
4. 覆盖的值约束必须是标准定义的子集（如标准定义 `maximum: 100`，覆盖只能 ≤ 100）
5. `exclude` 中的名称必须在对应标准能力中存在
6. 排除 state 后，所有引用该 state 的 `affects`/`reports` 关系必须仍然合法（依赖被排除 state 的 command/event 须一并排除），否则拒绝注册
7. 非 `ohai.*` 键名的能力必须提供完整定义（`description`、`states`、`commands`、`events`）
8. `affects` 中的每个值必须是同一 Capability 生效定义的 `states` 中已声明的键名（含标准 states 和扩展 states）
9. `reports` 中的每个值必须是同一 Capability 生效定义的 `states` 中已声明的键名
10. 若 `params` 中存在与 `affects` 指向的 state 同名的属性，其类型约束应与 state 定义兼容
11. 每个 State 应至少被一个 Command `affects` 或一个 Event `reports`（否则发出警告：孤立状态）
12. 若设备标记为 `security_critical: true`，其所有命令的 `cmd_type` 不得为 `instant_cmd`（安全关键操作必须有送达保证，QoS 0 不满足此要求）
13. `ai_policy` 中的键名 `<capability>:<command>` 必须引用 Schema 中存在的能力和命令

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
