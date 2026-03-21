# AI Agent 能力探测协议

在 AI Agent 的使用过程中，我们经常会碰到这样的问题：这个 Sub Agent 是来自于社区的，如何避免使用它的过程中，对我们当前的 Main Agent 造成危害？

首先我们要知道如何使用这个 Sub Agent，就是说它有哪些能力。然后我们还要思考如何调用这些能力，以避免调用过程对我们当前的 Main Agent 决策产生危害。

OHAI 协议中，我们给出如下方案：

- Main Agent 与 Sub Agent 的工作环境以及 LLM 上下文完全隔离，Agent 之间只能通过消息传递进行沟通。
- Main Agent 调用 Sub Agent 时，需要给出预期的返回值格式，并通过程序代码严格限制和校验这个返回值，拒绝处理来自 Sub Agent 的包含任何 “自由文本“ 的返回值。

这样两项原则就可以保证 Sub Agent 的运行完全不会影响 Main Agent 的行为，因为上下文是隔离的，不存在上下文污染的可能性；并且 Sub Agent 的一切返回值都是 Main Agent 所预期的。

在实践中，我们会发现如下问题：

- Main Agent 必须知道获取 Sub Agent 的能力列表，这样才知道什么时候应该调用它/如何调用它。
- 最简单地，我们可以通过 Sub Agent 暴露的 API 来获取其完整的能力列表。但这等同于完全信任 Sub Agent，其返回的能力内容是不受控制的，是可能对 Main Agent 造成提示词注入攻击的。
- 或者我们可以让用户来阅读 Sub Agent 的官方文档，自行把 Sub Agent 的能力填写到 Main Agent 中，这样就完成了人为的合法性校验。但是这样既麻烦，又容易出错，当用户警惕性不足，或者因为列表太长而放松警惕时，就容易复制粘贴整个 Sub Agent 的文档，导致这一层校验失效。

本文就着眼于此，设计一个安全协议，用“探索“的方式，获取一个不受信任的 Sub Agent 的能力。

## “解码你“ 社交游戏

### 游戏规则

为了解释协议的工作原理，让我们设计一个有趣的社交游戏，叫做 “解码你“。

这个游戏中，有 A，B 两个人互动，其中 B 是 A 倾慕的对象。现在要求 A 通过提问的方式，了解 B 的性格/喜好等等个人信息，但有限制：

1. A 提问，B 回答，但是 A 的题目只能是选择题，B 只能选 A 给出的预设的答案中的某一个或者多个（多选题）。
2. 预设答案中，可以存在一个 “other” 选项。如果 B 选了 “other”，A 为了获取更准确的信息，需要再问一轮，可能需要设计更多的选项，也可以修改提问方式。

游戏的规则是：

- A 每一轮的提问内容完全随意，只是答案选项是 A 预置的，B 无法自由回答。
- 考虑到 B 的耐心有限，每一轮的选项最多只能有 8 个，包括 “other”。
- 考虑到双方的精力有限，一共只能询问 20 轮。

这个社交游戏实际上是对 A 的考验，请问 A 如何设计题目，就能在规则限制下，获得对 B 最准确的了解？

### 游戏最优策略分析

1. 首先，我们的答案设置尽量是一种程度，或者询问对方对某事情的态度，而不是具体选项。比如：

**DO NOT：**

“你最喜欢的运动是？“
A. 篮球 B. 足球 C. 游泳 D. 跑步 E. 瑜伽 F. 网球 G. 健身 H. Other

**DO：**

“你对运动的热情程度？“
A. 运动狂人，几乎每天 B. 规律运动，每周3-4次 C. 偶尔运动 D. 只在社交场合运动 E. 完全不运动，但不排斥 F. 讨厌运动 G. 想运动但总是拖延 H. Other

这里的关键是，程度/态度这种问题的答案是有限的，7 个选项比较容易穷尽，但是具体的运动中了就非常多，很难命中。

2. 类似地，我们建议用 “场景选择“ 代替 “直接提问“：

**DO NOT：**

你的性格是？（太抽象，对方会觉着每个选项都不太准确）

**DO：**

周五晚上，你最可能在做什么？（这样我们使用更加具体的场景，让 B 更容易对号入座，然后我们从答案中反推出其真实性格）

A. 和一群朋友在外面嗨 B. 和1-2个好友安静吃饭 C. 一个人在家看剧/打游戏 D. 加班/学习 E. 跟伴侣约会 F. 运动/健身 G. 已经睡了 H. Other

3. 其次，二分法递进式缩小答案的范围，最终获取我们的答案。

假设第 N 轮我们问：你最喜欢的解压方式？然后 B 选了 Other
那么第 N+1 轮我们可以这样问：你没选的那个解压方式，它是...
  A. 需要独处的    B. 需要别人陪
  C. 在室内的      D. 在室外的  
  E. 花钱的        F. 不花钱的
  G. 身体参与的    H. 纯精神层面的

这一轮虽然没有直接得到答案，但获取了更多的分类，大大缩小了下一轮的搜索空间。

我们建议分两步设计题目：

1. 第一步，建立对方的快速画像（1-7轮），对方回答 other 率比较低：

| 轮次 | 问题方向 | 设计思路 |
|------|---------|---------|
| 1 | 内向 <-> 外向光谱 | 程度型，7档光谱 |
| 2 | 人生当前最重要的事 | 场景型（事业/爱情/家庭/自由/健康/成长/快乐） |
| 3 | 社交风格 | 场景型（周末怎么过） |
| 4 | 冲突处理方式 | 场景型（和朋友意见不合时...） |
| 5 | 对「变化」的态度 | 程度型光谱 |
| 6 | 审美/品味倾向 | 风格选择型 |
| 7 | 爱情中最看重的 | 排序型（选最重要的一项） |

2. 第二步，我们根据第一步的回答，选择性深挖（后面几轮）。

比如第一步我们判断 B 偏内向，所以我们可以继续问 "独处时最享受的状态"：

A. 沉浸在书/电影里 B. 打游戏/刷手机 C. 做手工/画画/写字 D. 听音乐发呆 E. 研究某个感兴趣的话题 F. 做饭/整理房间 G. 什么都不做纯放空 H. Other

综上，题目的设计原则是：

1. 问态度和程度，不问具体事物（极大降低 other 率） 
2. 问行为场景，不问抽象概念（B 容易作答，信息更真实）
3. 后半程的选项要基于前半程的回答设计 （自适应 = 信息效率最大化）
4. 触发 other 时用属性二分法，别再猜（止损策略）
5. 每个选项之间要互斥且穷尽（减少 B 的纠结，提高回答质量）

## Agent 能力探测协议详解

你肯定已经意识到了，上面这个游戏只是我们协议工作原理的一个形象的模拟，其中 A 是我们的 Main Agent，而 B 是那个不受信任的，可能存在提示词注入风险的 Sub Agent。

A 需要了解 B 有哪些能力，以便在合适的时候将合适的任务分配给 B 去做，但是 A 显然不能直接询问 B “你有哪些能力”，因为这样 B 可以注入一些恶意的提示词，对 A 造成安全隐患。

A 需要尽可能全面了解 B 有哪些 API 可以调用，并且 API 的返回值是什么样式，但不需要特别准确。了解了这些信息之后，A 会在运行时调用 B，指定 API 名称，参数，以及期望的返回格式。返回格式由 Schema 描述，A 会限制 Schema 不能包含自由文本，即不能包含 string 类型的数据，只能是 enum 等由 A 预设的内容）。B 在执行完 API 任务之后，需要按照 A 给出的返回格式做出回复，A 会用程序代码校验 Schema 是否符合。

开始阶段，第三方（用户）会知道 B 大概是一个什么样的 Agent，并将这个初始信息告诉 A。比方说 “B 是个控制客厅吊灯的 Agent”。然后 A 会对 B 进行多轮询问来了解 B 的能力，对 B 做一个能力画像，以设计出一套 (API+参数) -> (Response Schema) 的列表。后续 A 就会根据这个能力画像将合适的任务路由给 B，并且校验 B 的返回内容，避免 B 返回的内容包含自由文本，被注入到上下文中造成风险。

之前的游戏实际上就是这个问题的一个模拟，询问阶段 B 只能选择 A 预设的一个答案，B 如果自由回答显然会被 A 的程序化校验禁止。B 当然可以谎报自己的能力，它可能会选一个自己没有的能力作为答案，但是这样用户通过 A 使用 B 的时候，会发现 B 的行为非常奇怪，就会不再信任 B，将 B 这个 Agent 抛弃，重要的是，这个过程中，B 的行为没有影响到 A，因为两者的上下文是完全隔离的。

在游戏中，我们限制总的提问轮数，是因为这个过程不能无限长；每一轮的答案个数也被限制，是因为 B 的大模型的上下文处理窗口有限，也很难准确处理过多的答案选项。但对于 LLM 来说，显然轮数和每一轮的答案数都可以比真人互动的游戏要多得多。

我们的协议要保证的是，在任何时刻，B 产生的所有输出都经过 A 的程序化校验（Schema Validation），B 的自由文本永远不会进入 A 的上下文。

我们考虑以下攻击方式，以及我们的协议是如何防御的：

| 攻击向量 | 方案如何防御 | 评估 |
|---------|----------------|------|
| B 在能力探测阶段注入恶意文本 | B 只能选择 A 预设的选项，Schema 校验拒绝自由文本 | ✅ 完全防御 |
| B 在运行时返回中注入恶意文本 | Response Schema 不允许 string 类型，只有 enum/number/boolean | ✅ 完全防御 |
| B 谎报能力（声称能做不能做的事） | 用户发现行为异常后抛弃 B，B 无收益 | ✅ 博弈论上 B 没有动机 |
| B 隐瞒能力（不报告真实能力） | B 被分配更少任务，降低自身价值，无收益 | ✅ 博弈论上 B 没有动机 |
| B 在 enum 选择中编码隐蔽信息 | 所有 enum 值由 A 预定义，B 无法自定义值 | ✅ 信道受控 |

### Sub Agent 可以接受模糊的 API 调用

因为 Sub Agent 自带 LLM 能力，所以我们调用 Sub Agent 的时候，实际上没必要精准地调用 Sub Agent 提供的 API：

假设 Sub Agent 提供了一个设置灯具亮度的 API，接收一个整型的百分比亮度值，返回 API 执行过后新的亮度值：

```json
{
    "apis": [
        {
            "name": "set_light_brightness",
            "inputSchema": {
                "title": "亮度参数",
                "description": "控制灯光亮度的输入参数",
                "type": "object",
                "properties": {
                    "brightness": {
                        "type": "integer",
                        "description": "目标亮度值（百分比）",
                        "minimum": 1,
                        "maximum": 100
                    }
                },
                "required": ["brightness"],
                "additionalProperties": false
            },
            "outputSchema": {
                "title": "返回值",
                "description": "执行完毕后返回当前灯光的实际亮度",
                "type": "object",
                "properties": {
                    "brightness": {
                        "type": "integer",
                        "description": "当前灯光的实际亮度值（百分比）",
                        "minimum": 1,
                        "maximum": 100
                    }
                },
                "required": ["brightness"],
                "additionalProperties": false
            }
        }
    ]
}
```

而我们的 Main Agent 可以这样调用 Sub Agent：

```json
{
    "request": "control_brightness",
    "input": "90%",
    "expectedSchema": {
        "title": "期望的返回值",
        "description": "返回成功与否",
        "type": "boolean",
        "properties": {
            "success": {
                "type": "boolean",
                "description": "操作是否成功"
            }
        },
        "required": ["success"],
        "additionalProperties": false
    }
}
```

请注意，"control_brightness" 跟 Sub Agent 提供的 "set_light_brightness" API 只是类似，但并不完全一致。

Main Agent 只需要关心操作是否成功，而不需要获取具体的亮度值，"control_brightness" 到 "set_light_brightness" 的转换过程由 Sub Agent 使用 LLM 来完成。Main Agent 只需要验证 Sub Agent 返回的结果是否符合预期的 Schema（在这个例子中是一个简单的 boolean），而不需要关心 Sub Agent 内部是如何实现的，也不需要关心 Sub Agent 的 API 定义是什么样子的。

API 的转换过程需要用到 LLM，就会带来秒级的时延。关于如何优化这个 API 的转换过程，我们会在后续的章节中进行详细的讨论。

### "探索式" 获取 Sub Agent 的能力

在上面的讨论中，`set_light_brightness` 是 Sub Agent 提供的原始 API，而 `control_brightness` 是 Main Agent 通过探索，基于 Sub Agent 的能力画像，设计出的一个接近原始 API 的、更符合 Main Agent 需求的 API。

如何设计这个探索的过程，使其既能尽可能构建完整，准确的 API，又能保证效率？

参考上面的 “解码你“ 游戏，我们可以设计一个类似的、分层次的探索流程，比如：

Layer 0: 领域确认          (1-2 轮)
Layer 1: API 大类发现       (2-4 轮)  
Layer 2: 具体 API 枚举       (3-6 轮，每个大类)
Layer 3: 参数探测           (每个API 2-4 轮)
Layer 4: 返回值探测         (每个API 1-3 轮)
Layer 5: 约束条件探测       (1-2 轮)

#### Layer 0: 领域确认

用户已经告诉 A，「B 是控制客厅吊灯的 Agent」，A 先确认领域：

```json
// A asks:
{
    "question": "Which domain best describes your primary function?",
    "options": [
        "smart_home_lighting",
        "smart_home_climate",
        "smart_home_security",
        "smart_home_entertainment",
        "smart_home_appliance",
        "industrial_control",
        "other"
    ]
}

// B responds:
{ "answer": "smart_home_lighting" }
```

这一轮的设计逻辑：

- A 根据用户提供的描述「客厅吊灯」预生成相关领域选项
- 选项基于 A 内部的领域本体知识库(Ontology)
- 如果 B 选了 other，A 消耗一轮用更细分的领域选项再问

#### Layer 1: API 大类发现

首先询问一共有多少 API。因为返回值是一个数字，不会影响我们的协议的安全性：

```json
// A asks:
{
    "question": "How many APIs do you provide?",
    "return_type": "integer"
}
```

A 根据领域知识库预设该领域常见的 API 大类选项：

```json
// A asks:
{
    "question": "Which categories of operations can you perform?",
    "multiple_select": true,    // 注意：允许多选
    "max_selections": 7,
    "options": [
        "power_control",        // 开关
        "brightness_control",   // 亮度
        "color_control",        // 颜色
        "color_temperature",    // 色温
        "scheduling",           // 定时
        "scene_mode",           // 场景模式
        "status_query",         // 状态查询
        "other"
    ]
}

// B responds:
{ "answer": ["power_control", "brightness_control", "color_temperature", "status_query"] }
```

注意这里用了多选。

这等价于 7 个独立的 yes/no 问题，比单选效率高得多。这是因为能力探测天然是一个「具备/不具备」的集合问题，多选天然匹配。

#### Layer 2: 具体API 枚举

对 Layer 1 中 B 报告具备的每个大类，逐一深挖：

```json
{
    "question": "For power_control, which specific operations are supported?",
    "multiple_select": true,
    "options": [
        "turn_on",
        "turn_off",
        "toggle",
        "delayed_on",
        "delayed_off",
        "other"
    ]
}

{
    "question": "For brightness_control, which specific operations are supported?",
    "multiple_select": true,
    "options": [
        "set_absolute_brightness",
        "increase_brightness",
        "decrease_brightness",
        "fade_to_brightness",
        "get_current_brightness",
        "other"
    ]
}
```

#### Layer 3: 参数探测

对每个具体工具，探测它的参数：

```json
// A asks:
{
    "question": "For set_absolute_brightness, what is the parameter type for brightness level?",
    "options": [
        "integer_with_range",
        "float_with_range",
        "enum_low_medium_high",
        "percentage",
        "other"
    ]
}

// B responds:
{ "answer": "integer_with_range" }
```

这里体现了之前游戏中，“问程度/类别而非具体事物“ 的策略。A 不问 "参数是什么"（开放式），而是给出常见的参数类型让 B 选择。A 的 Ontology 知识库中预存了各领域常见的参数规格。

#### Layer 4: 返回值探测

先问返回值的信息个数：

```json
{
    "question": "For set_absolute_brightness, how many fields are included in the response?",
    "return_type": "integer"
}
```

然后问大概包含哪些字段：

```json
{
    "question": "After executing set_absolute_brightness, which fields are included in the response?",
    "multiple_select": true,
    "options": [
        "success_boolean",
        "actual_brightness_value",
        "previous_brightness_value",
        "timestamp",
        "error_code_enum",
        "device_state_enum",
        "other"
    ]
}

// B responds:
{ "answer": ["success_boolean", "actual_brightness_value"] }
```

#### Layer 5: 约束条件探测

最后探测一些特殊的约束条件：

```json
{
    "question": "What is your typical response latency?",
    "options": [
        "under_100ms",
        "100ms_to_500ms",
        "500ms_to_1s",
        "1s_to_5s",
        "over_5s",
        "varies_widely",
        "other"
    ]
}
```

## 探索效率优化

### 尽量使用自定义 API

我们思考一下我们平常的系统是如何使用 API 的？

因为 Main Agent 可以使用自定义的 API 名称和参数格式来调用 Sub Agent，所以 Main Agent 不需要完全猜测出 Sub Agent 原来的 API 长什么样子，只需要功能接近，数目完整，并且返回信息已经足够当前需求使用就够了。

比如在获取 `set_absolute_brightness` 这个 API 的返回值的时候，Main Agent 可能只关心成功与否，可以直接问：

```json
{
    "question": "After executing set_absolute_brightness, I want the return value to include only a single boolean field indicating success or failure. Is this feasible?",
    "multiple_select": false,
    "options": [
        "yes", "no"
    ]
}
```

那么即使 Sub Agent 原来的 API 返回了很多字段，Main Agent 也不关心了，所以不需要进一步探测了，它可以直接这样调用 Sub Agent：

```json
{
    "request": "set_brightness_simple",
    "expectedSchema": {
        "title": "期望的返回值",
        "description": "返回成功与否",
        "type": "object",
        "properties": {
            "success": {
                "type": "boolean",
                "description": "操作是否成功"
            }
        },
        "required": ["success"],
        "additionalProperties": false
    }
}
```

### Agent Pads

Pads 是连接 Main Agent 和 Sub Agent 之间的适配器，负责将 Main Agent 的模糊 API 调用转换成 Sub Agent 的具体 API 调用，以及将 Sub Agent 的返回值转换成 Main Agent 预期的格式。

Pads 是由 Sub Agent 在能力探索阶段完成后，借助大模型的编程能力自动生成的。需要注意的是，Pads 当中的 Elixir 代码是受限制的，只能用于数据转换，无法使用比如网络，文件系统等 I/O 操作，以保证安全性。这可以通过程序代码检查 Pads 的 AST 来保证：除了 :json，Enum，List，String，Base 等少数几个模块外，不能使用其他模块。

LLM 还会编写测试用例来保证 Pads 数据处理的正确性。

#### Pads 的安全性

因为在编写 Pads 的过程中需要读取 Sub Agent 的能力信息，所以 Pads 可以看作是由 Sub Agent 编写的，所以它的安全性和 Sub Agent 是一致的：也是不被信任的代码。
Pads 是运行在 Sub Agent 进程中的，我们使用 Elixir 进程来隔离 Sub Agent，也就隔离了 Pads。

### 并发提问

### 批量提问


