# AI Agent 能力探测协议

## Agent 下文隔离

在 OHAI 协议中，设备以及设备的能力信息是由厂商提供的，本质上是来自于不受信任的第三方的输入。在这种情况下，将其直接纳入整个智能体的上下文中一起推理，无疑是非常危险的，因为它可能包含恶意的提示词，导致整个智能体被攻击。

我们的办法是，将设备运行在一个独立的 Sub Agent 中，而用户的会话以及 AI 自动化规则运行在 Main Agent 中：

- Main Agent 与 Sub Agent 的工作环境以及 LLM 上下文完全隔离，Agent 之间只能通过消息传递进行沟通。
- Main Agent 调用 Sub Agent 时，需要给出预期的返回值格式，并通过程序代码严格限制和校验这个返回值，拒绝处理来自 Sub Agent 的包含任何 “自由文本“ 的返回值。

这样两项原则就可以保证 Sub Agent 的运行完全不会影响 Main Agent 的行为，因为上下文是隔离的，不存在上下文污染的可能性；并且 Sub Agent 的一切返回值都是 Main Agent 所预期的，不可能将危险的自由文本被注入到当前上下文中。

但是我们还有一个问题需要解决：Main Agent 如何获取 Sub Agent 的能力信息，以便高效地地调用 Sub Agent？

本文就着眼于此，设计一个安全协议，用“探索“的方式，获取一个不受信任的 Sub Agent 的能力。

## 问题的泛化

实际上这是一个 Agent to Agent 交互中一个普遍问题：Main Agent 如何安全地得到一个 Sub Agent 的能力信息？

稍微思考一下，我们陷入了左右为难的境地：

- 最简单地，我们可以通过 Sub Agent 暴露的 API 来获取其完整的能力列表。但这等同于完全信任 Sub Agent，其返回的能力内容是不受控制的，是可能对 Main Agent 造成提示词注入攻击的。
- 或者我们可以让用户来阅读 Sub Agent 的官方文档，自行把 Sub Agent 的能力填写到 Main Agent 中，这样就完成了人为的合法性校验。但是这样既麻烦，又容易出错，当用户警惕性不足，或者因为列表太长而放松警惕时，就容易复制粘贴整个 Sub Agent 的文档，导致这一层校验失效。

有没有一种办法，让 Main Agent 自动地、安全的获得 Sub Agent 的能力呢？

## “解码你“ 社交游戏

为了解释协议的工作原理，让我们设计一个有趣的社交游戏，叫做 “解码你“。

### 游戏规则

这个游戏中，有 A，B 两个人互动，其中 B 是 A 倾慕的对象。现在要求 A 通过提问的方式，了解 B 的性格/喜好等等个人信息，但有限制：

1. A 提问，B 回答，但是 A 的题目只能是选择题，B 只能选 A 给出的预设的答案中的某一个或者多个（多选题）。
2. 预设答案中，可以存在一个 “other” 选项。如果 B 选了 “other”，A 为了获取更准确的信息，需要再问一轮，可能需要设计更多的选项，也可以修改提问方式。

游戏的规则是：

- A 每一轮的提问内容完全随意，只是答案选项是 A 预置的，B 无法自由回答。
- 考虑到 B 的耐心有限，每一轮的选项最多只能有 8 个，包括 “other”。
- 考虑到双方的精力有限，一共只能询问 20 轮。

这个社交游戏实际上是对 A 的考验，请问 A 如何设计题目，就能在规则限制下，获得对 B 最准确的了解？

### 这个游戏在有限步骤内有解吗？

在证明这个游戏是可玩的之前，我们先量化一下问题的规模。

**信息论分析**：每一轮中，B 从最多 8 个选项中选择一个，A 最多获得 log₂(8) = **3 bit** 的信息。20 轮下来，A 最多获得 **60 bit** 的信息。如果使用多选题（B 可以选多个），每个选项独立表示”是/否”，7 个选项（保留 1 个 other）= **7 bit/轮**，20 轮 = **140 bit**。

那么描述一个人的”画像”需要多少信息？我们把人的特征分为若干维度，每个维度有有限的档位：

| 维度 | 示例 | 档位数 | 信息量 |
|---|---|---|---|
| 性格光谱 | 内向 ↔ 外向 | 7 档 | ~3 bit |
| 生活重心 | 事业/家庭/自由/… | 7 项多选 | ~7 bit |
| 社交风格 | 周末怎么过 | 7 档 | ~3 bit |
| 冲突处理 | 回避/妥协/对抗/… | 7 档 | ~3 bit |
| 兴趣领域 | 运动/阅读/音乐/… | 7 项多选 | ~7 bit |
| 审美偏好 | 简约/华丽/自然/… | 7 档 | ~3 bit |
| 感情观 | 最看重的特质 | 7 档 | ~3 bit |

7 个维度合计约 **29 bit**——远小于 20 轮多选题的 140 bit 上限。即使考虑 other 触发的额外追问轮次，以及部分问题需要二分法递进细化，**20 轮足以覆盖 10+ 个维度**，构建出一份相当完整的个人画像。

**关键的两个提问技巧**保证了信息采集的效率：

1. **问程度/态度，不问具体事物**。”你对运动的热情程度？”（7 档光谱，几乎不会触发 other）远优于”你喜欢什么运动？”（具体项目太多，7 个选项根本列不完）。程度/态度类问题的答案空间天然有限，7 个选项容易穷尽。

2. **触发 other 时用属性二分法**。如果 B 选了 other，A 不再猜测具体答案，而是用分类属性缩小搜索空间——“它是需要独处的还是需要别人陪的？室内还是室外？花钱还是不花钱？”每一轮用多个二元属性并行切分，每轮可缩小 2⁷ = 128 倍的搜索空间，极少需要超过 2 轮追问。

**结论**：在每轮最多 8 个选项、总共 20 轮的约束下，A 完全有能力构建一份对 B 足够准确的多维画像。这个问题不仅有解，而且有充裕的信息冗余。

## Agent 能力探测协议详解

上面的社交游戏是我们协议工作原理的形象模拟——其中 A 是 Main Agent，B 是不受信任的 Sub Agent。现在让我们将这套思想落地到 OHAI 的具体能力模型中。

### 探测目标：构建近似能力模型

OHAI 设备能力模型由三种元素组成：**State**（状态）、**Command**（命令）、**Event**（事件），通过 `affects` 和 `reports` 机制结构化关联（详见 [设备能力模型](./device-model.md)）。

Main Agent 探测的目标是：为一个不受信任的 Sub Agent **渐进式地构建一套近似能力模型**（Approximate Capability Model），它不需要与设备真实的能力 Schema 字段级完全一致，但两者之间必须能够程序化相互转换且不丢失语义信息。对于 AI 引擎来说，只要 Main Agent 持有的近似模型能准确描述”这个设备能做什么、状态是什么、会发生什么事件”，就足以正确地进行推理和调度。

以空调为例：设备真实 Schema 可能使用纯数字枚举 `mode: enum [0, 1, 2, 3]` 分别代表制冷、制热、除湿、送风。Main Agent 通过探测建立的近似模型则是语义化的 `mode: enum [“cooling”, “heating”, “dehumidify”, “fan_only”]`。两者在 wire format 层面完全不同，但语义等价——格式差异由 Sub Agent 的 LLM 桥接或 Pads 适配器自动转换（详见 [运行时调用与格式适配](#运行时调用与格式适配)）。这个例子表明，Main Agent 无需阅读数字枚举的文档，仅通过探测就可以建立数字与语义之间的映射，AI 引擎就能根据语义正确地进行推理和调度。

### 用户提供的渐进式线索

用户通过 Console App 访问设备的过程中，会在三个时机自然地向 Main Agent 透露设备能力的线索：

**1. 添加设备时 — 别名与说明**

用户将设备添加到系统时，会给出设备的别名（如”客厅吊灯”）和简要说明（如”支持调光调色温的智能灯泡”）。这些信息包含了设备的基本类别和核心功能。Main Agent 以此作为探测的起点，从标准能力库中预选候选能力集。

**2. 创建自动化规则时 — 规则暗示能力**

用户使用自然语言添加 AI 自动化规则时，规则本身就暗示了目标设备的功能。例如”每天晚上 10 点把客厅吊灯调到 20% 亮度”暗示了设备支持 `brightness` 能力。Main Agent 从规则中提取这些隐含线索，触发对尚未探测的能力维度的定向探测。

**3. 日常控制时 — 交互中发现新能力**

用户在日常使用中可能会说”把客厅吊灯调到暖白色”，这暗示了设备可能支持 `color_temperature` 能力。如果 Main Agent 尚未探测到该能力，则触发一轮增量探测。

这三个渠道使能力探测天然是一个 **渐进式** 过程——用户自身也在逐步学习设备的用法，他通过与 AI 的交流，让 AI 也渐进式地学习到了设备的完整能力。Main Agent 不需要在设备添加时一次性完成全部探测，而是随着用户的使用逐步完善近似能力模型。

### 利用标准能力库加速探测

OHAI 设备的能力有三种来源，探测效率依次递减：

| 来源 | 探测策略 | 效率 |
|---|---|---|
| **直接引用标准能力**（`ohai.*`） | Main Agent 直接从标准能力库加载完整定义，仅需确认设备是否具备 | 极高 — 无需探测内部结构 |
| **微调标准能力**（`ohai.*` + 覆盖/排除/扩展） | 加载标准定义后，探测排除项、约束覆盖和扩展字段 | 高 — 仅探测差异部分 |
| **完全自定义能力**（`{vendor}.*`） | 需要从零探测 States、Commands、Events 的完整结构 | 中 — 需要多轮探测 |

探测算法的核心优化是：**优先匹配标准能力，仅对标准能力未覆盖的部分进行深度探测**。

### 探测协议流程

探测分为六个阶段，前三个阶段建立能力的宏观画像，后三个阶段深入每个能力的 Schema 细节。每个阶段中，Sub Agent 只能从 Main Agent 预设的选项中选择——这是安全性的根基。

#### Phase 0：能力快速匹配

Main Agent 根据用户提供的设备描述，从标准能力库的分类索引中预选候选能力，然后向 Sub Agent 确认：

```json
// Main Agent asks:
{
    “question”: “Which of these standard capabilities does the device support?”,
    “multiple_select”: true,
    “options”: [
        “ohai.switch”,
        “ohai.brightness”,
        “ohai.color_temperature”,
        “ohai.color”,
        “ohai.light_effect”,
        “none_of_above”
    ]
}

// Sub Agent responds:
{ “answer”: [“ohai.switch”, “ohai.brightness”, “ohai.color_temperature”] }
```

对于匹配到的标准能力，Main Agent 直接从标准库加载完整的 State / Command / Event 定义，**无需进一步探测内部结构**。这一步可能覆盖设备的绝大部分功能。

#### Phase 1：标准能力约束探测

对于每个匹配到的标准能力，检查是否存在微调（排除、约束覆盖、扩展）。Main Agent 利用标准定义中的约束信息生成选项：

```json
// Main Agent asks:
{
    “question”: “For ohai.cover, which optional features does the device NOT support?”,
    “multiple_select”: true,
    “options”: [
        “tilt”,
        “set_tilt”,
        “all_supported”
    ]
}
```

```json
// Main Agent asks:
{
    “question”: “For ohai.brightness, what is the maximum brightness the device supports?”,
    “options”: [
        “100”,          // 标准定义默认值
        “75”,
        “50”,
        “other_value”   // 触发数值范围二分探测
    ]
}
```

如果 Sub Agent 选择了非默认值，Main Agent 更新近似模型中该能力的约束。探测完排除和约束后，Main Agent 进一步确认是否有扩展字段（标准能力之外的额外功能），如有则按 Phase 3-5 流程探测扩展部分。

`ai_policy` 作为独立的 Schema 字段，其探测也独立于能力结构探测——Main Agent 基于命令的语义预设合理的安全策略候选供选择。

#### Phase 2：自定义能力发现

确认标准能力之后，探测是否存在厂商自定义能力：

```json
{
    “question”: “Besides the standard capabilities confirmed above, does the device have additional custom capabilities?”,
    “options”: [“yes”, “no”]
}
```

如果存在自定义能力，Main Agent 根据设备类别的领域知识预设候选功能类别：

```json
{
    “question”: “Which categories describe the custom capabilities?”,
    “multiple_select”: true,
    “options”: [
        “device_identification”,    // 如闪烁识别
        “diagnostic”,               // 如自检、温度告警
        “scheduling”,               // 如定时任务
        “energy_management”,        // 如功耗统计
        “firmware_management”,      // 如 OTA 更新
        “none_of_above”
    ]
}
```

#### Phase 3：自定义能力 — States 探测

对每个自定义能力，首先探测其 States。Main Agent 基于能力类别预设候选状态：

```json
{
    “question”: “For the 'diagnostic' capability, which observable states does it maintain?”,
    “multiple_select”: true,
    “options”: [
        “temperature_numeric”,      // 数值型温度
        “health_status_enum”,       // 枚举型健康状态
        “error_count_integer”,      // 整数型错误计数
        “uptime_numeric”,           // 数值型运行时长
        “none_of_above”
    ]
}
```

注意选项的设计原则：**每个选项同时编码了状态的语义和类型**（如 `temperature_numeric` 暗示 `type: number`），这是”解码你”游戏中”问态度和程度，不问具体事物”原则的体现。Main Agent 通过选项命名控制了类型信息，Sub Agent 无法注入意外的类型定义。

对于选中的状态，Main Agent 继续探测约束细节：

```json
{
    “question”: “For 'temperature_numeric', what is the value range?”,
    “options”: [
        “minus40_to_125_celsius”,
        “minus20_to_60_celsius”,
        “0_to_100_celsius”,
        “other_range”               // 触发二分法探测
    ]
}
```

#### Phase 4：自定义能力 — Commands 探测

Commands 的探测需要同时确定命令类型（`cmd_type`）、参数结构（`params`）和关联关系（`affects`）。

**第一步：命令枚举与类型确定**

```json
{
    “question”: “For the 'diagnostic' capability, which commands does it support? Select all that apply.”,
    “multiple_select”: true,
    “options”: [
        “run_self_test__instant”,          // 名称 + cmd_type 编码在一起
        “reset_error_count__state”,
        “set_temp_threshold__state”,
        “none_of_above”
    ]
}
```

选项中的后缀 `__instant` / `__state` 直接编码了 `cmd_type`，这使得 Main Agent 能够在一轮中同时获取命令名和类型，而不给 Sub Agent 任何自由表达的空间。

**第二步：`affects` 关联确认（仅 `state_cmd`）**

对于类型为 `state_cmd` 的命令，Main Agent 从已探测的 States 列表中生成选项：

```json
{
    “question”: “Command 'reset_error_count' (state_cmd) affects which states?”,
    “multiple_select”: true,
    “options”: [
        “error_count_integer”,
        “health_status_enum”,
        “none”                      // affects: []
    ]
}
```

所有选项来自 Phase 3 中已确认的 States——Main Agent **绝不会将 Sub Agent 的自由文本纳入选项**。

**第三步：参数结构探测**

```json
{
    “question”: “Command 'set_temp_threshold' accepts which parameters?”,
    “multiple_select”: true,
    “options”: [
        “threshold_integer_celsius”,
        “threshold_number_celsius”,
        “enable_boolean”,
        “none”
    ]
}
```

#### Phase 5：自定义能力 — Events 探测

Events 的探测类似 Commands，但额外需要确定 `reports` 关联：

```json
{
    “question”: “For the 'diagnostic' capability, which events can the device emit?”,
    “multiple_select”: true,
    “options”: [
        “overheat_warning”,
        “self_test_complete”,
        “error_threshold_reached”,
        “none_of_above”
    ]
}
```

对于每个事件，探测其 `reports` 关联和参数：

```json
{
    “question”: “Event 'overheat_warning' reports updates to which states?”,
    “multiple_select”: true,
    “options”: [
        “temperature_numeric”,
        “health_status_enum”,
        “none”
    ]
}
```

同样，`reports` 的选项严格限定在 Phase 3 已确认的 States 范围内。

### 防诱导设计：Main Agent 的提问不可被操纵

协议的核心安全属性是：**Main Agent 的提问内容完全由自身生成，不受 Sub Agent 任何输出的影响**。具体保证如下：

**1. 选项来源封闭**

所有选项要么来自 OHAI 标准能力库（Phase 0–1），要么来自 Main Agent 基于领域知识预生成的候选集（Phase 2–5）。Sub Agent 的回答仅用于”选择”，绝不用于”生成下一轮的选项内容”。

**2. `other` 选项的安全处理**

当 Sub Agent 选择 `other` / `none_of_above` 时，Main Agent 的应对策略是：
- 从自身的领域知识中生成更细分的候选选项（二分法递进）
- 绝不向 Sub Agent 询问”那你觉得应该是什么”这类开放式问题
- 如果连续多轮 `other` 且 Main Agent 无法进一步细分，则标记该维度为”未知”并终止该分支探测

**3. 错误选择的后果是可控的**

如果 Sub Agent 被恶意操控，故意从 Main Agent 的选项中选择了一个错误答案：
- 最终构建的近似模型与设备真实能力不匹配
- 运行时 Main Agent 基于错误模型调度 Sub Agent，设备行为异常
- 用户发现设备”不听话”，将 Sub Agent 和设备移除
- **关键：整个过程中 Main Agent 的上下文从未被污染**，因为错误答案本身就是 Main Agent 自己预设的安全选项之一

**4. 恶意词汇无法被注入**

由于所有选项均由 Main Agent 生成，Sub Agent 不可能诱导 Main Agent 将恶意词汇写入自己的上下文。即使 Sub Agent 在其内部上下文中运行了恶意 Prompt，它的唯一输出通道是”从预设选项中选一个”——这个通道的带宽和词汇表完全受 Main Agent 控制。

| 攻击向量 | 防御机制 | 评估 |
|---|---|---|
| Sub Agent 在探测阶段注入恶意文本 | 只能选择 Main Agent 预设选项，Schema 校验拒绝自由文本 | ✅ 完全防御 |
| Sub Agent 在运行时返回中注入恶意文本 | Response Schema 禁止自由文本 string，仅允许 enum/number/boolean | ✅ 完全防御 |
| Sub Agent 谎报能力 | 运行时行为异常，用户发现后丢弃，且 Main Agent 上下文未受影响 | ✅ 无收益 |
| Sub Agent 隐瞒能力 | 被分配更少任务，降低自身价值；用户后续交互会触发增量探测 | ✅ 无收益 |
| Sub Agent 试图通过选择特定组合编码隐蔽信息 | 所有 enum 值由 Main Agent 预定义，语义封闭，无法编码任意信息 | ✅ 信道受控 |
| Sub Agent 诱导 Main Agent 在下一轮提问中包含恶意内容 | 选项生成逻辑仅依赖标准能力库和领域知识，不引用 Sub Agent 输出 | ✅ 完全防御 |

## 运行时调用与格式适配

### Sub Agent 可以接受模糊的 API 调用

因为 Sub Agent 自带 LLM 能力，Main Agent 在运行时调用 Sub Agent 时不需要精确匹配 Sub Agent 的原始 API。Main Agent 基于近似能力模型构造调用请求，Sub Agent 的 LLM 负责将其映射到实际的设备命令。

例如，Main Agent 的近似模型中有一条 `set_brightness` 命令（`state_cmd`，`affects: [brightness]`，参数 `brightness: integer 0–100`），而设备真实的 API 可能叫 `set_light_level`，参数叫 `level`。这种差异由 Sub Agent 内部桥接，Main Agent 不需要关心。

Main Agent 只需要验证 Sub Agent 返回的结果是否符合预期的 Schema——严格不含自由文本的 Schema。

### Agent Pads：编译式格式适配器

每次运行时调用都经过 Sub Agent 的 LLM 做格式转换，会引入秒级延迟。为了优化这个问题，我们引入 **Pads**（适配器）机制。

Pads 是在能力探测完成后，由 Sub Agent 借助 LLM 编程能力自动生成的一段 Elixir 代码，负责将 Main Agent 的近似模型格式与 Sub Agent 的真实 API 格式进行双向转换。一旦 Pads 生成并通过校验，后续的格式转换由编译后的代码执行，无需再经过 LLM，延迟降至微秒级。

```
首次调用（LLM 桥接）:
Main Agent → 近似模型格式 → [Sub Agent LLM 转换] → 设备真实 API

后续调用（Pads 编译执行）:
Main Agent → 近似模型格式 → [Pads 代码转换] → 设备真实 API
```

### Pads 安全性：AST 级静态分析

Pads 代码由 Sub Agent 侧的 LLM 生成，而 Sub Agent 是不受信任的——因此 Pads 本质上也是不受信任的代码。我们通过以下机制保证安全：

**1. Elixir AST 白名单校验**

在 Pads 代码加载执行之前，Server 对其 Elixir 源码进行 AST（抽象语法树）解析，执行白名单校验：

```elixir
# 允许的模块白名单
@allowed_modules [
  :json, Enum, List, Map, String, Integer, Float,
  Keyword, Tuple, MapSet, Regex, Base
]

# AST 遍历：检查所有远程调用（Module.function 形式）
defp validate_ast({:., _, [{:__aliases__, _, module_parts}, _func]}, _meta, acc) do
  module = Module.concat(module_parts)
  if module in @allowed_modules do
    {:cont, acc}
  else
    {:halt, {:rejected, module}}
  end
end
```

白名单仅包含纯数据转换模块，禁止以下所有能力：
- **网络 I/O**：`HTTPoison`、`:httpc`、`:gen_tcp`、`:ssl` 等
- **文件系统**：`File`、`Path`、`IO`
- **进程操作**：`Process`、`GenServer`、`Agent`、`Task`
- **系统调用**：`System`、`:os`、`:erlang.open_port`
- **代码加载**：`Code`、`:code`、`Module`
- **ETS / 持久存储**：`:ets`、`:dets`、`Mnesia`

**2. 禁止危险语法结构**

除模块白名单外，AST 校验还拒绝以下语法结构：

| 禁止的结构 | 原因 |
|---|---|
| `apply/3`、`Kernel.apply/3` | 可动态调用任意模块函数，绕过白名单 |
| `:erlang.*` 原子调用 | 直接访问 Erlang BIF，可能触发底层操作 |
| `send/2`、`receive` | 进程间消息传递，可能影响系统其他部分 |
| `spawn`、`spawn_link` | 创建新进程 |
| `Code.eval_string` 等元编程 | 动态生成和执行代码，完全绕过所有检查 |
| 宏定义（`defmacro`） | 编译期代码注入 |
| `String.to_atom/1` | Atom 不被垃圾回收，大量创建可耗尽 BEAM VM 全局 atom table，突破进程隔离边界。需使用 `String.to_existing_atom/1` 替代（仅允许引用已存在的 atom） |

**3. 资源消耗型攻击的容忍策略**

如果恶意 Pads 通过白名单内的操作制造过度资源消耗（如构造巨大列表、深度递归），这类攻击的后果是：
- Pads 执行超时（Server 设置执行时间上限）
- Sub Agent 进程内存超限被 BEAM VM 杀死
- 用户观察到该设备响应异常、超时或频繁离线
- 用户通过 Console App 将该 Sub Agent 和设备移除

这类攻击**无法逃逸到 Main Agent 或其他 Sub Agent**，因为 Pads 运行在 Sub Agent 的独立 Elixir 进程中，BEAM VM 的进程隔离保证了故障边界。其效果等同于设备本身故障——用户会自然地将其淘汰。

**4. Pads 生成后的自动化测试**

Sub Agent 的 LLM 在生成 Pads 代码的同时，还需生成配套的测试用例。Server 在加载 Pads 前执行这些测试，验证格式转换的正确性：

```elixir
# Pads 测试示例
test “converts approximate set_brightness to device set_light_level” do
  input = %{“brightness” => 80}
  expected = %{“level” => 80}
  assert Pads.to_device_format(:set_brightness, input) == expected
end

test “converts device response to approximate model format” do
  device_response = %{“level” => 80, “status” => “ok”}
  expected = %{“brightness” => 80}
  assert Pads.from_device_format(:set_brightness, device_response) == expected
end
```

### 并发与批量提问

为了提升探测效率，Main Agent 可以在以下场景使用并发和批量策略：

**并发提问**：Phase 3–5 中对不同能力维度的探测相互独立，可并行发起。例如同时探测”diagnostic 能力的 States”和”energy 能力的 States”。

**批量提问**：将同一 Phase 内的多个问题合并为一个请求，减少通信轮次。例如将 Phase 4 中多个命令的参数探测打包发送，Sub Agent 批量作答。

**渐进式触发**：大部分深度探测不在设备添加时一次性完成，而是在用户首次触及相关功能时按需触发，降低初始接入延迟。


