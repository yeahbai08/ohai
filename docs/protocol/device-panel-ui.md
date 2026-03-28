# 设备控制面板：Adaptive Cards

厂商可在 `schema.json` 的 `panel` 字段中提供一个 [Adaptive Card](https://adaptivecards.io/) 定义，描述设备在 Console App 中的控制面板 UI。

## 设计原则

- **声明式 UI** — 厂商用 Adaptive Card JSON 声明面板布局与交互元素，Console App 决定最终渲染样式（适配手机、平板、桌面等不同终端）
- **数据绑定** — Card 模板中使用 Adaptive Cards 标准的 `${...}` 模板语法引用设备 States，Console App 实时注入 Device Shadow 数据渲染
- **命令绑定** — 通过 `Action.Execute` 的 `verb` 字段映射到 Schema 中定义的命令，Console App 据此下发命令
- **趋势图扩展** — OHAI 定义扩展元素 `OhaiChart` 引用 States 的历史数据，Console App 从 DuckDB 查询后渲染
- **可选** — 若厂商未提供 Panel，Console App 根据 States 和 Commands 的类型约束自动生成默认面板

## 数据绑定

Panel 模板中使用 `${...}` 语法引用运行时数据。Console App 渲染时将 Device Shadow 数据注入模板上下文：

| 绑定语法 | 含义 | 示例 |
|---|---|---|
| `${<capability>:<state>}` | 当前状态值（来自 Device Shadow） | `${ohai.switch:on}` |
| `${$device.alias}` | 设备别名 | `${$device.alias}` |
| `${$device.online}` | 设备是否在线 | `${$device.online}` |

## 命令绑定

`Action.Execute` 通过 `verb` 字段指定命令的完整路径 `<capability>:<command_name>`，`data` 字段为命令参数。参数值可来自 Input 控件（通过控件 ID 引用）或硬编码值：

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

## 趋势图扩展元素

Adaptive Cards 无原生图表组件，OHAI 定义扩展类型 `OhaiChart`：

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

### 完整示例：智能灯泡面板

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

### Panel 校验规则

Server 在设备注册时对 Panel 执行以下校验：

1. Panel 整体须通过 Adaptive Cards 语法校验（结构合法的 Adaptive Card）
2. `Action.Execute` 的 `verb` 必须匹配 Schema 中某个 `<capability>:<command>` 键
3. `data` 中引用的参数名必须符合对应命令的 `params` JSON Schema
4. `${<capability>:<state>}` 绑定表达式中的路径必须在 Schema 的 `states` 中存在
5. `OhaiChart.source` 引用的路径必须在 Schema 中存在且对应数值类型状态（`integer` 或 `number`）
6. **禁止 `Action.OpenUrl`**：Panel 中不允许使用 `Action.OpenUrl` 类型的动作，防止厂商通过 Panel 引导用户访问外部钓鱼链接
7. **禁止外部资源引用**：`Image` 元素的 `url` 字段仅允许 `data:` URI（内联图片）或相对路径（由 Server 托管），禁止引用外部 HTTP/HTTPS URL，防止用户追踪和隐私泄漏

### 自动生成默认面板

若厂商未提供 `panel`，Console App 基于 Schema 中的 States 和 Commands 类型约束自动生成默认面板：

| State / Param 类型 | 默认 UI 控件 |
|---|---|
| `boolean` | Toggle 开关 |
| `integer` 或 `number`（有 min/max） | Slider 滑块 |
| `integer` 或 `number`（无 min/max） | Number Input 数字输入框 |
| `string`（有 enum） | ChoiceSet 下拉选择 |
| `string`（无 enum） | Text Input 文本输入框 |

事件中带 `reports` 的数值型 States 自动生成趋势图（`OhaiChart` line chart, 24h）。
