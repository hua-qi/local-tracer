## MODIFIED Requirements

### Requirement: __rt_log 函数签名与 payload 组装
`__rt_log(eventId: string, type: string, data: Record<string, unknown>)` SHALL 在被调用时组装一条 payload，包含 `seq`、`traceId`、`eventId`、`type`、`timestamp`、`data`、`request`、`error`、`callStack`、`url` 字段。

#### Scenario: 组装 payload
- **WHEN** `__rt_log("fetchUserData", "api_call", { "arguments[0]": 1 })` 在浏览器中被调用
- **THEN** 产生的 payload 包含 `eventId: "fetchUserData"`、`type: "api_call"`、`data: { "arguments[0]": 1 }`、`url: location.href`、`timestamp: Date.now()`、非空 `traceId`、自增 `seq`、结构化 `callStack`，`error` 为 null，`request` 可为 null 或包含请求详情

### Requirement: 调用栈采集
payload 的 `callStack` 字段 SHALL 包含调用 `__rt_log` 处的全量调用栈，格式为结构化数组 `[{function: string, file: string, line: number, col: number}]`。匿名函数时 function 为空字符串。解析失败时 SHALL 保留原始字符串到 `raw` 字段。

#### Scenario: callStack 为结构化数据
- **WHEN** `__rt_log` 被调用
- **THEN** payload.callStack 为对象数组，每个对象包含 `function`（string）、`file`（string）、`line`（number）、`col`（number），数组长度等于完整调用栈深度

#### Scenario: 匿名函数帧
- **WHEN** 调用栈中某一帧为匿名函数（格式如 `at file.ts:1:2`）
- **THEN** 该帧的 `function` 为空字符串，`file`、`line`、`col` 正常解析

### Requirement: seq 会话内自增序号
payload 的 `seq` 字段 SHALL 是一个从 0 开始的整数，每次 `__rt_log` 调用自增 1。同一会话内（同一 `traceId`）seq 单调递增。页面刷新后 SHALL 重置为 0。

#### Scenario: 首次调用 seq 为 0
- **WHEN** 页面加载后首次调用 `__rt_log`
- **THEN** payload.seq 为 0

#### Scenario: 后续调用 seq 递增
- **WHEN** 同一会话内第 N+1 次调用 `__rt_log`
- **THEN** payload.seq 等于 N

## ADDED Requirements

### Requirement: error type 日志记录
`__rt_log` 的 `type` 参数 SHALL 支持 `"error"` 值。当 type 为 `"error"` 时，`error` 字段 SHALL 为 `{message: string, name: string}` 对象。当 type 不为 `"error"` 时，`error` 字段 SHALL 为 null。

#### Scenario: 记录异常信息
- **WHEN** 调用 `__rt_log("fetchUserData", "error", { message: "Network error", name: "TypeError" })`
- **THEN** payload.type 为 `"error"`，payload.error 为 `{message: "Network error", name: "TypeError"}`

#### Scenario: 非 error 类型时 error 字段为 null
- **WHEN** 调用 `__rt_log("fetchUserData", "api_call", data)`
- **THEN** payload.error 为 null

### Requirement: request 字段
payload 的 `request` 字段 SHALL 为可选字段，用于承载 HTTP 请求详情。当 type 为 `"api_call"` 时 MAY 包含 `{method: string, url: string, headers: Record<string, string>, body: unknown}` 对象。其他 type 时 SHALL 为 null。

#### Scenario: api_call 时携带请求信息
- **WHEN** `__rt_log("fetchUserData", "api_call", data)` 被调用，且用户通过 capture 配置了请求信息
- **THEN** payload.request 可为 `{method: "GET", url: "/api/users", headers: {...}, body: null}`

#### Scenario: 非 api_call 时 request 为 null
- **WHEN** type 为 `api_response`、`state_change` 或 `error`
- **THEN** payload.request 为 null
