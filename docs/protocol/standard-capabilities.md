# 标准能力库

本文档定义 OHAI 标准能力库（`ohai.*` 命名空间）的完整规范。标准能力库是中央注册表，设备 Schema 通过键名引用即可使用，无需重复编写内部定义。

关于如何在设备 Schema 中引用标准能力、如何使用 `overrides` 覆盖约束，详见 [设备能力模型 - 4.2 节](./capability-model.md#_4-2-capability-引用与定义)。

---

## 1. 设计原则

### 1.1 禁止自由文本（No Free Text）

OHAI 对设备所有消息中的字符串类型实施**严格约束**——Schema 中所有 `type: string` 的字段**必须**声明 `enum`，不允许开放式自由文本。

**原因**：设备消息最终会被 AI 引擎读取和处理。如果允许设备发送任意字符串，恶意或被攻破的设备可以通过状态上报、事件参数或命令回复向 AI 引擎注入提示词攻击（Prompt Injection）。封闭枚举确保 AI 引擎只收到预定义的、安全的标识符。

**规则**：
- States 中的 `type: string` 必须有 `enum`
- Command `params` 和 `result` 中的 `type: string` 必须有 `enum`
- Event `params` 中的 `type: string` 必须有 `enum`
- 错误码使用封闭枚举（详见 [错误码规范](./error-codes.md)）
- 时间戳由 Server 在消息接收时自动附加，设备**不应**在消息中传递时间戳字符串
- 人类可读的描述文本（设备名、房间名等）**不属于协议消息**，由 Server 和 Console App 管理

### 1.2 自动化安全策略（automation_policy）

OHAI 在**标准能力定义本身**中为每个命令声明自动化安全策略。这是能力 Schema 的一部分，由 OHAI 标准库定义，开发者和用户均无法绕过。

| 策略 | 含义 | 自动化行为 |
|---|---|---|
| `allow` | 常规操作（默认） | 自动化可直接执行 |
| `confirm` | 需要用户确认 | 自动化触发时暂停，推送确认请求到 Console App |
| `deny` | 禁止自动化执行 | Server 无条件拦截，只能由用户手动操作 |

当同一命令的不同参数值具有不同风险等级时，使用 `automation_policy_by_params` 进行**参数级策略声明**。`when` 使用 JSON Schema 子集语法匹配参数值，按声明顺序首条命中生效，未命中则回退到命令级 `automation_policy`（默认 `allow`）。

完整的策略执行机制（静态分析 + 运行时拦截）详见 [协议框架 - 自动化规则权限控制](./protocol-framework.md#_9-8-自动化规则权限控制)。

**设计原则**：
1. **标准能力定义安全下限**——本文档中的 `automation_policy` 设定每条命令的最低安全等级
2. **三层单向升级**——厂商通过 Schema `overrides` 和用户通过 Console App 设备设置可以将策略**升级**（`allow → confirm → deny`），但不能降级。详见 [协议框架 - 三层策略覆盖模型](./protocol-framework.md#_9-8-自动化规则权限控制)
3. **默认安全**——安全敏感的命令/参数组合默认标记为 `deny` 或 `confirm`
4. **用户手动操作不受限制**——`automation_policy` 仅约束自动化引擎

### 1.3 能力设计规范

- **单一职责**：每个能力聚焦于一个独立的功能维度（如开关、亮度、色温分别独立）
- **按需组合**：设备按需引用标准能力，无需实现全部；灯泡引用 `ohai.switch` + `ohai.brightness`，插座只引用 `ohai.switch`
- **命令幂等优先**：优先使用 `state_cmd` 设置绝对目标值，确保重复执行安全
- **`affects` 显式关联**：`state_cmd` 必须声明 `affects` 字段，将命令与状态显式绑定
- **`reports` 闭合回路**：事件通过 `reports` 声明携带的状态更新，Server 自动更新 Shadow

---

## 2. 能力分类索引

| 类别 | 能力 |
|---|---|
| [基础控制](#_3-基础控制) | `ohai.switch`、`ohai.button`、`ohai.child_lock` |
| [照明](#_4-照明) | `ohai.brightness`、`ohai.color_temperature`、`ohai.color`、`ohai.light_effect` |
| [环境控制](#_5-环境控制) | `ohai.thermostat`、`ohai.fan`、`ohai.humidity_control`、`ohai.air_purifier` |
| [安全与门禁](#_6-安全与门禁) | `ohai.lock`、`ohai.alarm`、`ohai.garage_door`、`ohai.doorbell`、`ohai.siren` |
| [遮蔽与开合](#_7-遮蔽与开合) | `ohai.cover`、`ohai.valve` |
| [媒体与音频](#_8-媒体与音频) | `ohai.media_player`、`ohai.volume`、`ohai.media_input` |
| [电力与能源](#_9-电力与能源) | `ohai.power_meter`、`ohai.energy_meter` |
| [传感器](#_10-传感器) | `ohai.sensor.temperature`、`ohai.sensor.humidity`、`ohai.sensor.illuminance`、`ohai.sensor.pressure`、`ohai.sensor.motion`、`ohai.sensor.occupancy`、`ohai.sensor.contact`、`ohai.sensor.smoke`、`ohai.sensor.co`、`ohai.sensor.water_leak`、`ohai.sensor.pm25`、`ohai.sensor.co2`、`ohai.sensor.tvoc`、`ohai.sensor.noise`、`ohai.sensor.battery`、`ohai.sensor.air_quality` |
| [家用电器](#_11-家用电器) | `ohai.robot_vacuum`、`ohai.washer`、`ohai.dryer`、`ohai.camera`、`ohai.irrigation` |

---

## 3. 基础控制

### `ohai.switch` — 开关

最基础的能力：控制设备的开关状态。

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `on` | boolean | 是否开启 | `power_state` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_on` | state_cmd | `[on]` | allow | 设置开关状态 |

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `physical_toggle` | `[on]` | 物理按键切换 |

::: details 展开完整定义
```yaml
ohai.switch:
  description: 开关控制
  states:
    on:
      type: boolean
      description: 是否开启
      semantic: power_state
  commands:
    set_on:
      cmd_type: state_cmd
      affects: [on]
      description: 设置开关状态
      automation_policy: allow
      params:
        type: object
        properties:
          on: { type: boolean }
        required: [on]
        additionalProperties: false
      result:
        type: object
        properties:
          on: { type: boolean }
        additionalProperties: false
  events:
    physical_toggle:
      description: 物理按键切换了开关
      reports: [on]
      params:
        type: object
        properties:
          on: { type: boolean }
        required: [on]
        additionalProperties: false
```
:::

---

### `ohai.button` — 无状态按钮

纯事件能力，适用于无线按钮、场景遥控器、墙壁贴片开关等无状态输入设备。与 `ohai.switch` 的本质区别：switch 是有状态的（开/关），button 是无状态的事件源（按了一下就触发一个事件，没有持久状态）。

**States**

无。

**Commands**

无。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `press` | — | 按钮被按下 |

事件参数 `action` 的枚举值覆盖主流交互方式。设备可通过 `overrides` 限制为实际支持的子集。

::: details 展开完整定义
```yaml
ohai.button:
  description: 无状态按钮
  states: {}
  commands: {}
  events:
    press:
      description: 按钮被按下
      params:
        type: object
        properties:
          action: { type: string, enum: [single, double, triple, long_press, long_press_release, hold] }
          index: { type: integer, minimum: 1, maximum: 10 }
        required: [action]
        additionalProperties: false
```
:::

`index` 字段用于多按键设备（如 4 键遥控器），标识是哪个按键触发了事件。单按键设备可省略此字段（默认为 1）。

---

### `ohai.child_lock` — 儿童锁

横切能力，适用于洗衣机、烤箱、空调、空气净化器等家用电器。独立于具体设备功能，任何需要防止儿童误操作的设备都可以组合此能力。

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `child_lock` | boolean | 儿童锁是否激活 | `child_lock_state` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_child_lock` | state_cmd | `[child_lock]` | 按参数区分 | 设置儿童锁状态 |

`automation_policy_by_params`：
- `child_lock: true`（开启儿童锁）→ `allow`：自动化可直接激活
- `child_lock: false`（解除儿童锁）→ `deny`：**禁止自动化解除**，只能由用户手动操作

**Events**

无。

::: details 展开完整定义
```yaml
ohai.child_lock:
  description: 儿童锁
  states:
    child_lock:
      type: boolean
      description: 儿童锁是否激活
      semantic: child_lock_state
  commands:
    set_child_lock:
      cmd_type: state_cmd
      affects: [child_lock]
      description: 设置儿童锁状态
      automation_policy_by_params:
        - when: { child_lock: true }
          policy: allow
        - when: { child_lock: false }
          policy: deny
      params:
        type: object
        properties:
          child_lock: { type: boolean }
        required: [child_lock]
        additionalProperties: false
      result:
        type: object
        properties:
          child_lock: { type: boolean }
        additionalProperties: false
  events: {}
```
:::

---

## 4. 照明

### `ohai.brightness` — 亮度控制

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `brightness` | integer | 0-100, unit: % | 亮度百分比 | `brightness_level` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_brightness` | state_cmd | `[brightness]` | allow | 设置亮度（绝对值） |

::: details 展开完整定义
```yaml
ohai.brightness:
  description: 亮度控制
  states:
    brightness:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 亮度百分比
      semantic: brightness_level
  commands:
    set_brightness:
      cmd_type: state_cmd
      affects: [brightness]
      description: 设置亮度（绝对值）
      automation_policy: allow
      params:
        type: object
        properties:
          brightness: { type: integer, minimum: 0, maximum: 100 }
        required: [brightness]
        additionalProperties: false
      result:
        type: object
        properties:
          brightness: { type: integer }
        additionalProperties: false
  events: {}
```
:::

---

### `ohai.color_temperature` — 色温控制

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `color_temp` | integer | 2700-6500, unit: K | 色温 | `color_temperature` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_color_temp` | state_cmd | `[color_temp]` | allow | 设置色温 |

::: details 展开完整定义
```yaml
ohai.color_temperature:
  description: 色温控制
  states:
    color_temp:
      type: integer
      minimum: 2700
      maximum: 6500
      unit: K
      description: 色温
      semantic: color_temperature
  commands:
    set_color_temp:
      cmd_type: state_cmd
      affects: [color_temp]
      description: 设置色温
      automation_policy: allow
      params:
        type: object
        properties:
          color_temp: { type: integer, minimum: 2700, maximum: 6500 }
        required: [color_temp]
        additionalProperties: false
      result:
        type: object
        properties:
          color_temp: { type: integer }
        additionalProperties: false
  events: {}
```
:::

---

### `ohai.color` — 颜色控制

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `hue` | integer | 0-360 | 色相 | `color_hue` |
| `saturation` | integer | 0-100, unit: % | 饱和度 | `color_saturation` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_color` | state_cmd | `[hue, saturation]` | allow | 设置颜色 |

::: details 展开完整定义
```yaml
ohai.color:
  description: 颜色控制（HSV 色相+饱和度，亮度由 ohai.brightness 控制）
  states:
    hue:
      type: integer
      minimum: 0
      maximum: 360
      description: 色相
      semantic: color_hue
    saturation:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 饱和度
      semantic: color_saturation
  commands:
    set_color:
      cmd_type: state_cmd
      affects: [hue, saturation]
      description: 设置颜色
      automation_policy: allow
      params:
        type: object
        properties:
          hue: { type: integer, minimum: 0, maximum: 360 }
          saturation: { type: integer, minimum: 0, maximum: 100 }
        required: [hue, saturation]
        additionalProperties: false
      result:
        type: object
        properties:
          hue: { type: integer }
          saturation: { type: integer }
        additionalProperties: false
  events: {}
```
:::

---

### `ohai.light_effect` — 灯光效果

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `effect` | string | enum | 当前灯光效果 | `light_effect` |

标准 `effect` 枚举值：`none`、`breathe`、`candle`、`rainbow`、`strobe`、`pulse`、`gradient`、`fireplace`、`aurora`。设备可通过 `overrides` 限制为实际支持的子集。

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_effect` | state_cmd | `[effect]` | allow | 设置灯光效果 |

::: details 展开完整定义
```yaml
ohai.light_effect:
  description: 灯光效果
  states:
    effect:
      type: string
      enum: [none, breathe, candle, rainbow, strobe, pulse, gradient, fireplace, aurora]
      description: 当前灯光效果
      semantic: light_effect
  commands:
    set_effect:
      cmd_type: state_cmd
      affects: [effect]
      description: 设置灯光效果
      automation_policy: allow
      params:
        type: object
        properties:
          effect: { type: string, enum: [none, breathe, candle, rainbow, strobe, pulse, gradient, fireplace, aurora] }
        required: [effect]
        additionalProperties: false
      result:
        type: object
        properties:
          effect: { type: string, enum: [none, breathe, candle, rainbow, strobe, pulse, gradient, fireplace, aurora] }
        additionalProperties: false
  events: {}
```
:::

---

## 5. 环境控制

### `ohai.thermostat` — 温控

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `target_temp` | number | unit: °C | 目标温度 | `temperature_setpoint` |
| `current_temp` | number | unit: °C | 当前温度（只读） | `temperature_reading` |
| `mode` | string | enum: heat, cool, auto, fan_only, dry, off | 工作模式 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_thermostat` | state_cmd | `[target_temp, mode]` | allow（极端温度 confirm） | 设置温控参数 |

`automation_policy_by_params`：当 `target_temp ≥ 35` 或 `target_temp ≤ 5` 时策略升级为 `confirm`，防止自动化设置极端温度（过高有烫伤风险，过低有冻管风险）。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `temperature_update` | `[current_temp]` | 温度变化上报 |

::: details 展开完整定义
```yaml
ohai.thermostat:
  description: 温控
  states:
    target_temp:
      type: number
      unit: "°C"
      description: 目标温度
      semantic: temperature_setpoint
    current_temp:
      type: number
      unit: "°C"
      description: 当前温度（只读）
      semantic: temperature_reading
    mode:
      type: string
      enum: [heat, cool, auto, fan_only, dry, off]
      description: 工作模式
  commands:
    set_thermostat:
      cmd_type: state_cmd
      affects: [target_temp, mode]
      description: 设置温控参数
      automation_policy: allow
      automation_policy_by_params:
        - when:
            target_temp: { minimum: 35 }
          policy: confirm
        - when:
            target_temp: { maximum: 5 }
          policy: confirm
      params:
        type: object
        properties:
          target_temp: { type: number }
          mode: { type: string, enum: [heat, cool, auto, fan_only, dry, off] }
        additionalProperties: false
      result:
        type: object
        properties:
          target_temp: { type: number }
          mode: { type: string, enum: [heat, cool, auto, fan_only, dry, off] }
        additionalProperties: false
  events:
    temperature_update:
      description: 温度变化上报
      reports: [current_temp]
      params:
        type: object
        properties:
          current_temp: { type: number }
        required: [current_temp]
        additionalProperties: false
```
:::

---

### `ohai.fan` — 风扇控制

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `speed` | integer | 0-100, unit: % | 风扇转速百分比（0 表示关闭） | `fan_speed` |
| `oscillating` | boolean | — | 是否摇头 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_speed` | state_cmd | `[speed]` | allow | 设置风扇转速 |
| `set_oscillating` | state_cmd | `[oscillating]` | allow | 设置摇头 |

::: details 展开完整定义
```yaml
ohai.fan:
  description: 风扇控制
  states:
    speed:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 风扇转速百分比（0 表示关闭）
      semantic: fan_speed
    oscillating:
      type: boolean
      description: 是否摇头
  commands:
    set_speed:
      cmd_type: state_cmd
      affects: [speed]
      description: 设置风扇转速
      automation_policy: allow
      params:
        type: object
        properties:
          speed: { type: integer, minimum: 0, maximum: 100 }
        required: [speed]
        additionalProperties: false
      result:
        type: object
        properties:
          speed: { type: integer }
        additionalProperties: false
    set_oscillating:
      cmd_type: state_cmd
      affects: [oscillating]
      description: 设置摇头
      automation_policy: allow
      params:
        type: object
        properties:
          oscillating: { type: boolean }
        required: [oscillating]
        additionalProperties: false
      result:
        type: object
        properties:
          oscillating: { type: boolean }
        additionalProperties: false
  events: {}
```
:::

---

### `ohai.humidity_control` — 湿度控制

适用于加湿器、除湿机等。

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `target_humidity` | integer | 0-100, unit: % | 目标湿度 | `humidity_setpoint` |
| `mode` | string | enum: humidify, dehumidify, auto, off | 工作模式 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_humidity_control` | state_cmd | `[target_humidity, mode]` | allow | 设置湿度控制参数 |

::: details 展开完整定义
```yaml
ohai.humidity_control:
  description: 湿度控制
  states:
    target_humidity:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 目标湿度
      semantic: humidity_setpoint
    mode:
      type: string
      enum: [humidify, dehumidify, auto, off]
      description: 工作模式
  commands:
    set_humidity_control:
      cmd_type: state_cmd
      affects: [target_humidity, mode]
      description: 设置湿度控制参数
      automation_policy: allow
      params:
        type: object
        properties:
          target_humidity: { type: integer, minimum: 0, maximum: 100 }
          mode: { type: string, enum: [humidify, dehumidify, auto, off] }
        additionalProperties: false
      result:
        type: object
        properties:
          target_humidity: { type: integer }
          mode: { type: string, enum: [humidify, dehumidify, auto, off] }
        additionalProperties: false
  events: {}
```
:::

---

### `ohai.air_purifier` — 空气净化

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `mode` | string | enum: auto, manual, sleep, turbo, off | 工作模式 | — |
| `fan_level` | integer | 1-10 | 风量等级 | — |
| `filter_life` | integer | 0-100, unit: % | 滤网剩余寿命 | `filter_life` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_mode` | state_cmd | `[mode]` | allow | 设置工作模式 |
| `set_fan_level` | state_cmd | `[fan_level]` | allow | 设置风量等级 |

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `filter_replace_needed` | `[filter_life]` | 滤网需要更换 |

::: details 展开完整定义
```yaml
ohai.air_purifier:
  description: 空气净化
  states:
    mode:
      type: string
      enum: [auto, manual, sleep, turbo, off]
      description: 工作模式
    fan_level:
      type: integer
      minimum: 1
      maximum: 10
      description: 风量等级
    filter_life:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 滤网剩余寿命
      semantic: filter_life
  commands:
    set_mode:
      cmd_type: state_cmd
      affects: [mode]
      description: 设置工作模式
      automation_policy: allow
      params:
        type: object
        properties:
          mode: { type: string, enum: [auto, manual, sleep, turbo, off] }
        required: [mode]
        additionalProperties: false
      result:
        type: object
        properties:
          mode: { type: string, enum: [auto, manual, sleep, turbo, off] }
        additionalProperties: false
    set_fan_level:
      cmd_type: state_cmd
      affects: [fan_level]
      description: 设置风量等级
      automation_policy: allow
      params:
        type: object
        properties:
          fan_level: { type: integer, minimum: 1, maximum: 10 }
        required: [fan_level]
        additionalProperties: false
      result:
        type: object
        properties:
          fan_level: { type: integer }
        additionalProperties: false
  events:
    filter_replace_needed:
      description: 滤网需要更换
      reports: [filter_life]
      params:
        type: object
        properties:
          filter_life: { type: integer }
        required: [filter_life]
        additionalProperties: false
```
:::

---

## 6. 安全与门禁

::: warning 自动化安全策略
本类别中的能力涉及人身安全和财产安全，其命令的 `automation_policy` 经过特别设计。解锁门锁、撤防报警、开启车库门等操作被标记为 `deny` 或 `confirm`，自动化引擎无法绕过。
:::

### `ohai.lock` — 门锁

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `locked` | boolean | 是否已锁定 | `lock_state` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_locked` | state_cmd | `[locked]` | 按参数区分 | 设置锁定状态 |

`automation_policy_by_params`：
- `locked: true`（锁门）→ `allow`：自动化可直接执行
- `locked: false`（开锁）→ `confirm`：自动化开锁需**用户确认**（厂商/用户可通过覆盖升级到 deny）

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `lock_changed` | `[locked]` | 锁状态变更（物理钥匙/指纹/密码等） |
| `tamper_alert` | — | 防撬告警 |

::: details 展开完整定义
```yaml
ohai.lock:
  description: 门锁控制
  states:
    locked:
      type: boolean
      description: 是否已锁定
      semantic: lock_state
  commands:
    set_locked:
      cmd_type: state_cmd
      affects: [locked]
      description: 设置锁定状态
      automation_policy_by_params:
        - when: { locked: true }
          policy: allow
        - when: { locked: false }
          policy: confirm
      params:
        type: object
        properties:
          locked: { type: boolean }
        required: [locked]
        additionalProperties: false
      result:
        type: object
        properties:
          locked: { type: boolean }
        additionalProperties: false
  events:
    lock_changed:
      description: 锁状态变更（物理钥匙/指纹/密码等）
      reports: [locked]
      params:
        type: object
        properties:
          locked: { type: boolean }
          method: { type: string, enum: [key, fingerprint, pin, app, auto, keypad, nfc] }
        required: [locked, method]
        additionalProperties: false
    tamper_alert:
      description: 防撬告警
      params:
        type: object
        properties: {}
        additionalProperties: false
```
:::

---

### `ohai.alarm` — 安防报警

适用于安防主机、报警面板等。

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `mode` | string | enum: disarmed, armed_home, armed_away, armed_night | 布防模式 | `alarm_mode` |
| `triggered` | boolean | — | 是否已触发报警 | `alarm_triggered` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_mode` | state_cmd | `[mode]` | 按参数区分 | 设置布防模式 |
| `dismiss_alarm` | state_cmd | `[triggered]` | deny | 解除触发状态 |

`set_mode` 的 `automation_policy_by_params`：
- `mode: disarmed`（撤防）→ `deny`：**禁止自动化撤防**
- 其他布防模式 → `allow`：自动化可布防（如离家自动布防）

`dismiss_alarm`：`deny`——报警解除**必须由用户手动操作**。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `alarm_triggered` | `[triggered]` | 报警被触发（传感器触发） |

::: details 展开完整定义
```yaml
ohai.alarm:
  description: 安防报警
  states:
    mode:
      type: string
      enum: [disarmed, armed_home, armed_away, armed_night]
      description: 布防模式
      semantic: alarm_mode
    triggered:
      type: boolean
      description: 是否已触发报警
      semantic: alarm_triggered
  commands:
    set_mode:
      cmd_type: state_cmd
      affects: [mode]
      description: 设置布防模式
      automation_policy_by_params:
        - when: { mode: disarmed }
          policy: deny
      params:
        type: object
        properties:
          mode: { type: string, enum: [disarmed, armed_home, armed_away, armed_night] }
        required: [mode]
        additionalProperties: false
      result:
        type: object
        properties:
          mode: { type: string, enum: [disarmed, armed_home, armed_away, armed_night] }
        additionalProperties: false
    dismiss_alarm:
      cmd_type: state_cmd
      affects: [triggered]
      description: 解除触发状态
      automation_policy: deny
      params:
        type: object
        properties:
          triggered: { type: boolean, const: false }
        required: [triggered]
        additionalProperties: false
      result:
        type: object
        properties:
          triggered: { type: boolean }
        additionalProperties: false
  events:
    alarm_triggered:
      description: 报警被触发
      reports: [triggered]
      params:
        type: object
        properties:
          triggered: { type: boolean }
        required: [triggered]
        additionalProperties: false
```
:::

---

### `ohai.garage_door` — 车库门

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `position` | integer | 0-100, unit: %（0=完全关闭, 100=完全打开） | 门位置 | `cover_position` |
| `moving` | boolean | — | 门是否正在移动 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_position` | state_cmd | `[position]` | 按参数区分 | 设置门位置 |
| `stop` | instant_cmd | — | allow | 紧急停止 |

`set_position` 的 `automation_policy_by_params`：
- `position: 0`（关门）→ `allow`：自动化可直接关门
- `position ≥ 1`（开门）→ `confirm`：自动化开门需用户确认

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `obstruction_detected` | — | 检测到障碍物 |
| `position_changed` | `[position, moving]` | 门位置变更 |

::: details 展开完整定义
```yaml
ohai.garage_door:
  description: 车库门
  states:
    position:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 门位置（0=完全关闭, 100=完全打开）
      semantic: cover_position
    moving:
      type: boolean
      description: 门是否正在移动
  commands:
    set_position:
      cmd_type: state_cmd
      affects: [position]
      description: 设置门位置
      automation_policy_by_params:
        - when: { position: 0 }
          policy: allow
        - when:
            position: { minimum: 1 }
          policy: confirm
      params:
        type: object
        properties:
          position: { type: integer, minimum: 0, maximum: 100 }
        required: [position]
        additionalProperties: false
      result:
        type: object
        properties:
          position: { type: integer }
        additionalProperties: false
    stop:
      cmd_type: instant_cmd
      description: 紧急停止门运动
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
  events:
    obstruction_detected:
      description: 检测到障碍物
      params:
        type: object
        properties: {}
        additionalProperties: false
    position_changed:
      description: 门位置变更
      reports: [position, moving]
      params:
        type: object
        properties:
          position: { type: integer }
          moving: { type: boolean }
        required: [position, moving]
        additionalProperties: false
```
:::

---

### `ohai.doorbell` — 门铃

纯事件能力，门铃按下时上报事件。视频门铃的摄像头功能通过 `ohai.camera` 组合实现。

**States**

无。

**Commands**

无。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `ring` | — | 门铃被按下 |

::: details 展开完整定义
```yaml
ohai.doorbell:
  description: 门铃
  states: {}
  commands: {}
  events:
    ring:
      description: 门铃被按下
      params:
        type: object
        properties: {}
        additionalProperties: false
```
:::

---

### `ohai.siren` — 警笛/蜂鸣器

声光报警执行器，适用于独立警笛、报警器蜂鸣模块等。与 `ohai.alarm`（安防面板/布撤防逻辑）不同，siren 是纯粹的声光输出设备。烟雾报警器可组合 `ohai.sensor.smoke` + `ohai.siren`。

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `active` | boolean | — | 警笛是否正在鸣响 | `siren_state` |
| `tone` | string | enum: alarm, fire, intruder, beep, chime | 鸣响音调 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_siren` | state_cmd | `[active, tone]` | allow | 控制警笛 |

`automation_policy: allow`——警笛触发是自动化的核心场景（烟雾传感器 → 触发警笛）。

**Events**

无。

::: details 展开完整定义
```yaml
ohai.siren:
  description: 警笛/蜂鸣器
  states:
    active:
      type: boolean
      description: 警笛是否正在鸣响
      semantic: siren_state
    tone:
      type: string
      enum: [alarm, fire, intruder, beep, chime]
      description: 鸣响音调
  commands:
    set_siren:
      cmd_type: state_cmd
      affects: [active, tone]
      description: 控制警笛
      automation_policy: allow
      params:
        type: object
        properties:
          active: { type: boolean }
          tone: { type: string, enum: [alarm, fire, intruder, beep, chime] }
        required: [active]
        additionalProperties: false
      result:
        type: object
        properties:
          active: { type: boolean }
          tone: { type: string, enum: [alarm, fire, intruder, beep, chime] }
        additionalProperties: false
  events: {}
```
:::

---

## 7. 遮蔽与开合

### `ohai.cover` — 窗帘/百叶窗/卷帘

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `position` | integer | 0-100, unit: %（0=完全关闭, 100=完全打开） | 遮蔽位置 | `cover_position` |
| `tilt` | integer | 0-100, unit: %（0=水平闭合, 100=垂直全开） | 叶片角度（百叶窗） | `cover_tilt` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_position` | state_cmd | `[position]` | allow | 设置遮蔽位置 |
| `set_tilt` | state_cmd | `[tilt]` | allow | 设置叶片角度 |
| `stop` | instant_cmd | — | allow | 停止运动 |

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `position_changed` | `[position]` | 位置变更（物理操作/遥控器） |

::: details 展开完整定义
```yaml
ohai.cover:
  description: 窗帘/百叶窗/卷帘
  states:
    position:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 遮蔽位置（0=完全关闭, 100=完全打开）
      semantic: cover_position
    tilt:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 叶片角度（0=水平闭合, 100=垂直全开）
      semantic: cover_tilt
  commands:
    set_position:
      cmd_type: state_cmd
      affects: [position]
      description: 设置遮蔽位置
      automation_policy: allow
      params:
        type: object
        properties:
          position: { type: integer, minimum: 0, maximum: 100 }
        required: [position]
        additionalProperties: false
      result:
        type: object
        properties:
          position: { type: integer }
        additionalProperties: false
    set_tilt:
      cmd_type: state_cmd
      affects: [tilt]
      description: 设置叶片角度
      automation_policy: allow
      params:
        type: object
        properties:
          tilt: { type: integer, minimum: 0, maximum: 100 }
        required: [tilt]
        additionalProperties: false
      result:
        type: object
        properties:
          tilt: { type: integer }
        additionalProperties: false
    stop:
      cmd_type: instant_cmd
      description: 停止运动
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
  events:
    position_changed:
      description: 位置变更（物理操作/遥控器）
      reports: [position]
      params:
        type: object
        properties:
          position: { type: integer }
        required: [position]
        additionalProperties: false
```
:::

---

### `ohai.valve` — 阀门控制

适用于水阀、灌溉阀等。燃气阀因安全等级极高，建议厂商定义独立的厂商能力（如 `{vendor}.gas_valve`）并将开启操作设为 `deny`。

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `open` | boolean | 阀门是否打开 | `valve_state` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_open` | state_cmd | `[open]` | 按参数区分 | 控制阀门开合 |

`automation_policy_by_params`：
- `open: true`（开阀）→ `confirm`：自动化开阀需用户确认（防止水漫金山）
- `open: false`（关阀）→ `allow`：自动化可直接关阀（紧急关断场景）

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `valve_changed` | `[open]` | 阀门状态变更 |

::: details 展开完整定义
```yaml
ohai.valve:
  description: 阀门控制
  states:
    open:
      type: boolean
      description: 阀门是否打开
      semantic: valve_state
  commands:
    set_open:
      cmd_type: state_cmd
      affects: [open]
      description: 控制阀门开合
      automation_policy_by_params:
        - when: { open: true }
          policy: confirm
        - when: { open: false }
          policy: allow
      params:
        type: object
        properties:
          open: { type: boolean }
        required: [open]
        additionalProperties: false
      result:
        type: object
        properties:
          open: { type: boolean }
        additionalProperties: false
  events:
    valve_changed:
      description: 阀门状态变更
      reports: [open]
      params:
        type: object
        properties:
          open: { type: boolean }
        required: [open]
        additionalProperties: false
```
:::

---

## 8. 媒体与音频

### `ohai.media_player` — 媒体播放控制

控制播放/暂停/切歌等。媒体元数据（歌曲名、专辑封面等）为自由文本，不属于协议消息范畴，由厂商通过 HTTP API 或 Panel 提供。

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `playback_state` | string | enum: playing, paused, stopped, idle | 播放状态 | `playback_state` |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `play` | instant_cmd | — | allow | 开始/恢复播放 |
| `pause` | instant_cmd | — | allow | 暂停播放 |
| `stop` | instant_cmd | — | allow | 停止播放 |
| `next_track` | instant_cmd | — | allow | 下一曲 |
| `previous_track` | instant_cmd | — | allow | 上一曲 |

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `playback_changed` | `[playback_state]` | 播放状态变更 |

::: details 展开完整定义
```yaml
ohai.media_player:
  description: 媒体播放控制
  states:
    playback_state:
      type: string
      enum: [playing, paused, stopped, idle]
      description: 播放状态
      semantic: playback_state
  commands:
    play:
      cmd_type: instant_cmd
      description: 开始或恢复播放
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    pause:
      cmd_type: instant_cmd
      description: 暂停播放
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    stop:
      cmd_type: instant_cmd
      description: 停止播放
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    next_track:
      cmd_type: instant_cmd
      description: 下一曲
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    previous_track:
      cmd_type: instant_cmd
      description: 上一曲
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
  events:
    playback_changed:
      description: 播放状态变更
      reports: [playback_state]
      params:
        type: object
        properties:
          playback_state: { type: string, enum: [playing, paused, stopped, idle] }
        required: [playback_state]
        additionalProperties: false
```
:::

---

### `ohai.volume` — 音量控制

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `volume` | integer | 0-100, unit: % | 音量百分比 | `volume_level` |
| `muted` | boolean | — | 是否静音 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_volume` | state_cmd | `[volume]` | allow | 设置音量 |
| `set_muted` | state_cmd | `[muted]` | allow | 设置静音 |

::: details 展开完整定义
```yaml
ohai.volume:
  description: 音量控制
  states:
    volume:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 音量百分比
      semantic: volume_level
    muted:
      type: boolean
      description: 是否静音
  commands:
    set_volume:
      cmd_type: state_cmd
      affects: [volume]
      description: 设置音量
      automation_policy: allow
      params:
        type: object
        properties:
          volume: { type: integer, minimum: 0, maximum: 100 }
        required: [volume]
        additionalProperties: false
      result:
        type: object
        properties:
          volume: { type: integer }
        additionalProperties: false
    set_muted:
      cmd_type: state_cmd
      affects: [muted]
      description: 设置静音
      automation_policy: allow
      params:
        type: object
        properties:
          muted: { type: boolean }
        required: [muted]
        additionalProperties: false
      result:
        type: object
        properties:
          muted: { type: boolean }
        additionalProperties: false
  events: {}
```
:::

---

### `ohai.media_input` — 输入源选择

适用于电视、AV 功放等。设备可通过 `overrides` 将 `source` 的 `enum` 限制为实际支持的输入源子集。

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `source` | string | enum（见下） | 当前输入源 | `media_source` |

标准 `source` 枚举值：`hdmi_1`、`hdmi_2`、`hdmi_3`、`hdmi_4`、`av_1`、`av_2`、`component`、`usb`、`bluetooth`、`wifi`、`airplay`、`optical`、`coaxial`、`line_in`、`fm`、`am`、`tv`。

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_source` | state_cmd | `[source]` | allow | 切换输入源 |

::: details 展开完整定义
```yaml
ohai.media_input:
  description: 输入源选择
  states:
    source:
      type: string
      enum: [hdmi_1, hdmi_2, hdmi_3, hdmi_4, av_1, av_2, component, usb, bluetooth, wifi, airplay, optical, coaxial, line_in, fm, am, tv]
      description: 当前输入源
      semantic: media_source
  commands:
    set_source:
      cmd_type: state_cmd
      affects: [source]
      description: 切换输入源
      automation_policy: allow
      params:
        type: object
        properties:
          source: { type: string, enum: [hdmi_1, hdmi_2, hdmi_3, hdmi_4, av_1, av_2, component, usb, bluetooth, wifi, airplay, optical, coaxial, line_in, fm, am, tv] }
        required: [source]
        additionalProperties: false
      result:
        type: object
        properties:
          source: { type: string, enum: [hdmi_1, hdmi_2, hdmi_3, hdmi_4, av_1, av_2, component, usb, bluetooth, wifi, airplay, optical, coaxial, line_in, fm, am, tv] }
        additionalProperties: false
  events: {}
```
:::

---

## 9. 电力与能源

### `ohai.power_meter` — 功率测量

只读能力，适用于智能插座、电力监测仪等。

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `power` | number | unit: W | 当前功率 | `power_reading` |
| `voltage` | number | unit: V | 当前电压 | `voltage_reading` |
| `current` | number | unit: A | 当前电流 | `current_reading` |

**Commands**

无。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `power_update` | `[power, voltage, current]` | 功率数据更新 |

::: details 展开完整定义
```yaml
ohai.power_meter:
  description: 功率测量
  states:
    power:
      type: number
      unit: W
      description: 当前功率
      semantic: power_reading
    voltage:
      type: number
      unit: V
      description: 当前电压
      semantic: voltage_reading
    current:
      type: number
      unit: A
      description: 当前电流
      semantic: current_reading
  commands: {}
  events:
    power_update:
      description: 功率数据更新
      reports: [power, voltage, current]
      params:
        type: object
        properties:
          power: { type: number }
          voltage: { type: number }
          current: { type: number }
        required: [power]
        additionalProperties: false
```
:::

---

### `ohai.energy_meter` — 能耗统计

累积能耗计量，适用于智能电表、智能插座等。

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `energy` | number | unit: kWh | 累计能耗 | `energy_reading` |

**Commands**

无。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `energy_update` | `[energy]` | 能耗数据更新 |

::: details 展开完整定义
```yaml
ohai.energy_meter:
  description: 能耗统计
  states:
    energy:
      type: number
      unit: kWh
      description: 累计能耗
      semantic: energy_reading
  commands: {}
  events:
    energy_update:
      description: 能耗数据更新
      reports: [energy]
      params:
        type: object
        properties:
          energy: { type: number }
        required: [energy]
        additionalProperties: false
```
:::

---

## 10. 传感器

传感器能力通常只有 States 和 Events，没有 Commands。所有传感器遵循统一命名模式：`ohai.sensor.<type>`。

### `ohai.sensor.temperature` — 温度传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `temperature` | number | unit: °C | `temperature_reading` |

| Events | reports | 说明 |
|---|---|---|
| `temperature_update` | `[temperature]` | 温度变化上报 |

---

### `ohai.sensor.humidity` — 湿度传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `humidity` | number | 0-100, unit: % | `humidity_reading` |

| Events | reports | 说明 |
|---|---|---|
| `humidity_update` | `[humidity]` | 湿度变化上报 |

---

### `ohai.sensor.illuminance` — 光照传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `illuminance` | number | unit: lx | `illuminance_reading` |

| Events | reports | 说明 |
|---|---|---|
| `illuminance_update` | `[illuminance]` | 光照变化上报 |

---

### `ohai.sensor.pressure` — 气压传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `pressure` | number | unit: hPa | `pressure_reading` |

| Events | reports | 说明 |
|---|---|---|
| `pressure_update` | `[pressure]` | 气压变化上报 |

---

### `ohai.sensor.motion` — 运动检测

| States | 类型 | semantic |
|---|---|---|
| `motion_detected` | boolean | `motion_detected` |

| Events | reports | 说明 |
|---|---|---|
| `motion_update` | `[motion_detected]` | 运动状态变更 |

---

### `ohai.sensor.occupancy` — 人员存在检测

与运动传感器不同，存在检测可以感知静止不动的人（如毫米波雷达）。

| States | 类型 | semantic |
|---|---|---|
| `occupied` | boolean | `occupancy` |

| Events | reports | 说明 |
|---|---|---|
| `occupancy_update` | `[occupied]` | 存在状态变更 |

---

### `ohai.sensor.contact` — 门窗开合

| States | 类型 | semantic |
|---|---|---|
| `contact` | boolean | `contact_state` |

| Events | reports | 说明 |
|---|---|---|
| `contact_changed` | `[contact]` | 开合状态变更 |

---

### `ohai.sensor.smoke` — 烟雾检测

| States | 类型 | semantic |
|---|---|---|
| `smoke_detected` | boolean | `smoke_detected` |

| Events | reports | 说明 |
|---|---|---|
| `smoke_update` | `[smoke_detected]` | 烟雾状态变更 |
| `smoke_alarm` | — | 烟雾报警（高优先级事件） |

---

### `ohai.sensor.co` — 一氧化碳检测

| States | 类型 | semantic |
|---|---|---|
| `co_detected` | boolean | `co_detected` |

| Events | reports | 说明 |
|---|---|---|
| `co_update` | `[co_detected]` | CO 检测状态变更 |
| `co_alarm` | — | CO 报警（高优先级事件） |

---

### `ohai.sensor.water_leak` — 漏水检测

| States | 类型 | semantic |
|---|---|---|
| `leak_detected` | boolean | `water_leak_detected` |

| Events | reports | 说明 |
|---|---|---|
| `leak_update` | `[leak_detected]` | 漏水状态变更 |

---

### `ohai.sensor.pm25` — PM2.5 传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `pm25` | number | unit: μg/m³ | `pm25_reading` |

| Events | reports | 说明 |
|---|---|---|
| `pm25_update` | `[pm25]` | PM2.5 数据更新 |

---

### `ohai.sensor.co2` — 二氧化碳传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `co2` | number | unit: ppm | `co2_reading` |

| Events | reports | 说明 |
|---|---|---|
| `co2_update` | `[co2]` | CO₂ 浓度更新 |

---

### `ohai.sensor.tvoc` — TVOC 传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `tvoc` | number | unit: μg/m³ | `tvoc_reading` |

| Events | reports | 说明 |
|---|---|---|
| `tvoc_update` | `[tvoc]` | TVOC 浓度更新 |

---

### `ohai.sensor.noise` — 噪声传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `noise_level` | number | unit: dB | `noise_level` |

| Events | reports | 说明 |
|---|---|---|
| `noise_update` | `[noise_level]` | 噪声数据更新 |

---

### `ohai.sensor.battery` — 电池电量

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `battery_level` | integer | 0-100, unit: % | `battery_level` |

| Events | reports | 说明 |
|---|---|---|
| `low_battery` | `[battery_level]` | 电量不足告警 |

---

### `ohai.sensor.air_quality` — 综合空气质量

综合空气质量指数。如果设备只有单一传感器（如仅 PM2.5），优先使用对应的专项传感器能力。

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `aqi` | integer | 0-500 | `air_quality_index` |
| `level` | string | enum: good, moderate, unhealthy_sensitive, unhealthy, very_unhealthy, hazardous | `air_quality_level` |

| Events | reports | 说明 |
|---|---|---|
| `aqi_update` | `[aqi, level]` | 空气质量更新 |

---

::: details 展开传感器系列完整定义
```yaml
ohai.sensor.temperature:
  description: 温度传感器
  states:
    temperature:
      type: number
      unit: "°C"
      description: 当前温度
      semantic: temperature_reading
  commands: {}
  events:
    temperature_update:
      description: 温度变化上报
      reports: [temperature]
      params:
        type: object
        properties:
          temperature: { type: number }
        required: [temperature]
        additionalProperties: false

ohai.sensor.humidity:
  description: 湿度传感器
  states:
    humidity:
      type: number
      minimum: 0
      maximum: 100
      unit: "%"
      description: 当前湿度
      semantic: humidity_reading
  commands: {}
  events:
    humidity_update:
      description: 湿度变化上报
      reports: [humidity]
      params:
        type: object
        properties:
          humidity: { type: number }
        required: [humidity]
        additionalProperties: false

ohai.sensor.illuminance:
  description: 光照传感器
  states:
    illuminance:
      type: number
      unit: lx
      description: 当前光照度
      semantic: illuminance_reading
  commands: {}
  events:
    illuminance_update:
      description: 光照变化上报
      reports: [illuminance]
      params:
        type: object
        properties:
          illuminance: { type: number }
        required: [illuminance]
        additionalProperties: false

ohai.sensor.pressure:
  description: 气压传感器
  states:
    pressure:
      type: number
      unit: hPa
      description: 当前气压
      semantic: pressure_reading
  commands: {}
  events:
    pressure_update:
      description: 气压变化上报
      reports: [pressure]
      params:
        type: object
        properties:
          pressure: { type: number }
        required: [pressure]
        additionalProperties: false

ohai.sensor.motion:
  description: 运动检测传感器
  states:
    motion_detected:
      type: boolean
      description: 是否检测到运动
      semantic: motion_detected
  commands: {}
  events:
    motion_update:
      description: 运动状态变更
      reports: [motion_detected]
      params:
        type: object
        properties:
          motion_detected: { type: boolean }
        required: [motion_detected]
        additionalProperties: false

ohai.sensor.occupancy:
  description: 人员存在检测
  states:
    occupied:
      type: boolean
      description: 是否有人存在
      semantic: occupancy
  commands: {}
  events:
    occupancy_update:
      description: 存在状态变更
      reports: [occupied]
      params:
        type: object
        properties:
          occupied: { type: boolean }
        required: [occupied]
        additionalProperties: false

ohai.sensor.contact:
  description: 门窗开合传感器
  states:
    contact:
      type: boolean
      description: 门窗是否闭合
      semantic: contact_state
  commands: {}
  events:
    contact_changed:
      description: 开合状态变更
      reports: [contact]
      params:
        type: object
        properties:
          contact: { type: boolean }
        required: [contact]
        additionalProperties: false

ohai.sensor.smoke:
  description: 烟雾检测传感器
  states:
    smoke_detected:
      type: boolean
      description: 是否检测到烟雾
      semantic: smoke_detected
  commands: {}
  events:
    smoke_update:
      description: 烟雾状态变更
      reports: [smoke_detected]
      params:
        type: object
        properties:
          smoke_detected: { type: boolean }
        required: [smoke_detected]
        additionalProperties: false
    smoke_alarm:
      description: 烟雾报警
      params:
        type: object
        properties: {}
        additionalProperties: false

ohai.sensor.co:
  description: 一氧化碳检测传感器
  states:
    co_detected:
      type: boolean
      description: 是否检测到一氧化碳
      semantic: co_detected
  commands: {}
  events:
    co_update:
      description: CO 检测状态变更
      reports: [co_detected]
      params:
        type: object
        properties:
          co_detected: { type: boolean }
        required: [co_detected]
        additionalProperties: false
    co_alarm:
      description: CO 报警
      params:
        type: object
        properties: {}
        additionalProperties: false

ohai.sensor.water_leak:
  description: 漏水检测传感器
  states:
    leak_detected:
      type: boolean
      description: 是否检测到漏水
      semantic: water_leak_detected
  commands: {}
  events:
    leak_update:
      description: 漏水状态变更
      reports: [leak_detected]
      params:
        type: object
        properties:
          leak_detected: { type: boolean }
        required: [leak_detected]
        additionalProperties: false

ohai.sensor.pm25:
  description: PM2.5 传感器
  states:
    pm25:
      type: number
      unit: "μg/m³"
      description: PM2.5 浓度
      semantic: pm25_reading
  commands: {}
  events:
    pm25_update:
      description: PM2.5 数据更新
      reports: [pm25]
      params:
        type: object
        properties:
          pm25: { type: number }
        required: [pm25]
        additionalProperties: false

ohai.sensor.co2:
  description: 二氧化碳传感器
  states:
    co2:
      type: number
      unit: ppm
      description: CO₂ 浓度
      semantic: co2_reading
  commands: {}
  events:
    co2_update:
      description: CO₂ 浓度更新
      reports: [co2]
      params:
        type: object
        properties:
          co2: { type: number }
        required: [co2]
        additionalProperties: false

ohai.sensor.tvoc:
  description: TVOC 传感器
  states:
    tvoc:
      type: number
      unit: "μg/m³"
      description: TVOC 浓度
      semantic: tvoc_reading
  commands: {}
  events:
    tvoc_update:
      description: TVOC 浓度更新
      reports: [tvoc]
      params:
        type: object
        properties:
          tvoc: { type: number }
        required: [tvoc]
        additionalProperties: false

ohai.sensor.noise:
  description: 噪声传感器
  states:
    noise_level:
      type: number
      unit: dB
      description: 噪声等级
      semantic: noise_level
  commands: {}
  events:
    noise_update:
      description: 噪声数据更新
      reports: [noise_level]
      params:
        type: object
        properties:
          noise_level: { type: number }
        required: [noise_level]
        additionalProperties: false

ohai.sensor.battery:
  description: 电池电量
  states:
    battery_level:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 电池电量百分比
      semantic: battery_level
  commands: {}
  events:
    low_battery:
      description: 电量不足告警
      reports: [battery_level]
      params:
        type: object
        properties:
          battery_level: { type: integer }
        required: [battery_level]
        additionalProperties: false

ohai.sensor.air_quality:
  description: 综合空气质量
  states:
    aqi:
      type: integer
      minimum: 0
      maximum: 500
      description: 空气质量指数
      semantic: air_quality_index
    level:
      type: string
      enum: [good, moderate, unhealthy_sensitive, unhealthy, very_unhealthy, hazardous]
      description: 空气质量等级
      semantic: air_quality_level
  commands: {}
  events:
    aqi_update:
      description: 空气质量更新
      reports: [aqi, level]
      params:
        type: object
        properties:
          aqi: { type: integer }
          level: { type: string, enum: [good, moderate, unhealthy_sensitive, unhealthy, very_unhealthy, hazardous] }
        required: [aqi, level]
        additionalProperties: false
```
:::

---

## 11. 家用电器

### `ohai.robot_vacuum` — 扫地机器人

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `status` | string | enum: idle, cleaning, paused, returning, charging, docked, error | 工作状态 | `device_status` |
| `clean_mode` | string | enum: auto, spot, edge, quiet, turbo, mop | 清扫模式 | — |

电池电量通过组合 `ohai.sensor.battery` 实现。

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `start_clean` | once_cmd | — | allow | 开始清扫 |
| `pause` | instant_cmd | — | allow | 暂停清扫 |
| `resume` | instant_cmd | — | allow | 恢复清扫 |
| `return_home` | instant_cmd | — | allow | 返回充电座 |
| `set_clean_mode` | state_cmd | `[clean_mode]` | allow | 设置清扫模式 |

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `status_changed` | `[status]` | 工作状态变更 |
| `clean_complete` | `[status]` | 清扫完成 |
| `stuck` | — | 机器被卡住 |
| `dustbin_full` | — | 尘盒已满 |

::: details 展开完整定义
```yaml
ohai.robot_vacuum:
  description: 扫地机器人
  states:
    status:
      type: string
      enum: [idle, cleaning, paused, returning, charging, docked, error]
      description: 工作状态
      semantic: device_status
    clean_mode:
      type: string
      enum: [auto, spot, edge, quiet, turbo, mop]
      description: 清扫模式
  commands:
    start_clean:
      cmd_type: once_cmd
      description: 开始清扫
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
      result:
        type: object
        properties: {}
        additionalProperties: false
    pause:
      cmd_type: instant_cmd
      description: 暂停清扫
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    resume:
      cmd_type: instant_cmd
      description: 恢复清扫
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    return_home:
      cmd_type: instant_cmd
      description: 返回充电座
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    set_clean_mode:
      cmd_type: state_cmd
      affects: [clean_mode]
      description: 设置清扫模式
      automation_policy: allow
      params:
        type: object
        properties:
          clean_mode: { type: string, enum: [auto, spot, edge, quiet, turbo, mop] }
        required: [clean_mode]
        additionalProperties: false
      result:
        type: object
        properties:
          clean_mode: { type: string, enum: [auto, spot, edge, quiet, turbo, mop] }
        additionalProperties: false
  events:
    status_changed:
      description: 工作状态变更
      reports: [status]
      params:
        type: object
        properties:
          status: { type: string, enum: [idle, cleaning, paused, returning, charging, docked, error] }
        required: [status]
        additionalProperties: false
    clean_complete:
      description: 清扫完成
      reports: [status]
      params:
        type: object
        properties:
          status: { type: string, enum: [idle, cleaning, paused, returning, charging, docked, error] }
        required: [status]
        additionalProperties: false
    stuck:
      description: 机器被卡住
      params:
        type: object
        properties: {}
        additionalProperties: false
    dustbin_full:
      description: 尘盒已满
      params:
        type: object
        properties: {}
        additionalProperties: false
```
:::

---

### `ohai.washer` — 洗衣机

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `status` | string | enum: idle, running, paused, complete, error | 工作状态 | `device_status` |
| `program` | string | enum: cotton, synthetic, delicate, wool, quick, heavy, eco, rinse, spin | 洗涤程序 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `start_wash` | once_cmd | — | allow | 开始洗涤 |
| `pause` | instant_cmd | — | allow | 暂停 |
| `resume` | instant_cmd | — | allow | 恢复 |
| `cancel` | instant_cmd | — | allow | 取消当前程序 |
| `set_program` | state_cmd | `[program]` | allow | 设置洗涤程序 |

`start_wash`：`automation_policy: allow`——定时洗涤是常见自动化场景，设备安全由硬件联锁机制保障。用户可通过设备设置升级策略。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `cycle_complete` | `[status]` | 洗涤完成 |
| `error_occurred` | `[status]` | 发生错误 |

::: details 展开完整定义
```yaml
ohai.washer:
  description: 洗衣机
  states:
    status:
      type: string
      enum: [idle, running, paused, complete, error]
      description: 工作状态
      semantic: device_status
    program:
      type: string
      enum: [cotton, synthetic, delicate, wool, quick, heavy, eco, rinse, spin]
      description: 洗涤程序
  commands:
    start_wash:
      cmd_type: once_cmd
      description: 开始洗涤
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
      result:
        type: object
        properties: {}
        additionalProperties: false
    pause:
      cmd_type: instant_cmd
      description: 暂停
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    resume:
      cmd_type: instant_cmd
      description: 恢复
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    cancel:
      cmd_type: instant_cmd
      description: 取消当前程序
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    set_program:
      cmd_type: state_cmd
      affects: [program]
      description: 设置洗涤程序
      automation_policy: allow
      params:
        type: object
        properties:
          program: { type: string, enum: [cotton, synthetic, delicate, wool, quick, heavy, eco, rinse, spin] }
        required: [program]
        additionalProperties: false
      result:
        type: object
        properties:
          program: { type: string, enum: [cotton, synthetic, delicate, wool, quick, heavy, eco, rinse, spin] }
        additionalProperties: false
  events:
    cycle_complete:
      description: 洗涤完成
      reports: [status]
      params:
        type: object
        properties:
          status: { type: string, enum: [idle, running, paused, complete, error] }
        required: [status]
        additionalProperties: false
    error_occurred:
      description: 发生错误
      reports: [status]
      params:
        type: object
        properties:
          status: { type: string, enum: [idle, running, paused, complete, error] }
        required: [status]
        additionalProperties: false
```
:::

---

### `ohai.dryer` — 干衣机

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `status` | string | enum: idle, running, paused, cooling, complete, error | 工作状态 | `device_status` |
| `program` | string | enum: cotton, synthetic, delicate, wool, quick, heavy, air_dry, iron_dry, cupboard_dry | 烘干程序 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `start_dry` | once_cmd | — | allow | 开始烘干 |
| `pause` | instant_cmd | — | allow | 暂停 |
| `resume` | instant_cmd | — | allow | 恢复 |
| `cancel` | instant_cmd | — | allow | 取消当前程序 |
| `set_program` | state_cmd | `[program]` | allow | 设置烘干程序 |

`start_dry`：`automation_policy: allow`——定时烘干是常见自动化场景，设备安全由硬件联锁机制保障。用户可通过设备设置升级策略。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `cycle_complete` | `[status]` | 烘干完成 |
| `error_occurred` | `[status]` | 发生错误 |
| `lint_filter_full` | — | 绒毛滤网堵塞 |

::: details 展开完整定义
```yaml
ohai.dryer:
  description: 干衣机
  states:
    status:
      type: string
      enum: [idle, running, paused, cooling, complete, error]
      description: 工作状态
      semantic: device_status
    program:
      type: string
      enum: [cotton, synthetic, delicate, wool, quick, heavy, air_dry, iron_dry, cupboard_dry]
      description: 烘干程序
  commands:
    start_dry:
      cmd_type: once_cmd
      description: 开始烘干
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
      result:
        type: object
        properties: {}
        additionalProperties: false
    pause:
      cmd_type: instant_cmd
      description: 暂停
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    resume:
      cmd_type: instant_cmd
      description: 恢复
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    cancel:
      cmd_type: instant_cmd
      description: 取消当前程序
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
    set_program:
      cmd_type: state_cmd
      affects: [program]
      description: 设置烘干程序
      automation_policy: allow
      params:
        type: object
        properties:
          program: { type: string, enum: [cotton, synthetic, delicate, wool, quick, heavy, air_dry, iron_dry, cupboard_dry] }
        required: [program]
        additionalProperties: false
      result:
        type: object
        properties:
          program: { type: string, enum: [cotton, synthetic, delicate, wool, quick, heavy, air_dry, iron_dry, cupboard_dry] }
        additionalProperties: false
  events:
    cycle_complete:
      description: 烘干完成
      reports: [status]
      params:
        type: object
        properties:
          status: { type: string, enum: [idle, running, paused, cooling, complete, error] }
        required: [status]
        additionalProperties: false
    error_occurred:
      description: 发生错误
      reports: [status]
      params:
        type: object
        properties:
          status: { type: string, enum: [idle, running, paused, cooling, complete, error] }
        required: [status]
        additionalProperties: false
    lint_filter_full:
      description: 绒毛滤网堵塞
      params:
        type: object
        properties: {}
        additionalProperties: false
```
:::

---

### `ohai.camera` — 摄像头

基础摄像头控制。图像/视频数据通过带外通道（HTTP/RTSP）传输，不走 MQTT 协议消息。视频门铃通过组合 `ohai.camera` + `ohai.doorbell` 实现。

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `privacy_mode` | boolean | 隐私模式（镜头遮蔽/关闭） | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `set_privacy_mode` | state_cmd | `[privacy_mode]` | allow | 设置隐私模式 |
| `take_snapshot` | once_cmd | — | confirm | 拍摄快照 |

`take_snapshot`：`automation_policy: confirm`——涉及隐私，自动化拍照需用户确认。

**Events**

无。

::: details 展开完整定义
```yaml
ohai.camera:
  description: 摄像头基础控制
  states:
    privacy_mode:
      type: boolean
      description: 隐私模式（镜头遮蔽/关闭）
  commands:
    set_privacy_mode:
      cmd_type: state_cmd
      affects: [privacy_mode]
      description: 设置隐私模式
      automation_policy: allow
      params:
        type: object
        properties:
          privacy_mode: { type: boolean }
        required: [privacy_mode]
        additionalProperties: false
      result:
        type: object
        properties:
          privacy_mode: { type: boolean }
        additionalProperties: false
    take_snapshot:
      cmd_type: once_cmd
      description: 拍摄快照
      automation_policy: confirm
      params:
        type: object
        properties: {}
        additionalProperties: false
      result:
        type: object
        properties: {}
        additionalProperties: false
  events: {}
```
:::

---

### `ohai.irrigation` — 灌溉控制

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `active` | boolean | 灌溉是否进行中 | — |

**Commands**

| 键名 | 类型 | affects | automation_policy | 说明 |
|---|---|---|---|---|
| `start_irrigation` | once_cmd | — | allow | 开始灌溉 |
| `stop_irrigation` | instant_cmd | — | allow | 停止灌溉 |

`start_irrigation`：`automation_policy: allow`——灌溉自动化是核心使用场景（定时浇灌、土壤湿度触发等）。

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `irrigation_complete` | `[active]` | 灌溉完成 |
| `flow_anomaly` | — | 流量异常（可能漏水或堵塞） |

::: details 展开完整定义
```yaml
ohai.irrigation:
  description: 灌溉控制
  states:
    active:
      type: boolean
      description: 灌溉是否进行中
  commands:
    start_irrigation:
      cmd_type: once_cmd
      description: 开始灌溉
      automation_policy: allow
      params:
        type: object
        properties:
          duration_minutes: { type: integer, minimum: 1, maximum: 120 }
        required: [duration_minutes]
        additionalProperties: false
      result:
        type: object
        properties: {}
        additionalProperties: false
    stop_irrigation:
      cmd_type: instant_cmd
      description: 停止灌溉
      automation_policy: allow
      params:
        type: object
        properties: {}
        additionalProperties: false
  events:
    irrigation_complete:
      description: 灌溉完成
      reports: [active]
      params:
        type: object
        properties:
          active: { type: boolean }
        required: [active]
        additionalProperties: false
    flow_anomaly:
      description: 流量异常（可能漏水或堵塞）
      params:
        type: object
        properties: {}
        additionalProperties: false
```
:::

---

## 附录 A：语义标签完整列表

| 标签 | 含义 | 典型类型 | 使用能力 |
|---|---|---|---|
| `power_state` | 电源开关状态 | boolean | `ohai.switch` |
| `brightness_level` | 亮度等级 | integer (0-100) | `ohai.brightness` |
| `color_temperature` | 色温 | integer (K) | `ohai.color_temperature` |
| `color_hue` | 色相 | integer (0-360) | `ohai.color` |
| `color_saturation` | 饱和度 | integer (0-100) | `ohai.color` |
| `light_effect` | 灯光效果 | string (enum) | `ohai.light_effect` |
| `temperature_setpoint` | 温度设定值 | number (°C) | `ohai.thermostat` |
| `temperature_reading` | 温度读数 | number (°C) | `ohai.thermostat`, `ohai.sensor.temperature` |
| `humidity_setpoint` | 湿度设定值 | integer (%) | `ohai.humidity_control` |
| `humidity_reading` | 湿度读数 | number (%) | `ohai.sensor.humidity` |
| `fan_speed` | 风扇转速 | integer (%) | `ohai.fan` |
| `filter_life` | 滤网寿命 | integer (%) | `ohai.air_purifier` |
| `lock_state` | 门锁状态 | boolean | `ohai.lock` |
| `alarm_mode` | 报警布防模式 | string (enum) | `ohai.alarm` |
| `alarm_triggered` | 报警触发状态 | boolean | `ohai.alarm` |
| `cover_position` | 遮蔽/门位置 | integer (%) | `ohai.cover`, `ohai.garage_door` |
| `cover_tilt` | 遮蔽叶片角度 | integer (%) | `ohai.cover` |
| `valve_state` | 阀门开合状态 | boolean | `ohai.valve` |
| `playback_state` | 播放状态 | string (enum) | `ohai.media_player` |
| `volume_level` | 音量等级 | integer (%) | `ohai.volume` |
| `media_source` | 媒体输入源 | string (enum) | `ohai.media_input` |
| `power_reading` | 功率读数 | number (W) | `ohai.power_meter` |
| `voltage_reading` | 电压读数 | number (V) | `ohai.power_meter` |
| `current_reading` | 电流读数 | number (A) | `ohai.power_meter` |
| `energy_reading` | 能耗读数 | number (kWh) | `ohai.energy_meter` |
| `motion_detected` | 运动检测状态 | boolean | `ohai.sensor.motion` |
| `occupancy` | 人员存在状态 | boolean | `ohai.sensor.occupancy` |
| `contact_state` | 门窗开合状态 | boolean | `ohai.sensor.contact` |
| `smoke_detected` | 烟雾检测状态 | boolean | `ohai.sensor.smoke` |
| `co_detected` | CO 检测状态 | boolean | `ohai.sensor.co` |
| `water_leak_detected` | 漏水检测状态 | boolean | `ohai.sensor.water_leak` |
| `battery_level` | 电池电量 | integer (%) | `ohai.sensor.battery` |
| `illuminance_reading` | 光照度读数 | number (lx) | `ohai.sensor.illuminance` |
| `pressure_reading` | 气压读数 | number (hPa) | `ohai.sensor.pressure` |
| `pm25_reading` | PM2.5 读数 | number (μg/m³) | `ohai.sensor.pm25` |
| `co2_reading` | CO₂ 读数 | number (ppm) | `ohai.sensor.co2` |
| `tvoc_reading` | TVOC 读数 | number (μg/m³) | `ohai.sensor.tvoc` |
| `noise_level` | 噪声等级 | number (dB) | `ohai.sensor.noise` |
| `air_quality_index` | 空气质量指数 | integer (0-500) | `ohai.sensor.air_quality` |
| `air_quality_level` | 空气质量等级 | string (enum) | `ohai.sensor.air_quality` |
| `device_status` | 设备工作状态 | string (enum) | `ohai.robot_vacuum`、`ohai.washer`、`ohai.dryer` |
| `child_lock_state` | 儿童锁状态 | boolean | `ohai.child_lock` |
| `siren_state` | 警笛状态 | boolean | `ohai.siren` |

---

## 附录 B：automation_policy 速查表

以下列出所有标准能力中**非默认（非 allow）** 的自动化安全策略：

| 能力 | 命令 | 参数条件 | 策略 | 原因 |
|---|---|---|---|---|
| `ohai.lock` | `set_locked` | `locked: true` | allow | 锁门安全 |
| `ohai.lock` | `set_locked` | `locked: false` | **confirm** | 自动化开锁需确认（厂商/用户可升级到 deny） |
| `ohai.alarm` | `set_mode` | `mode: disarmed` | **deny** | 禁止自动化撤防 |
| `ohai.alarm` | `set_mode` | 其他模式 | allow | 自动化可布防 |
| `ohai.alarm` | `dismiss_alarm` | — | **deny** | 报警解除必须手动 |
| `ohai.garage_door` | `set_position` | `position: 0` | allow | 关门安全 |
| `ohai.garage_door` | `set_position` | `position ≥ 1` | **confirm** | 开门需确认 |
| `ohai.valve` | `set_open` | `open: true` | **confirm** | 开阀需确认（防水害） |
| `ohai.valve` | `set_open` | `open: false` | allow | 关阀安全（紧急关断） |
| `ohai.thermostat` | `set_thermostat` | `target_temp ≥ 35` | **confirm** | 极端高温需确认 |
| `ohai.thermostat` | `set_thermostat` | `target_temp ≤ 5` | **confirm** | 极端低温需确认（冻管风险） |
| `ohai.camera` | `take_snapshot` | — | **confirm** | 涉及隐私 |
| `ohai.child_lock` | `set_child_lock` | `child_lock: true` | allow | 激活儿童锁安全 |
| `ohai.child_lock` | `set_child_lock` | `child_lock: false` | **deny** | 禁止自动化解除儿童锁 |

所有其他命令的默认策略为 `allow`。

---

## 附录 C：标准能力与设备类型映射

以下展示常见设备类型如何通过组合标准能力实现。开发者只需在 Schema 的 `capabilities` 中按键名引用。

| 设备类型 | 组合能力 |
|---|---|
| 智能灯泡（基础） | `ohai.switch` |
| 智能灯泡（调光） | `ohai.switch` + `ohai.brightness` |
| 智能灯泡（调光调色温） | `ohai.switch` + `ohai.brightness` + `ohai.color_temperature` |
| 智能灯泡（全彩） | `ohai.switch` + `ohai.brightness` + `ohai.color_temperature` + `ohai.color` + `ohai.light_effect` |
| 智能插座 | `ohai.switch` + `ohai.power_meter` + `ohai.energy_meter` |
| 智能插座（基础） | `ohai.switch` |
| 温湿度传感器 | `ohai.sensor.temperature` + `ohai.sensor.humidity` + `ohai.sensor.battery` |
| 空气质量检测仪 | `ohai.sensor.pm25` + `ohai.sensor.co2` + `ohai.sensor.tvoc` + `ohai.sensor.temperature` + `ohai.sensor.humidity` |
| 运动传感器 | `ohai.sensor.motion` + `ohai.sensor.battery` |
| 门窗传感器 | `ohai.sensor.contact` + `ohai.sensor.battery` |
| 烟雾报警器 | `ohai.sensor.smoke` + `ohai.siren` + `ohai.sensor.battery` |
| CO 报警器 | `ohai.sensor.co` + `ohai.siren` + `ohai.sensor.battery` |
| 漏水传感器 | `ohai.sensor.water_leak` + `ohai.sensor.battery` |
| 智能门锁 | `ohai.lock` + `ohai.sensor.battery` |
| 安防主机 | `ohai.alarm` + `ohai.siren` |
| 车库门控制器 | `ohai.garage_door` |
| 视频门铃 | `ohai.doorbell` + `ohai.camera` + `ohai.sensor.motion` |
| 智能窗帘 | `ohai.cover` |
| 智能百叶窗 | `ohai.cover`（使用 `tilt` 状态） |
| 空调 | `ohai.switch` + `ohai.thermostat` + `ohai.fan` |
| 电暖器 | `ohai.switch` + `ohai.thermostat` |
| 风扇 | `ohai.switch` + `ohai.fan` |
| 加湿器 | `ohai.switch` + `ohai.humidity_control` + `ohai.sensor.humidity` |
| 除湿机 | `ohai.switch` + `ohai.humidity_control` + `ohai.sensor.humidity` |
| 空气净化器 | `ohai.switch` + `ohai.air_purifier` + `ohai.sensor.pm25` |
| 智能音箱 | `ohai.volume` + `ohai.media_player` |
| 智能电视 | `ohai.switch` + `ohai.volume` + `ohai.media_player` + `ohai.media_input` |
| AV 功放 | `ohai.switch` + `ohai.volume` + `ohai.media_input` |
| 智能电表 | `ohai.power_meter` + `ohai.energy_meter` |
| 水阀控制器 | `ohai.valve` |
| 灌溉控制器 | `ohai.irrigation` |
| 扫地机器人 | `ohai.robot_vacuum` + `ohai.sensor.battery` |
| 洗衣机 | `ohai.switch` + `ohai.washer` + `ohai.child_lock` |
| 干衣机 | `ohai.switch` + `ohai.dryer` + `ohai.child_lock` |
| 洗烘一体机 | `ohai.switch` + `ohai.washer` + `ohai.dryer` + `ohai.child_lock` |
| 安防摄像头 | `ohai.camera` + `ohai.sensor.motion` |
| 热水器 | `ohai.switch` + `ohai.thermostat` |
| 光照传感器 | `ohai.sensor.illuminance` + `ohai.sensor.battery` |
| 人体存在传感器 | `ohai.sensor.occupancy` + `ohai.sensor.battery` |
| 噪声传感器 | `ohai.sensor.noise` + `ohai.sensor.battery` |
| 无线按钮/场景遥控器 | `ohai.button` + `ohai.sensor.battery` |
| 独立警笛 | `ohai.siren` |
