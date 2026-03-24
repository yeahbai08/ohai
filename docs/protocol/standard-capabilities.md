# 标准能力库

本文档定义 OHAI 标准能力库（`ohai.*` 命名空间）的完整规范。标准能力库是中央注册表，设备 Schema 通过键名引用即可使用，无需重复编写内部定义。

关于如何在设备 Schema 中引用标准能力、如何使用 `overrides` 覆盖约束，详见 [设备能力模型 - 4.2 节](./capability-model.md#_4-2-capability-引用与定义)。

---

## `ohai.switch` — 开关

最基础的能力：控制设备的开关状态。

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `on` | boolean | 是否开启 | `power_state` |

**Commands**

| 键名 | 类型 | affects | 说明 |
|---|---|---|---|
| `set_on` | state_cmd | `[on]` | 设置开关状态 |

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

## `ohai.brightness` — 亮度控制

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `brightness` | integer | 0-100, unit: % | 亮度百分比 | `brightness_level` |

**Commands**

| 键名 | 类型 | affects | 说明 |
|---|---|---|---|
| `set_brightness` | state_cmd | `[brightness]` | 设置亮度（绝对值） |

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

## `ohai.color_temperature` — 色温控制

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `color_temp` | integer | 2700-6500, unit: K | 色温 | `color_temperature` |

**Commands**

| 键名 | 类型 | affects | 说明 |
|---|---|---|---|
| `set_color_temp` | state_cmd | `[color_temp]` | 设置色温 |

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

## `ohai.color` — 颜色控制

**States**

| 键名 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `hue` | integer | 0-360 | 色相 |
| `saturation` | integer | 0-100, unit: % | 饱和度 |

**Commands**

| 键名 | 类型 | affects | 说明 |
|---|---|---|---|
| `set_color` | state_cmd | `[hue, saturation]` | 设置颜色 |

::: details 展开完整定义
```yaml
ohai.color:
  description: 颜色控制
  states:
    hue:
      type: integer
      minimum: 0
      maximum: 360
      description: 色相
    saturation:
      type: integer
      minimum: 0
      maximum: 100
      unit: "%"
      description: 饱和度
  commands:
    set_color:
      cmd_type: state_cmd
      affects: [hue, saturation]
      description: 设置颜色
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

## `ohai.thermostat` — 温控

**States**

| 键名 | 类型 | 约束 | 说明 | semantic |
|---|---|---|---|---|
| `target_temp` | number | unit: °C | 目标温度 | `temperature_reading` |
| `current_temp` | number | unit: °C | 当前温度（只读） | `temperature_reading` |
| `mode` | string | enum: heat/cool/auto/off | 工作模式 | — |

**Commands**

| 键名 | 类型 | affects | 说明 |
|---|---|---|---|
| `set_thermostat` | state_cmd | `[target_temp, mode]` | 设置温控参数 |

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
      semantic: temperature_reading
    current_temp:
      type: number
      unit: "°C"
      description: 当前温度（只读）
      semantic: temperature_reading
    mode:
      type: string
      enum: [heat, cool, auto, off]
      description: 工作模式
  commands:
    set_thermostat:
      cmd_type: state_cmd
      affects: [target_temp, mode]
      description: 设置温控参数
      params:
        type: object
        properties:
          target_temp: { type: number }
          mode: { type: string, enum: [heat, cool, auto, off] }
        additionalProperties: false
      result:
        type: object
        properties:
          target_temp: { type: number }
          mode: { type: string }
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

## `ohai.lock` — 门锁

**States**

| 键名 | 类型 | 说明 | semantic |
|---|---|---|---|
| `locked` | boolean | 是否已锁定 | `lock_state` |

**Commands**

| 键名 | 类型 | affects | 说明 |
|---|---|---|---|
| `set_locked` | state_cmd | `[locked]` | 设置锁定状态 |

**Events**

| 键名 | reports | 说明 |
|---|---|---|
| `lock_changed` | `[locked]` | 锁状态变更（物理钥匙/指纹/密码） |
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
      description: 锁状态变更（物理钥匙/指纹/密码）
      reports: [locked]
      params:
        type: object
        properties:
          locked: { type: boolean }
          method: { type: string, enum: [key, fingerprint, pin, app, auto] }
        required: [locked, method]
        additionalProperties: false
    tamper_alert:
      description: 防撬告警
      params:
        type: object
        properties:
          timestamp: { type: string }
        required: [timestamp]
        additionalProperties: false
```
:::

---

## `ohai.sensor.*` — 传感器系列

传感器能力通常只有 States 和 Events，没有 Commands。

### `ohai.sensor.temperature` — 温度传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `temperature` | number | unit: °C | `temperature_reading` |

| Events | reports | 说明 |
|---|---|---|
| `temperature_update` | `[temperature]` | 温度变化上报 |

### `ohai.sensor.humidity` — 湿度传感器

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `humidity` | number | 0-100, unit: % | `humidity_reading` |

| Events | reports | 说明 |
|---|---|---|
| `humidity_update` | `[humidity]` | 湿度变化上报 |

### `ohai.sensor.motion` — 运动检测

| States | 类型 | semantic |
|---|---|---|
| `motion_detected` | boolean | `motion_detected` |

| Events | reports | 说明 |
|---|---|---|
| `motion_detected` | `[motion_detected]` | 检测到运动 |

### `ohai.sensor.contact` — 门窗开合

| States | 类型 | semantic |
|---|---|---|
| `contact` | boolean | `contact_state` |

| Events | reports | 说明 |
|---|---|---|
| `contact_changed` | `[contact]` | 开合状态变更 |

### `ohai.sensor.battery` — 电池电量

| States | 类型 | 约束 | semantic |
|---|---|---|---|
| `battery_level` | integer | 0-100, unit: % | `battery_level` |

| Events | reports | 说明 |
|---|---|---|
| `low_battery` | — | 电量不足告警 |

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

ohai.sensor.motion:
  description: 运动检测传感器
  states:
    motion_detected:
      type: boolean
      description: 是否检测到运动
      semantic: motion_detected
  commands: {}
  events:
    motion_detected:
      description: 检测到运动
      reports: [motion_detected]
      params:
        type: object
        properties:
          motion_detected: { type: boolean }
        required: [motion_detected]
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
      params:
        type: object
        properties:
          battery_level: { type: integer }
        required: [battery_level]
        additionalProperties: false
```
:::
