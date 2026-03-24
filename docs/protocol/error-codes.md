# 错误码规范

本文档定义 OHAI 协议的完整错误码体系。所有设备回复中的 `error.code` 和 `error.message` 必须从本文档定义的封闭枚举中选取，不允许自定义扩展。

## 设计原则

### 为什么不允许自定义错误

OHAI 的错误码采用 **封闭枚举** 设计——设备只能从预定义列表中选取，不能自定义错误码、错误类型或附加自由文本。这一决策基于以下考量：

1. **AI 安全**：错误信息会被 AI 引擎读取和处理。如果允许设备传递任意字符串，恶意或被攻破的设备可以通过错误回复向 AI 引擎注入提示词攻击（Prompt Injection），影响 AI 决策。封闭枚举确保 AI 引擎只会收到预定义的、安全的错误标识符。
2. **语义确定性**：AI 引擎和自动化引擎需要对错误做出响应（重试、告警、回退）。封闭枚举让错误语义完全确定，不存在理解歧义。
3. **可证明的完备性**：错误码不是通过归纳"别的协议有什么"得出的，而是通过对命令执行管线的演绎推导得出的——管线的每个阶段是命令成功的必要条件，每个错误码对应一个必要条件的否定（见[错误码完备性论证](./error-code-completeness-proof.md)）。
4. **诊断分离**：详细的故障诊断信息（电机堵转电流值、传感器漂移量等）应走设备日志/厂商诊断通道，不属于协议级错误码的职责。

### 编码格式

OHAI 沿用 [JSON-RPC 2.0](https://www.jsonrpc.org/specification) 的错误码体系，使用有符号整数：

| 范围 | 分配 |
|---|---|
| `-32700` ~ `-32600` | JSON-RPC 2.0 标准保留（协议层错误，Server 生成） |
| `-32000` ~ `-32099` | OHAI 设备错误（本文档定义，设备回复） |

`error.code` 和 `error.message` **严格一一对应**。Server 校验回复时检查两者匹配，不匹配则丢弃该回复并记录日志。

---

## JSON-RPC 2.0 标准错误码

以下错误码由 JSON-RPC 2.0 规范保留，对应管线阶段①②。由 **Server 检测并生成**，设备不会返回这些错误码。

| 错误码 | 错误类型 | 管线阶段 | 说明 |
|---|---|---|---|
| `-32700` | `PARSE_ERROR` | ① 消息解码 | 消息不是合法的 CBOR/JSON |
| `-32600` | `INVALID_REQUEST` | ① 消息解码 | 消息结构不符合 JSON-RPC 2.0 规范 |
| `-32601` | `METHOD_NOT_FOUND` | ② 命令路由 | `method` 中指定的能力或命令不存在 |
| `-32602` | `INVALID_PARAMS` | ② 命令路由 | `params` 不符合命令的 JSON Schema 定义 |
| `-32603` | `INTERNAL_ERROR` | — | Server 内部错误（不属于设备管线） |

---

## OHAI 设备错误码

以下错误码由 **设备在命令回复中返回**，对应管线阶段③~⑦。设备固件必须从此列表中选择，不允许使用列表之外的错误码。

每个错误码标注了 **重试策略**，指导 Server 和 AI 引擎的后续行为：

| 重试策略 | 含义 |
|---|---|
| **可重试** | 瞬态故障，Server 可自动退避重试 |
| **条件重试** | 当前不行，但条件改变后可能成功；不自动重试，报告 Client |
| **不重试** | 永久性失败或需人工介入，报告 Client |

### 阶段③ 参数校验（-32020 ~ -32029）

命令参数的值虽然通过了 Server 端 JSON Schema 校验，但设备在运行时判定不可接受。与 JSON-RPC 层的 `-32602 INVALID_PARAMS`（Schema 校验失败）不同——参数结构合法，但语义上不被当前设备接受。

| 错误码 | 错误类型 | 重试 | 说明 | 参考来源 |
|---|---|---|---|---|
| `-32020` | `VALUE_OUT_OF_RANGE` | 不重试 | 参数值超出设备实际支持的范围。Schema 定义的范围是标准能力的通用范围，设备的实际支持范围可能更窄（如某灯泡亮度最低只能到 10%，无法设为 5%）。 | gRPC `OUT_OF_RANGE`; Matter `CONSTRAINT_ERROR`; Zigbee `INVALID_VALUE` |
| `-32021` | `VALUE_NOT_ACCEPTED` | 不重试 | 参数值在有效范围内，但设备无法接受该特定值（如某空调只支持整度调节，收到 22.5°C；或设备只支持特定步进值）。 | Matter `CONSTRAINT_ERROR`; CoAP `4.22 Unprocessable Entity` |
| `-32022` | `INCOMPATIBLE_PARAMS` | 不重试 | 参数组合相互矛盾或不兼容（如同时设置制冷模式和 30°C 目标温度）。单个参数各自合法，但组合在一起语义矛盾。 | gRPC `INVALID_ARGUMENT`; HTTP `422 Unprocessable Entity` |

### 阶段④ 能力检查（-32030 ~ -32039）

设备不支持此操作或请求的功能。这是永久性的——重试不会改变结果（除非固件升级）。

| 错误码 | 错误类型 | 重试 | 说明 | 参考来源 |
|---|---|---|---|---|
| `-32030` | `COMMAND_NOT_SUPPORTED` | 不重试 | 设备不支持此命令。可能是固件版本过低尚未实现，或硬件不具备该功能。 | gRPC `UNIMPLEMENTED`; Matter `UNSUPPORTED_COMMAND`; Modbus `ILLEGAL_FUNCTION` |
| `-32031` | `MODE_NOT_SUPPORTED` | 不重试 | 请求的模式不被设备支持（如空调不支持送风模式、灯泡不支持呼吸灯效果）。 | Matter `UNSUPPORTED_MODE` |
| `-32032` | `COMMAND_IGNORED` | 不重试 | 设备接收并理解了命令，但主动选择忽略（如幂等命令的目标状态已与当前状态一致，设备无需动作）。这不是错误，而是一种正常的"无操作"回复。 | Matter `WRITE_IGNORED` |

### 阶段⑤ 前置条件（-32010 ~ -32019）

设备支持该命令且参数合法，但当前状态不允许执行。当阻碍条件消除后，同样的命令可能成功。

| 错误码 | 错误类型 | 重试 | 说明 | 参考来源 |
|---|---|---|---|---|
| `-32010` | `INVALID_STATE` | 条件重试 | 设备当前工作模式不允许此操作（如空调处于除霜模式时不能切换制冷/制热、洗衣机运行中不能开门）。 | gRPC `FAILED_PRECONDITION`; Matter `INVALID_IN_STATE`; HomeKit `NOT_ALLOWED_IN_CURRENT_STATE` |
| `-32011` | `NOT_READY` | 条件重试 | 设备尚未就绪（正在启动、初始化中、固件升级中等）。与 `INVALID_STATE` 的区别：`NOT_READY` 是设备尚未进入可工作状态，`INVALID_STATE` 是设备已就绪但当前模式不允许。 | OPC UA `BadNotReady` |
| `-32012` | `NOT_CONFIGURED` | 条件重试 | 设备未完成初始配置，无法执行命令（如智能锁未录入指纹、空调未设定初始温度范围、传感器未完成首次校准设置）。与 `NOT_READY` 的区别：`NOT_READY` 是临时性的（等一会就好），`NOT_CONFIGURED` 是永久性的（需用户主动配置）。 | OPC UA `BadConfigurationError` |
| `-32013` | `CALIBRATING` | 条件重试 | 设备正在执行校准流程，校准完成前无法执行常规命令。 | Zigbee `CALIBRATION_ERROR`; OPC UA `UncertainSensorNotAccurate` |
| `-32014` | `DEPENDENCY_NOT_MET` | 条件重试 | 命令执行依赖的前置条件未满足（如需先开启电源才能调亮度、需先解锁才能开门）。 | gRPC `FAILED_PRECONDITION` |
| `-32015` | `SAFETY_INTERLOCK` | 条件重试 | 安全联锁机制阻止执行。设备的安全保护逻辑主动拒绝了命令（如热水器水温过高时拒绝加热、儿童锁激活时拒绝操作、环境温度超出安全运行范围）。 | Zigbee `ACTION_DENIED`; OPC UA `BadRequestNotAllowed` |
| `-32016` | `PHYSICALLY_OBSTRUCTED` | 条件重试 | 物理障碍阻止命令执行（如车库门运行路径被阻挡、窗帘卡轨、阀门被异物卡住、门锁锁舌被挡）。设备检测到机械运动无法完成。移除障碍物后重试即可成功。 | Modbus `NEGATIVE_ACKNOWLEDGE` |
| `-32017` | `CONCURRENT_MODIFICATION` | 条件重试 | 操作被并发修改中断。设备检测到状态在命令执行过程中被其他来源修改（如物理按键操作、另一个命令抢占）。 | gRPC `ABORTED`; HTTP `409 Conflict` |

### 阶段⑥ 资源获取（-32000 ~ -32009）

前置条件满足，但设备缺少执行所需的资源。资源分为 **计算资源**（CPU、内存、队列）和 **物理资源**（子设备、耗材）。瞬态性质——资源释放或补充后可恢复。

| 错误码 | 错误类型 | 重试 | 说明 | 参考来源 |
|---|---|---|---|---|
| `-32000` | `DEVICE_BUSY` | 可重试 | 设备正在执行其他操作，无法处理当前命令。Server 可稍后重试。 | gRPC `UNAVAILABLE`; Matter `BUSY`; Modbus `SERVER_DEVICE_BUSY` |
| `-32001` | `DEVICE_OVERLOADED` | 可重试 | 设备处理能力过载，当前无法接受更多请求。与 `DEVICE_BUSY` 的区别：`BUSY` 是正在执行单个操作，`OVERLOADED` 是系统整体负荷过高。 | MQTT `0x89 Server Busy`; OPC UA `BadTooManyOperations` |
| `-32002` | `RESOURCE_EXHAUSTED` | 可重试 | 设备计算资源耗尽（内存不足、存储已满、队列溢出、内部连接数达上限等）。 | gRPC `RESOURCE_EXHAUSTED`; Matter `RESOURCE_EXHAUSTED`; OPC UA `BadOutOfMemory` |
| `-32003` | `RATE_LIMITED` | 可重试 | 设备因命令频率过高而拒绝执行。设备可能有内部速率限制以保护硬件（如电机频繁启停保护）。 | HTTP `429`; CoAP `4.29 Too Many Requests` |
| `-32004` | `CHILD_DEVICE_UNREACHABLE` | 可重试 | 桥接器/网关设备无法联络下挂的子设备或被控设备（如 Zigbee 网关联络不到子设备、红外转发器联络不到目标设备）。桥接器本身正常，但执行目标不可达。 | HomeKit `ACCESSORY_NOT_REACHABLE`; Modbus `GATEWAY_TARGET_DEVICE_FAILED_TO_RESPOND` |
| `-32005` | `CONSUMABLE_DEPLETED` | 可重试 | 执行所需的物理耗材/消耗品耗尽（如滤网需更换、洗涤剂用完、墨盒空、扫地机尘盒满、加湿器水箱空）。与 `RESOURCE_EXHAUSTED`（计算资源）不同，这是物理消耗品。补充后可恢复。 | OPC UA `BadResourceUnavailable` |

### 阶段⑦ 物理执行（-32040 ~ -32046）

资源就绪，设备开始执行。执行过程中发生的故障，通常需要人工介入或设备自修复。

| 错误码 | 错误类型 | 重试 | 说明 | 参考来源 |
|---|---|---|---|---|
| `-32040` | `HARDWARE_FAULT` | 不重试 | 通用硬件故障（电机堵转、继电器卡死、通信总线错误等）。设备检测到内部硬件异常，无法执行命令。 | Zigbee `HARDWARE_FAILURE`; OPC UA `BadDeviceFailure`; Modbus `SERVER_DEVICE_FAILURE` |
| `-32041` | `SENSOR_FAULT` | 不重试 | 传感器故障（温度传感器读数异常、湿度传感器无响应等）。单独列出是因为传感器故障在 IoT 场景中极为常见，且处理方式不同——传感器故障可能只影响读数不影响控制。 | OPC UA `BadSensorFailure`; Zigbee `CALIBRATION_ERROR` |
| `-32042` | `POWER_ISSUE` | 不重试 | 电源相关问题（电池电量过低无法执行高功耗操作、供电不稳定、UPS 切换中等）。 | OPC UA `BadResourceUnavailable` |
| `-32043` | `PERIPHERAL_FAULT` | 不重试 | 外设或子模块故障（如喂食器的机械结构卡住、窗帘电机断线、打印模块异常等）。用于设备内部某个特定执行部件故障，而非整体设备不可用。 | OPC UA `BadDeviceFailure`; Modbus `SERVER_DEVICE_FAILURE` |
| `-32044` | `SOFTWARE_FAULT` | 不重试 | 固件/软件执行异常（看门狗触发、内部任务崩溃、固件模块异常等）。与 `HARDWARE_FAULT` 的区别：软件故障可能通过重启恢复，硬件故障需要维修或更换。 | Zigbee `SOFTWARE_FAILURE` |
| `-32045` | `DEVICE_TIMEOUT` | 不重试 | 设备内部操作超时（如等待电机到位、传感器响应、子模块应答）。不同于 Server 端超时——此错误表示设备自身检测到内部操作未在预期时间内完成。 | gRPC `DEADLINE_EXCEEDED`; Matter `TIMEOUT`; Zigbee `TIMEOUT` |
| `-32046` | `MANUAL_ACTION_REQUIRED` | 不重试 | 设备检测到需要人工物理介入才能继续（如打印机卡纸需清理、排水泵水箱已满需倒水、烘干机绒毛滤网堵塞需清洁、扫地机被困需搬离）。与 `HARDWARE_FAULT` 的区别：硬件没坏，只是需要人去处理一下。 | OPC UA `BadConditionDisabled` |

---

## 错误回复格式

设备命令执行失败时，按 JSON-RPC 2.0 错误格式回复。**不包含 `data` 字段**：

```jsonc
{
  "jsonrpc": "2.0",
  "id": "msg-a1b2c3",
  "error": {
    "code": -32010,                // OHAI 错误码（从封闭枚举中选取）
    "message": "INVALID_STATE"     // 与 code 严格对应的错误类型字符串
  }
}
```

**格式约束**：

1. `error.code` 必须是本文档定义的错误码之一
2. `error.message` 必须是与 `code` 对应的错误类型字符串（全大写、下划线分隔）
3. **不允许** `error.data` 字段——任何包含 `data` 字段的错误回复将被 Server 丢弃
4. `error.message` 是机器可读的标识符，不是人类可读的描述。人类可读的错误描述由 Server 根据错误码和上下文生成

---

## Server 端处理规则

### 校验与丢弃

Server 收到设备的错误回复后，执行以下校验：

1. `error.code` 必须在已知枚举范围内（`-32700`~`-32600` 或 `-32000`~`-32046`）
2. `error.message` 必须与 `error.code` 严格匹配
3. 不得包含 `error.data` 字段

校验失败的回复被 **静默丢弃** 并记录安全日志。这确保任何试图通过错误回复注入非预期内容的尝试都会被拦截。

### AI 引擎上下文注入

当 AI 引擎需要了解命令执行结果时，Server 将错误码转换为标准化的自然语言描述注入 LLM 上下文。描述文本由 Server 内部维护，**不来自设备**：

```
命令 ohai.brightness:set_brightness 执行失败。
错误：INVALID_STATE — 设备当前状态不允许此操作。
建议：检查设备是否处于特殊工作模式，待模式切换后重试。
```

这一机制保证了 AI 引擎接收到的所有文本都是 Server 预生成的安全内容，设备无法通过错误回复影响 AI 行为。

### 重试策略

Server 根据错误码的重试策略和命令类型决定重试行为：

| 重试策略 | `state_cmd` | `instant_cmd` | `once_cmd` |
|---|---|---|---|
| **可重试** | 自动重试（指数退避，最多 2 次） | 不重试（即时命令过期即丢弃） | 不重试（防止重复执行） |
| **条件重试** | 不自动重试，报告 Client | 不重试 | 不重试，报告 Client |
| **不重试** | 报告 Client（硬件类同时告警） | 不重试 | 报告 Client（硬件类同时告警） |

---

## 完整错误码速查表

### JSON-RPC 2.0 标准错误码（Server 生成）

| 错误码 | 错误类型 | 管线阶段 | 说明 |
|---|---|---|---|
| `-32700` | `PARSE_ERROR` | ① 消息解码 | 消息解析失败 |
| `-32600` | `INVALID_REQUEST` | ① 消息解码 | 无效的请求结构 |
| `-32601` | `METHOD_NOT_FOUND` | ② 命令路由 | 方法不存在 |
| `-32602` | `INVALID_PARAMS` | ② 命令路由 | 参数 Schema 校验失败 |
| `-32603` | `INTERNAL_ERROR` | — | Server 内部错误 |

### OHAI 设备错误码（设备回复）

| 错误码 | 错误类型 | 管线阶段 | 重试 | 说明 |
|---|---|---|---|---|
| `-32000` | `DEVICE_BUSY` | ⑥ 资源获取 | 可重试 | 设备忙碌 |
| `-32001` | `DEVICE_OVERLOADED` | ⑥ 资源获取 | 可重试 | 设备过载 |
| `-32002` | `RESOURCE_EXHAUSTED` | ⑥ 资源获取 | 可重试 | 计算资源耗尽 |
| `-32003` | `RATE_LIMITED` | ⑥ 资源获取 | 可重试 | 命令频率过高 |
| `-32004` | `CHILD_DEVICE_UNREACHABLE` | ⑥ 资源获取 | 可重试 | 子设备不可达 |
| `-32005` | `CONSUMABLE_DEPLETED` | ⑥ 资源获取 | 可重试 | 耗材/消耗品耗尽 |
| `-32010` | `INVALID_STATE` | ⑤ 前置条件 | 条件重试 | 当前状态不允许 |
| `-32011` | `NOT_READY` | ⑤ 前置条件 | 条件重试 | 设备未就绪 |
| `-32012` | `NOT_CONFIGURED` | ⑤ 前置条件 | 条件重试 | 设备未完成初始配置 |
| `-32013` | `CALIBRATING` | ⑤ 前置条件 | 条件重试 | 正在校准 |
| `-32014` | `DEPENDENCY_NOT_MET` | ⑤ 前置条件 | 条件重试 | 前置条件未满足 |
| `-32015` | `SAFETY_INTERLOCK` | ⑤ 前置条件 | 条件重试 | 安全联锁阻止 |
| `-32016` | `PHYSICALLY_OBSTRUCTED` | ⑤ 前置条件 | 条件重试 | 物理障碍阻止 |
| `-32017` | `CONCURRENT_MODIFICATION` | ⑤ 前置条件 | 条件重试 | 并发修改冲突 |
| `-32020` | `VALUE_OUT_OF_RANGE` | ③ 参数校验 | 不重试 | 参数值超出设备范围 |
| `-32021` | `VALUE_NOT_ACCEPTED` | ③ 参数校验 | 不重试 | 参数值不被接受 |
| `-32022` | `INCOMPATIBLE_PARAMS` | ③ 参数校验 | 不重试 | 参数组合矛盾 |
| `-32030` | `COMMAND_NOT_SUPPORTED` | ④ 能力检查 | 不重试 | 命令不支持 |
| `-32031` | `MODE_NOT_SUPPORTED` | ④ 能力检查 | 不重试 | 模式不支持 |
| `-32032` | `COMMAND_IGNORED` | ④ 能力检查 | 不重试 | 命令被忽略（已在目标状态） |
| `-32040` | `HARDWARE_FAULT` | ⑦ 物理执行 | 不重试 | 硬件故障 |
| `-32041` | `SENSOR_FAULT` | ⑦ 物理执行 | 不重试 | 传感器故障 |
| `-32042` | `POWER_ISSUE` | ⑦ 物理执行 | 不重试 | 电源问题 |
| `-32043` | `PERIPHERAL_FAULT` | ⑦ 物理执行 | 不重试 | 外设/子模块故障 |
| `-32044` | `SOFTWARE_FAULT` | ⑦ 物理执行 | 不重试 | 固件/软件异常 |
| `-32045` | `DEVICE_TIMEOUT` | ⑦ 物理执行 | 不重试 | 设备内部操作超时 |
| `-32046` | `MANUAL_ACTION_REQUIRED` | ⑦ 物理执行 | 不重试 | 需人工物理介入 |

---

## 设计参考

本错误码体系参考了以下协议和系统的错误码设计：

| 协议/系统 | 主要借鉴点 |
|---|---|
| **gRPC** | 错误分类哲学——区分 `FAILED_PRECONDITION`（状态前提）vs `OUT_OF_RANGE`（值越界）vs `INVALID_ARGUMENT`（参数无效）的精确语义划分；重试策略与错误类型的绑定 |
| **Matter** | IoT 设备场景覆盖——`BUSY`、`INVALID_IN_STATE`、`CONSTRAINT_ERROR`、`UNSUPPORTED_MODE`、`WRITE_IGNORED` 等设备交互特有的错误语义 |
| **Zigbee ZCL** | 硬件层错误——`HARDWARE_FAILURE`、`SOFTWARE_FAILURE`、`CALIBRATION_ERROR` 以及 `ACTION_DENIED`（设备策略拒绝，区别于权限不足） |
| **HomeKit HAP** | 状态与可达性——`NOT_ALLOWED_IN_CURRENT_STATE`、`RESOURCE_BUSY`、`ACCESSORY_NOT_REACHABLE` 的语义设计 |
| **OPC UA** | 传感器与硬件诊断——`BadDeviceFailure`、`BadSensorFailure`、`BadConfigurationError`、`BadConditionDisabled` 以及三级严重度（Good/Uncertain/Bad）的理念 |
| **Modbus** | 工业 IoT 极简设计——仅 10 个错误码覆盖所有场景的精炼思路；`GATEWAY_TARGET_DEVICE_FAILED_TO_RESPOND`（子设备不可达）的语义 |
| **CoAP** | 受限设备的错误表达——`4.22 Unprocessable Entity`（语义无效）、`4.29 Too Many Requests`（速率限制）等面向 IoT 的扩展 |
| **HTTP** | 错误分类的层级结构——4xx（请求方问题）vs 5xx（执行方问题）的大类划分思路 |
| **JSON-RPC 2.0** | 保留范围机制——标准错误码与实现自定义错误码的范围隔离 |
