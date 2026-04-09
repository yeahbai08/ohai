# AI 集成

本文档定义 OHAI 的 AI 集成机制：Schema 到 LLM Tool Calling 的自动映射，以及基于 Adaptive Cards 的设备控制面板。

## 1. Schema 到 LLM Tool Calling 的映射

OHAI Server 为设备构建 LLM Tool Calling 定义时，使用的是 **Main Agent 持有的近似能力模型**（Approximate Capability Model），而非设备厂商原始 Schema 中的自由文本元数据。原始 Schema 的作用是提供结构约束、能力候选和探测起点；Main Agent 在完成能力探测后，仅消费探测得到的受控语义表示。

由于命令参数本身仍使用标准 JSON Schema 描述，与 LLM Tool Calling 的参数定义格式（OpenAI / Anthropic API 均使用 JSON Schema）天然一致，映射过程无需格式转换。

### 1.1 映射规则

| 近似能力模型字段 | LLM Tool 字段 |
|---|---|
| Capability `description` + Command `description`（探测后生成的受控描述） | Tool `description` |
| Command `params`（JSON Schema） | Tool `input_schema` |
| `<capability>:<command>` | Tool `name` |

### 1.2 映射示例

`ohai.brightness:set_brightness` → LLM Tool：

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

Server 在构建 LLM 上下文时，将设备当前 Device Shadow 状态注入 Tool description，使 LLM 在生成绝对目标值时具备充足的上下文信息。这里的 Tool description 来自探测后近似能力模型的受控描述，不直接拼接厂商原始 Schema 中的自由文本字段。

## 2. AI 自动化集成

### 2.1 设计理念：为什么用 Elixir 代码模块？

OHAI 的自动化规则由 Main Agent 的 LLM **从用户的自然语言描述自动生成 Elixir 代码模块**。每条规则是一个独立的 Elixir 模块，遵循预定义的 `OHAI.Rule` 模板，可调用系统提供的 API。

#### 为何不用 JSON DSL？

传统智能家居平台使用 JSON 格式的 Trigger → Condition → Action 规则。这种方式看似简洁，但在面对真实家庭场景时表达力严重不足：

| 常见需求 | JSON DSL 的困境 |
|---|---|
| 温度**持续** >30°C **超过 5 分钟**才开空调 | 无持续时间/防抖语义，传感器波动导致设备频繁开关 |
| 无人 **30 分钟后**关灯 | 无法表达"状态未变化持续 N 时间"，无延迟执行 |
| 空调设到**比室温低 4 度** | Action 参数只能硬编码，无法引用传感器数据动态计算 |
| **日落后**开灯 | Cron 表达式无法表达天文时间（日落时间每天不同） |
| **所有窗户都关闭**才开空调 | 条件检查只能逐个设备 AND，缺少聚合能力 |
| 门锁**连续 3 次输错密码**告警 | 无事件历史计数 |
| 灯光从 100% **渐变到** 30% | 无分步渐变动作 |
| 根据**一周用电历史**推荐节能设置 | 无法查询历史数据 |

每增加一种新需求就要扩展 DSL 语法——这是一个永无止境的过程。而 OHAI 的规则由 LLM 从自然语言生成，LLM 天然擅长生成代码。**直接生成 Elixir 代码模块，任何可用 Elixir 表达的逻辑都可以成为规则**，无需为每种模式设计专用语法。

#### 信任模型：规则代码 vs 设备 Pads

规则代码与设备 Pads（详见 [AI Agent 能力探测协议 - Pads](./secure-capability-prob.md#agent-pads：编译式格式适配器)）虽然都是 LLM 生成的 Elixir 代码，但信任等级不同：

| 维度 | 设备 Pads | 自动化规则 |
|---|---|---|
| 代码来源 | Sub Agent LLM（不受信任的设备厂商） | Main Agent LLM（代表用户） |
| 攻击者模型 | 恶意厂商可能有意注入攻击代码 | LLM 幻觉 / 用户 prompt 被注入（非恶意） |
| 允许的调用范围 | 极窄（纯数据转换模块） | 较宽（数据操作 + 时间 + 系统设备 API + 历史查询 + 环境数据） |
| 安全目标 | 防止恶意代码逃逸到 Main Agent | 防止 LLM 错误生成有害代码（安全网） |

**核心原则**：用户已经授权 LLM 通过自然语言控制家中设备（Tool Calling），LLM 代表用户生成控制设备的代码是**同等信任等级**。AST 调用范围检查是防御 LLM 幻觉的安全网，而非防御恶意攻击者。

### 2.2 规则模块模板

每条规则是一个 Elixir 模块，通过 `use OHAI.Rule` 引入 DSL 宏和回调机制。

#### 模块结构

```elixir
defmodule OHAI.Rules.MyRule do
  use OHAI.Rule

  @rule_name "规则名称"
  @description "用户可读的自然语言描述"

  # ── 声明式 DSL（简单规则的首选方式）──

  # 事件触发
  on_event "device_id", "capability", :event_name do
    # params 变量自动绑定事件参数
    # 此处编写逻辑...
  end

  # 状态变更触发
  on_state_change "device_id", "capability", :state_key do
    # old_value, new_value 变量自动绑定
    # 此处编写逻辑...
  end

  # 定时触发
  on_timer :timer_name do
    # 此处编写逻辑...
  end

  # ── 标准回调（复杂有状态逻辑时使用）──

  # 初始化回调（可选），用于设置初始状态和定时器
  def init do
    API.schedule_cron(:morning_check, "0 7 * * *")
  end

  # 通用事件处理回调（可选），处理 on_event 未覆盖的事件
  def handle_event(device_id, capability, event_name, params) do
    # ...
  end
end
```

#### DSL 宏说明

| 宏 | 用途 | 自动绑定的变量 |
|---|---|---|
| `on_event device, cap, event` | 设备上报特定事件时执行 | `params`（事件参数 map） |
| `on_state_change device, cap, state` | Device Shadow 中特定状态值变化时执行 | `old_value`、`new_value` |
| `on_timer name` | 命名定时器到期时执行 | 无 |

`on_event` 和 `on_state_change` 支持 `when` guard 进行条件过滤：

```elixir
on_event "temp_sensor", "ohai.sensor.temperature", :temperature_update,
  when: params.temperature > 30 do
  # 仅在温度 > 30 时执行
end
```

### 2.3 系统 API

规则通过 `OHAI.Rule.API`（在规则模块中简写为 `API`）访问系统功能。**所有设备操作和外部访问都通过此 API 进行，规则代码不直接访问 MQTT、数据库或底层网络库。**

#### 设备控制

```elixir
# 下发命令（内部强制执行 ai_policy 检查）
API.send_command(device_id, capability, command, params)
# 示例
API.send_command("ac_456", "ohai.thermostat", "set_thermostat",
  %{target_temp: 24, mode: "cool"})
```

`send_command` 内部执行完整的 `ai_policy` 校验流程——无论规则代码如何构造参数，最终都经过策略匹配（详见 [2.8 AI 决策权限控制](#_2-8-ai-决策权限控制)）。

#### 状态读取

```elixir
# 从 Device Shadow 读取当前状态
API.get_state(device_id, capability, state_key)
# 示例
temp = API.get_state("temp_sensor_123", "ohai.sensor.temperature", :temperature)
# => 28.5
```

#### 历史数据查询

```elixir
# 查询设备历史状态/事件数据
API.query_history(device_id, capability, state_or_event, time_range)
# 示例：查询过去 7 天的能耗数据
history = API.query_history("smart_plug_1", "ohai.energy_meter", :energy,
  last: {7, :days})
# => [%{timestamp: ~U[...], value: 12.3}, ...]
```

#### 通知

```elixir
# 推送通知到 Console App
API.notify(message)
# 示例
API.notify("客厅温度 #{temp}°C 持续偏高，已自动开启空调制冷")
```

#### 定时器

```elixir
# 命名定时器（同名调用自动覆盖前一个，天然防抖）
API.schedule_after(:timer_name, delay_ms)

# Cron 定时器
API.schedule_cron(:timer_name, "0 7 * * *")

# 取消定时器
API.cancel_timer(:timer_name)
```

命名定时器的关键特性：**同名调用覆盖**。当 `schedule_after(:check, 5000)` 被重复调用时，前一个定时器自动取消，只有最后一次调用的定时器生效。这天然实现了防抖（debounce）——无需额外逻辑。

#### 规则私有状态

```elixir
# 读写规则的私有状态（跨事件持久化，规则间隔离）
API.put_rule_state(:fail_count, 3)
count = API.get_rule_state(:fail_count)  # => 3
```

#### 环境信息

```elixir
# 日出日落时间（基于用户配置的地理位置）
{sunrise, sunset} = API.sun_times(Date.utc_today())
# => {~T[06:23:00], ~T[18:45:00]}

# 用户地理位置
{lat, lng} = API.location()
```

#### 环境数据

```elixir
# 天气预报（Server 内置数据服务，返回结构化数据）
API.weather(:current)
# => %{temp: 32, humidity: 65, condition: :sunny}

API.weather(:forecast, hours: 6)
# => [%{hour: 14, temp: 35, condition: :sunny},
#     %{hour: 15, temp: 33, condition: :cloudy}, ...]

# 电价（动态电价市场适用）
API.electricity_price(:current)
# => %{price: 0.52, unit: :yuan_per_kwh, tier: :peak}

API.electricity_price(:schedule, hours: 24)
# => [%{hour: 0, price: 0.28, tier: :off_peak}, ...]
```

环境数据服务的安全模型：

- **数据源由 OHAI 标准枚举定义**：只有标准定义的数据类型（天气、电价等），不可由第三方扩展
- **Server 负责获取和缓存**：规则代码无网络访问权，数据获取完全由 Server 在规则沙箱之外完成
- **返回值是封闭的结构化类型**：与设备 Schema 的类型约束同等严格（数值、枚举，无自由文本），防止数据中的提示词注入
- **数据源 URL 由用户配置**：用户在 Console App 中选择数据服务商（如气象 API 提供者），但返回值的结构由 OHAI 标准固定
- **Server 端值域校验**：Server 对外部 API 返回值进行 range check（如温度 -60°C ~ 60°C），超出合理范围的值被丢弃并记录异常日志
- **不可用时降级**：数据源不可用时 API 返回 `nil`，规则必须处理缺失数据的情况

#### API 速查表

| 分类 | 函数 | 说明 |
|---|---|---|
| 设备控制 | `send_command(device, cap, cmd, params)` | 下发命令（强制 ai_policy） |
| 状态读取 | `get_state(device, cap, state_key)` | 读取 Device Shadow |
| 历史查询 | `query_history(device, cap, key, range)` | 查询历史数据 |
| 通知 | `notify(message)` | 推送通知到 Console App |
| 定时器 | `schedule_after(name, delay_ms)` | 延迟定时器（同名覆盖 = 防抖） |
| 定时器 | `schedule_cron(name, cron_expr)` | Cron 定时器 |
| 定时器 | `cancel_timer(name)` | 取消定时器 |
| 规则状态 | `get_rule_state(key)` / `put_rule_state(key, val)` | 规则私有状态 |
| 环境 | `sun_times(date)` | 日出日落时间 |
| 环境 | `location()` | 用户地理位置 |
| 环境 | `weather(type, opts \\ [])` | 天气实况/预报（Server 内置数据服务） |
| 环境 | `electricity_price(type, opts \\ [])` | 电价实况/时段表（Server 内置数据服务） |

### 2.4 规则安全模型

#### AST 调用范围检查

规则代码在编译加载前，Server 对 Elixir 源码进行 AST 解析，执行**白名单校验**。与设备 Pads 的白名单机制（详见 [Pads 安全性](./secure-capability-prob.md#pads-安全性：ast-级静态分析)）原理相同，但允许范围更宽：

**允许的模块：**

```elixir
@allowed_modules [
  # OHAI 系统 API
  OHAI.Rule.API,

  # Elixir 标准库 — 数据操作
  Enum, List, Map, Keyword, Tuple, MapSet, Stream, Range,
  String, Integer, Float, Regex, Base, URI,

  # 日期时间
  DateTime, NaiveDateTime, Date, Time, Calendar,

  # 数学
  :math,

  # JSON
  :json,

  # 日志
  Logger
]
```

**禁止的模块/语法：**

| 类别 | 禁止项 | 原因 |
|---|---|---|
| 网络 I/O | `HTTPoison`、`:httpc`、`:gen_tcp`、`:ssl`、`Req`、`Finch` 等 | 规则不应直接访问网络（通过 Server 内置环境数据 API 间接获取） |
| 文件系统 | `File`、`Path`、`IO` | 规则不应访问文件系统 |
| 进程操作 | `Process`、`GenServer`、`Agent`、`Task`、`spawn`、`send/2`、`receive` | 进程操作由系统 API 封装 |
| 系统调用 | `System`、`:os`、`:erlang.open_port` | 禁止系统级操作 |
| 代码加载 | `Code`、`:code`、`Module`、`defmacro` | 禁止动态代码执行和元编程 |
| 存储 | `:ets`、`:dets`、`Mnesia` | 规则状态由 API 管理 |
| 危险语法 | `apply/3`、`:erlang.*` 原子调用、`String.to_atom/1` | 防止白名单绕过和 atom 泄漏 |

#### 供应链安全：禁止第三方依赖

LLM 生成规则代码时，**禁止引入任何第三方库**。规则代码只能使用 OHAI Server 内置的模块（上述白名单）。

这一限制的根本原因是防御**供应链投毒攻击**：如果 LLM 在生成规则时引用了第三方 Hex 包，而该包被攻击者投毒，恶意代码将在用户不知情的情况下在 Server 上执行。与 Web 应用不同，智能家居系统控制着用户的物理环境（门锁、电器、摄像头），供应链攻击的后果远比数据泄露严重。

Server 通过以下机制强制执行此限制：

- **AST 白名单**：规则代码的模块调用严格限制在白名单范围内，任何非白名单模块的调用在编译前即被拒绝
- **无包管理器访问**：规则编译环境不包含 Mix/Hex 客户端，LLM 生成的任何 `Mix.install` 或依赖声明无法执行
- **编译隔离**：规则在受限的编译环境中编译，只能使用 Server 预装的 BEAM 模块

#### 与 Pads 安全模型的对比

| 维度 | Pads（设备侧） | 规则（用户侧） |
|---|---|---|
| 白名单范围 | 13 个纯数据转换模块 | ~20 个模块 + OHAI.Rule.API |
| 定时器 | 不允许 | 允许（通过 `API.schedule_after`） |
| 设备控制 | 不允许 | 允许（通过 `API.send_command`） |
| 历史数据 | 不允许 | 允许（通过 `API.query_history`） |
| 日期时间 | 不允许 | 允许（`DateTime` 等） |
| 网络 I/O | 禁止 | 禁止（通过 Server 内置环境数据 API 间接获取） |
| 文件/系统 | 禁止 | 禁止 |
| 进程原语 | 禁止 | 禁止（由 API 封装） |

#### ai_policy 在 API 层强制执行

`OHAI.Rule.API.send_command/4` 内部强制执行 `ai_policy` 检查——无论规则代码如何构造参数，最终调用 API 时都会经过策略匹配。这比 JSON DSL 的静态分析**更可靠**，因为能覆盖所有动态参数组合：

```
规则代码调用 API.send_command(device, cap, cmd, params)
  └→ Server 解析该命令的生效 ai_policy（user_config ?? device_schema ?? standard_default ?? "allow"）
      └→ 将实际参数与参数级策略逐条匹配
          ├→ deny:    拦截 + 安全日志 + 通知用户
          ├→ confirm: 暂停 + 推送确认请求到 Console App + 等待用户确认
          └→ allow:   正常下发命令
```

#### 资源限制

| 防护 | 机制 |
|---|---|
| 内存耗尽 | 每条规则运行在独立 BEAM 进程，设置进程内存上限 |
| 死循环 | 事件处理设置执行超时，超时则终止本次执行并记录日志 |
| 设备轰炸 | `send_command` API 内置 rate limiting（同一设备同一命令的调用频率限制） |
| 规则间干扰 | BEAM 进程隔离，规则间无法直接通信 |

#### 系统级不变量检查

除 LLM 生成的业务测试外，Server 内置一组**不依赖 LLM 生成的标准化不变量检查**，在规则创建时和运行时持续执行：

| 不变量 | 创建时检查 | 运行时强制 |
|---|---|---|
| 同一设备不应在可配置的短窗口内收到矛盾命令 | 静态分析 + 集成模拟 | `send_command` 拦截 |
| 定时器间隔不应小于安全下限 | AST 分析 | 创建定时器时拒绝 |
| 单规则的 `send_command` 调用频率不应超过阈值 | 模拟测试统计 | API 层 rate limiting |
| 规则不应在未读取设备当前状态的情况下对状态敏感设备下发命令 | 代码审查 Agent 检查 | 运行时警告日志 |
| `notify` 调用频率不应导致通知轰炸 | 模拟测试统计 | API 层 rate limiting |

这些不变量是系统级安全网，与 LLM 生成的业务测试互补——业务测试验证规则逻辑是否正确，不变量检查防止规则行为越过系统安全边界。

#### 潜在风险分析

| 风险 | 缓解措施 |
|---|---|
| LLM 幻觉生成调用不存在的 API | AST 白名单拒绝非法调用 + Elixir 编译期报错 |
| 资源耗尽（死循环/巨大数据结构） | 规则进程独立，内存上限 + 执行超时 |
| 规则频繁下发命令 | API 层 rate limiting + 系统不变量检查 |
| 用户无法理解生成的代码 | 规则可视化：图形化展示触发条件、动作类型、影响设备 |
| LLM 引入被投毒的第三方库 | 禁止第三方依赖，AST 白名单 + 无包管理器访问 + 编译隔离 |
| 环境数据源返回错误数据 | Server 端值域校验 + 数据不可用时 API 返回 nil + 数据源不可第三方扩展 |
| 规则业务逻辑不正确 | 多 Agent 测试驱动开发 + 代码审查 + 系统不变量检查 + 集成模拟测试 |
| 规则长期运行偏离用户意图 | 详细执行日志 + LLM 持续分析 + 自动健康检查 + 主动通知用户 |
| 多规则交互导致系统不稳定 | 创建时集成模拟测试 + 运行时振荡检测 + 自动暂停异常规则 |

### 2.5 规则生命周期

#### 创建

规则创建采用**多 Agent 协作、测试驱动**的完整工程流程。无论规则复杂度如何，都走完整流程——简单规则各阶段耗时短，自然会快速完成；但跳过流程可能遗漏看似简单的规则对系统产生的意外影响。整个过程通过 Console App 向用户实时反馈进度。

**阶段一：需求分析**

用户在 Console App 中用自然语言描述规则意图后，LLM 不会立即生成代码，而是通过多轮对话完善需求：

1. **澄清边界条件**：用户很难一句话描述清楚需求。LLM 主动询问未明确的细节——触发阈值、时间窗口、异常情况处理、是否需要通知等，与用户逐步确认一份完整的需求描述
2. **分析规则冲突**：LLM 分析新规则是否与现有规则存在潜在冲突（目标竞争、设备重叠、触发条件交叉），如发现冲突则向用户说明，由用户决定修改现有规则还是调整新规则的设计
3. **确认需求**：最终生成一份结构化需求摘要，包含触发条件、执行动作、边界条件、与现有规则的关系，经用户确认后进入编码阶段

**阶段二：测试驱动编码**

编码严格遵循测试先行原则，且测试生成与规则编码由不同的 Agent 完成，避免确认偏误——自己出题自己做的测试往往覆盖不到真正的盲区：

1. **生成测试用例**（Test Agent）：根据确认的需求生成详尽的测试用例，覆盖正常路径、边界条件、异常输入和时序场景。每条规则的逻辑必须是确定性的——确定的输入对应确定的输出，含副作用的操作（设备控制、通知）通过 API 调用处理。定时器的时间间隔必须可配置，测试中使用短间隔加速验证
2. **生成规则代码**（Code Agent）：根据需求和测试用例生成 Elixir 规则模块
3. **代码审查**（Review Agent）：独立审查测试用例和规则代码的逻辑正确性、边界覆盖、安全合规
4. **系统不变量检查**：Server 对生成的代码执行内置的不变量校验（详见 [系统级不变量检查](#系统级不变量检查)）
5. **集成模拟测试**：将新规则连同所有现有规则一起，回放近期历史事件数据，观察系统整体行为是否稳定（详见 [集成模拟测试](#集成模拟测试)）
6. **运行测试**：执行全部测试用例。未通过则迭代修复，每次修改代码后重新经过代码审查、不变量检查和测试执行
7. **AST 校验 + 编译**：通过白名单检查后编译，加载到规则引擎

**阶段三：用户确认与部署**

Console App 向用户展示规则的可视化摘要（详见[规则可视化](#规则可视化)），用户确认后规则正式生效。

#### 状态管理

- **启用/禁用**：用户可在 Console App 中临时禁用规则而不删除，禁用后规则进程停止，不再接收事件
- **删除**：规则进程终止，模块卸载
- **优先级**：用户可为规则设置优先级（1-10），用于冲突检测时仲裁

#### 热更新

用户修改规则的自然语言描述后，LLM 重新生成代码，经 AST 校验和编译后热替换旧模块。BEAM VM 的热代码加载确保规则更新不影响其他规则的运行。热更新同样经过完整的测试驱动流程（测试生成 → 编码 → 审查 → 不变量检查 → 集成模拟 → 测试执行）。

#### 规则可视化

Console App 为每条规则提供图形化展示，帮助用户直观理解规则行为而无需阅读代码：

- **触发条件**：以流程图形式展示事件触发、状态变更触发、定时触发及其 guard 条件
- **动作类型**：区分展示设备控制、通知推送、状态读取等不同类型的动作
- **影响设备**：列出规则涉及的所有设备及其被控制的能力，标注 `ai_policy` 策略等级
- **规则间关系**：标注与其他规则的关联——共享设备、潜在冲突、执行优先级

#### 运行时监控与持续健康检查

规则部署后，Server 持续监控其运行状态并自动进行健康检查，确保规则长期运行不偏离用户意图。

**详细执行日志**

每条规则的每次执行都记录完整日志：

- 触发原因（哪个事件 / 状态变更 / 定时器）
- 执行时的上下文（读取的设备状态、环境数据）
- 执行结果（下发的命令、命令执行结果、通知内容）
- 执行耗时和资源消耗

日志保留策略由用户配置，默认保留 30 天。

**LLM 持续分析**

Server 周期性地将规则的执行日志提交给 LLM 进行分析，检测以下问题：

1. **意图偏离**：对比规则的原始需求描述与近期实际执行记录，判断规则行为是否仍然符合用户最初的意图。例如：季节变化后温控规则的触发频率异常升高，说明阈值可能需要调整
2. **无效执行**：规则持续触发但命令被 `ai_policy` 拦截、被冲突检测阻止、或设备长期离线，说明规则可能需要更新
3. **环境变化**：规则依赖的设备被移除、替换或长期未上报数据，规则的前提条件可能已失效
4. **异常模式**：执行频率异常（突然大幅增减）、执行结果异常（命令频繁失败）等统计偏差

发现问题时，系统通过 Console App 主动通知用户并给出具体的调整建议。

### 2.6 状态-事件-命令协作闭环

自动化引擎的核心是 **状态、事件、命令三者的协作循环**：

```mermaid
flowchart LR
    E[事件上报] -->|分发到规则| R[规则模块]
    R -->|API.get_state| S[Device Shadow]
    R -->|API.send_command| C[命令下发]
    C -->|result 更新| S
    E -->|reports 更新| S
    S -->|状态变更通知| R
```

**完整流程示例**：

1. 温湿度传感器上报 `temperature_update` 事件（`temperature: 32`）
2. 事件声明 `reports: [temperature]` → Server 更新传感器的 Shadow
3. 规则引擎将事件分发到所有订阅了该设备该事件的规则模块
4. 规则模块执行逻辑：读取空调 Shadow → 空调当前关闭 → 调用 `API.send_command` 开空调
5. `send_command` 内部匹配 `ai_policy` → `allow` → 下发命令
6. 空调回复成功 → Server 更新空调的 Shadow
7. 规则调用 `API.notify` → 通知用户 "已自动开启空调"

### 2.7 自动化规则完整示例

#### 示例 1：高温持续 5 分钟开空调

"当温度持续超过 30°C 超过 5 分钟，自动打开空调，目标温度设为比当前温度低 6 度。"

```elixir
defmodule OHAI.Rules.HighTempAC do
  use OHAI.Rule

  @rule_name "高温自动开空调"
  @description "当温度持续超过 30°C 超过 5 分钟，自动打开空调制冷"

  on_event "temp_sensor_123", "ohai.sensor.temperature", :temperature_update do
    if params.temperature > 30 do
      # 仅在定时器不存在时启动，避免反复重置导致永远无法到期
      unless API.timer_active?(:high_temp_check) do
        API.schedule_after(:high_temp_check, :timer.minutes(5))
      end
    else
      API.cancel_timer(:high_temp_check)
    end
  end

  on_timer :high_temp_check do
    temp = API.get_state("temp_sensor_123", "ohai.sensor.temperature", :temperature)

    if temp > 30 do
      API.send_command("ac_456", "ohai.thermostat", "set_thermostat",
        %{target_temp: temp - 6, mode: "cool"})
      API.notify("温度 #{temp}°C 持续偏高，已自动开启空调制冷")
    end
  end
end
```

**要点**：`timer_active?` 保证定时器只创建一次——首次超过 30°C 时启动 5 分钟倒计时，后续上报不会重置它；温度降回 30°C 以下时取消定时器。这样只有**持续**超温满 5 分钟才会触发空调。动态参数 `temp - 6` 使目标温度自适应当前室温。

#### 示例 2：深夜开门告警

"当门锁状态从锁定变为解锁，如果当前时间在晚上 10 点到早上 6 点之间，发送通知并打开客厅夜灯模式。"

```elixir
defmodule OHAI.Rules.NightDoorAlert do
  use OHAI.Rule

  @rule_name "深夜开门告警"
  @description "深夜门锁解锁时告警并开夜灯"

  on_state_change "front_door_lock_789", "ohai.lock", :locked do
    if old_value == true and new_value == false do
      hour = Time.utc_now().hour

      if hour >= 22 or hour < 6 do
        API.notify("前门在深夜被打开了！")
        API.send_command("living_room_light_123", "ohai.brightness",
          "set_brightness", %{brightness: 30})
        API.send_command("living_room_light_123", "ohai.color_temperature",
          "set_color_temp", %{color_temp: 2700})
      end
    end
  end
end
```

#### 示例 3：无人 30 分钟自动关灯

"人体传感器检测到运动时开灯；30 分钟没有检测到运动则自动关灯。"

```elixir
defmodule OHAI.Rules.AutoLightOff do
  use OHAI.Rule

  @rule_name "无人自动关灯"
  @description "检测到运动开灯，30 分钟无人后自动关灯"

  on_event "motion_sensor_101", "ohai.sensor.motion", :motion_update do
    if params.motion_detected do
      # 有人 → 开灯 + 重置关灯计时器
      API.send_command("room_light_201", "ohai.switch", "set_on", %{on: true})
      API.schedule_after(:no_motion_off, :timer.minutes(30))
    end
  end

  on_timer :no_motion_off do
    # 30 分钟内没有新的运动事件（否则计时器已被 schedule_after 覆盖重置）
    API.send_command("room_light_201", "ohai.switch", "set_on", %{on: false})
  end
end
```

**要点**：每次检测到运动都调用 `schedule_after(:no_motion_off, ...)`，同名定时器自动覆盖前一个，实现了"最后一次运动后 30 分钟"的精确语义。

#### 示例 4：日落开灯 + 日出关灯

"日落后自动开客厅灯，日出时自动关灯。"

```elixir
defmodule OHAI.Rules.SunlightAutomation do
  use OHAI.Rule

  @rule_name "日出日落自动灯光"
  @description "日落开灯，日出关灯"

  def init do
    schedule_next_sun_event()
  end

  on_timer :sunset_on do
    API.send_command("living_room_light", "ohai.switch", "set_on", %{on: true})
    API.send_command("living_room_light", "ohai.brightness",
      "set_brightness", %{brightness: 80})
    schedule_next_sun_event()
  end

  on_timer :sunrise_off do
    API.send_command("living_room_light", "ohai.switch", "set_on", %{on: false})
    schedule_next_sun_event()
  end

  defp schedule_next_sun_event do
    {sunrise, sunset} = API.sun_times(Date.utc_today())
    now = Time.utc_now()

    cond do
      Time.compare(now, sunset) == :lt ->
        delay = Time.diff(sunset, now, :millisecond)
        API.schedule_after(:sunset_on, delay)
      Time.compare(now, sunrise) == :lt ->
        delay = Time.diff(sunrise, now, :millisecond)
        API.schedule_after(:sunrise_off, delay)
      true ->
        # 今天的日出日落都已过，安排明天的
        {sunrise_tomorrow, _} = API.sun_times(Date.add(Date.utc_today(), 1))
        delay = Time.diff(sunrise_tomorrow, now, :millisecond) + 86_400_000
        API.schedule_after(:sunrise_off, delay)
    end
  end
end
```

**要点**：`API.sun_times/1` 根据用户配置的地理位置计算天文时间。规则在 `init` 时和每次执行后重新计算下一个事件时间，适应日出日落的日变化。

#### 示例 5：基于历史数据的智能建议

OHAI Server 会周期性地将设备历史数据提交给 LLM 进行分析。LLM 从数据中识别出用户的使用习惯和模式后，以自然语言向用户提出自动化建议。用户确认后，LLM 再将建议转化为具体的规则代码并部署。这个过程不是一条预编写的规则，而是系统的内在智能。

**场景**：系统持续收集热水器 `water_heater_01` 的运行数据（水流量、加热启停等）。经过两周的积累，LLM 在例行分析中发现了如下模式——

> **LLM 分析结果（内部）**：设备 `water_heater_01` 在过去 14 天中有 12 天于 6:50–7:10 之间检测到水流并开始加热，每次持续 15–25 分钟。模式高度稳定，判断为用户晨间洗漱用水习惯。当前热水器运行在单次加热模式（on-demand），用户每天早晨需要等待一段时间才能获得热水。

系统随即通过 Console App 向用户推送建议：

> **推送给用户的建议**：我注意到您几乎每天早上 7 点左右会使用热水，大概持续 20 分钟——看起来是起床洗漱的时间。目前热水器是按需加热的，每次开水龙头都需要等一会儿才有热水。\
> \
> 要不要我创建一条自动化规则：**每天 6:40 提前将热水器切换为循环模式预热，这样您起床后打开水龙头就有热水；7:30 自动切回按需模式以节省电费**？

用户确认后，LLM 生成以下规则并部署到 Server：

```elixir
defmodule OHAI.Rules.MorningWaterHeater do
  use OHAI.Rule

  @rule_name "早晨热水预热"
  @description "每天早晨提前预热热水器，洗漱后自动切回节能模式"

  def init do
    API.schedule_cron(:preheat, "40 6 * * *")
    API.schedule_cron(:energy_save, "30 7 * * *")
  end

  on_timer :preheat do
    API.send_command("water_heater_01", "ohai.water_heater",
      "set_mode", %{mode: "recirculating"})
  end

  on_timer :energy_save do
    API.send_command("water_heater_01", "ohai.water_heater",
      "set_mode", %{mode: "on_demand"})
  end
end
```

**要点**：这个示例展示了 OHAI 与前几个示例根本不同的一面——规则代码本身并不复杂，真正的智能在于**发现用户习惯并主动建议**的过程。系统通过 `API.query_history/4` 获取设备历史数据，交由 LLM 进行模式识别和推理，再将洞察转化为用户可理解的自然语言建议。用户确认后，LLM 才生成规则代码。这种"观察→洞察→建议→确认→部署"的闭环，让 OHAI 表现为一个持续学习、主动服务的智能系统。

### 2.8 规则冲突检测

#### 创建时静态分析

在规则创建阶段，Server 对新规则进行多层次冲突分析：

1. **命令级冲突**：检测新规则是否会向同一设备的同一能力下发与现有规则矛盾的命令（例如一条规则要开空调制冷，另一条要开制热）
2. **设备级冲突**：检测多条规则是否在相近时间窗口内操作同一设备的不同能力，可能导致设备状态不一致
3. **目标级冲突**：分析规则的意图是否与现有规则存在目标竞争——例如一条追求舒适、一条追求节能，虽然命令不直接矛盾但可能导致系统行为拉扯

检测到冲突时在 Console App 中警告用户，建议调整规则优先级、修改规则逻辑或设置互斥关系。

#### 集成模拟测试

新规则在部署前，Server 将其与所有现有规则一起在模拟环境中运行，回放近期（默认 7 天）的真实事件历史数据：

- 观察新规则与现有规则的整体交互行为
- 检测是否出现设备状态振荡（同一设备被反复开关）
- 统计各规则的触发频率、命令下发频率，检查是否符合系统不变量
- 生成模拟报告，展示新规则加入前后系统行为的差异

模拟测试不影响真实设备，仅在 Server 内部模拟执行。

#### 运行时冲突检测

1. **用户优先级**：用户为规则设置优先级（1-10），默认优先级跟规则的创建顺序相同，按照优先级依次触发
2. **矛盾命令检测**：`API.send_command` 在执行前检查是否有其他规则在短时间窗口内向同一设备的同一能力下发了矛盾命令，如检测到则暂停后到达的命令并通知用户
3. **振荡检测**：Server 持续监控每个设备的命令历史，当检测到同一设备在短时间内被多条规则反复操作（如灯被反复开关、空调在制冷和制热之间切换）时，自动暂停相关规则并通知用户。振荡判定标准：同一设备同一能力在可配置的时间窗口内收到超过阈值次数的状态翻转命令

### 2.9 AI 决策权限控制

OHAI 的能力模型在架构层面已将每个能力设计为单一职责、按能力粒度引用、事件按能力隔离，从根源上避免了某些智能家居平台中"获得设备一个能力即自动获得该设备所有能力"的粗粒度绑定问题。然而，所有由 AI 引擎决策的操作——无论是自动化规则触发的命令，还是 AI 响应用户语音/文本指令时生成的命令——都需要额外的权限约束以遵循**最小特权原则**。

#### 问题：命令风险不对称

同一能力内的命令可能存在风险不对称。例如 `ohai.lock` 的 `set_locked` 命令接受 `locked: boolean` 参数：

- `set_locked({ locked: true })` → 锁门，最坏后果是造成不便（被锁在门外）
- `set_locked({ locked: false })` → 开锁，可能导致非法入侵

更进一步，**同一操作在不同设备上的风险也不同**——前门锁的开锁是高危操作，但智能宠物门的自动开门恰恰是核心使用场景。安全策略不能仅按能力类型硬编码，必须允许设备级别的灵活定义。

#### AI 安全策略（`ai_policy`）

OHAI 的 `ai_policy` 是设备 Schema 的**顶层独立字段**，与能力定义结构分离。每条命令的安全策略由设备开发者根据设备的实际风险特征声明，标准能力库提供推荐的默认策略。`ai_policy` 约束所有由 AI 引擎决策的操作，不限制用户在 Console App 中直接点击按钮的手动操作。

| 策略 | 含义 | AI 决策行为 |
|---|---|---|
| `allow` | 常规操作（默认） | AI 可直接执行 |
| `confirm` | 需要用户确认 | AI 触发时暂停执行，推送确认请求到 Console App，用户确认后才下发 |
| `deny` | 禁止 AI 执行 | Server 无条件拦截，该命令只能由用户在 Console App 中手动操作 |

当同一命令的不同参数值具有不同风险等级时，使用参数级策略声明：

```yaml
# 设备 Schema 中的 ai_policy 声明
ai_policy:
  ohai.lock:set_locked:
    - when: { locked: true }           # 锁门
      policy: allow                     # 自动化可直接执行
    - when: { locked: false }          # 开锁
      policy: confirm                   # 自动化需用户确认
```

`when` 使用 JSON Schema 子集语法匹配参数值。匹配规则：

- 多条 `when` 按声明顺序匹配，**首条命中生效**
- 未命中任何 `when` 的参数组合，**回退到 `confirm`**（安全默认值——未被显式覆盖的参数组合需要用户确认，防止因遗漏 `when` 条件而意外放行危险操作）

#### 更多示例

**烤箱**：开启危险、关闭安全

```yaml
# 设备 Schema 的 ai_policy 字段
ai_policy:
  example-vendor.oven:set_on:
    - when: { on: true }               # 开启烤箱
      policy: confirm                   # 自动化需用户确认
    - when: { on: false }              # 关闭烤箱
      policy: allow                     # 自动化可直接执行
```

**温控**：正常范围自动化可执行，极端值需确认

```yaml
ai_policy:
  ohai.thermostat:set_thermostat:
    - when:                             # 目标温度超过 35°C
        target_temp: { minimum: 35 }
      policy: confirm                   # 需要用户确认
```

对于引用标准能力的设备，如果未在 `ai_policy` 中声明某命令的策略，则继承标准能力库中的默认策略。上例中 `ohai.thermostat:set_thermostat` 的标准默认策略本身即包含极端温度的 `confirm` 规则，设备如果不需要改动，无需重复声明。

#### Server 端 API 层强制执行

安全策略的执行完全在 Server 端的 `OHAI.Rule.API.send_command/4` 内部，自动化规则和 AI 响应指令均无法绕过。

由于自动化规则使用 Elixir 代码模块（参数可能是动态计算的），静态分析无法覆盖所有运行时参数组合。因此 `ai_policy` 的执行统一在**运行时 API 层**：

1. 规则代码或 AI 引擎调用 `API.send_command(device, cap, cmd, params)`
2. Server 解析该命令的**生效策略**：`user_config ?? device_schema ?? standard_default ?? "allow"`
3. 将**实际参数**与参数级策略逐条匹配
4. 命中 `deny` → **拦截**，不下发命令，记录安全日志，通知用户
5. 命中 `confirm` → **暂停**，推送确认请求到 Console App，等待用户确认后下发（超时则取消）
6. 命中 `allow` → 正常下发；未命中任何 `when`（仅当存在参数级策略时）→ 回退到 `confirm`

```
API.send_command(device, cap, cmd, params)
  └→ 解析生效策略（user_config ?? device_schema ?? standard_default ?? "allow"）
      └→ 将实际参数与参数级策略匹配
          ├→ deny:    拦截 + 安全日志 + 通知用户
          ├→ confirm: 暂停 + 推送确认到 Console App + 等待确认
          └→ allow:   正常下发命令
```

这种 API 层运行时拦截对动态参数天然有效——无论规则代码如何构造参数（硬编码、从传感器读取、从历史数据计算），最终都经过策略匹配。

#### 设计原则

1. **安全策略与能力定义分离**：`ai_policy` 是 Schema 的顶层独立字段，与能力的功能定义（states/commands/events）结构分离。安全策略反映设备的实际风险特征，而非能力类型的预设假设
2. **标准能力提供推荐默认**：标准能力库中为安全敏感的命令/参数组合提供推荐的默认策略（如开锁 `confirm`、撤防 `deny`）。设备引用标准能力时自动继承，但可在 `ai_policy` 中自由覆盖
3. **设备级灵活性**：开发者可根据设备的实际使用场景调整策略——宠物门可将开锁放宽为 `allow`，药品柜可将锁定加严为 `confirm`
4. **用户最终决定权**：用户在 Console App 中可自由调整策略（加严或放宽），不受限于标准默认或设备声明
5. **用户手动操作不受限制**：`ai_policy` 约束所有由 AI 引擎决策的操作。用户在 Console App 中直接点击按钮手动操作设备时，所有命令均可执行，不经过 `ai_policy` 检查

#### 策略解析模型

`ai_policy` 的生效策略由三层确定，每层**完全替换**上一层（不取 max）：

```
effective_policy = user_config ?? device_schema ?? standard_default ?? "allow"
```

| 层级 | 时机 | 谁设置 | 存储位置 |
|---|---|---|---|
| **标准能力默认** | 协议设计时 | OHAI 标准库 | 标准能力库（推荐策略，可被覆盖） |
| **设备 Schema 声明** | 设备注册时 | 设备开发者 | 设备 `schema.json` 的 `ai_policy` 字段 |
| **用户设备配置** | 运行时 | 用户（Console App） | Server 端设备配置数据库 |

**示例**：

```
ohai.lock — set_locked
├── locked: true
│   ├── 标准默认:    allow
│   ├── 设备声明:    (无)
│   ├── 用户配置:    (无)
│   └── 生效策略:    allow（继承标准默认）
│
└── locked: false
    ├── 标准默认:    confirm
    ├── 设备声明:    deny      ← 高安全门锁厂商加严
    ├── 用户配置:    (无)
    └── 生效策略:    deny（设备声明替换标准默认）
```

详细的 Schema 语法见 [设备 Schema 规范 - 安全策略声明](./schema.md#_2-4-安全策略声明)。