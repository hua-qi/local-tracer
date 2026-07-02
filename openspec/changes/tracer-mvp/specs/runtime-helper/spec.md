## ADDED Requirements

### Requirement: __rt_log 函数签名与 payload 组装
`__rt_log(eventId: string, type: string, data: Record<string, unknown>)` SHALL 在被调用时组装一条 payload，包含 `traceId`、`eventId`、`type`、`data`、`callStack`、`url`、`timestamp` 字段。

#### Scenario: 组装 payload
- **WHEN** `__rt_log("fetchUserData", "api_call", { "arguments[0]": 1 })` 在浏览器中被调用
- **THEN** 产生的 payload 包含 `eventId: "fetchUserData"`、`type: "api_call"`、`data: { "arguments[0]": 1 }`、`url: location.href`、`timestamp: Date.now()`、非空 `traceId` 与 `callStack`

### Requirement: traceId 页面级会话管理
`__rt_log` SHALL 从 `window.__TRACER_SESSION_ID__` 读取 traceId；若不存在则生成一个 UUID 写入 `window.__TRACER_SESSION_ID__` 后使用。同一页面会话的所有事件 SHALL 共享同一个 traceId；刷新页面 SHALL 产生新的 traceId。

#### Scenario: 首次调用生成 traceId
- **WHEN** `window.__TRACER_SESSION_ID__` 未定义时调用 `__rt_log`
- **THEN** 系统生成一个 UUID 写入 `window.__TRACER_SESSION_ID__` 并使用该值作为 payload.traceId

#### Scenario: 后续调用复用 traceId
- **WHEN** 同一页面会话内后续调用 `__rt_log`
- **THEN** payload.traceId 与首次调用一致

### Requirement: 上报机制
`__rt_log` SHALL 通过 `fetch('/rt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true })` 同步上报到当前 origin 的 `/rt` 端点。上报失败 SHALL 静默（`.catch(() => {})`），不向业务代码抛出错误。

#### Scenario: 上报成功
- **WHEN** `__rt_log` 被调用且 dev server `/rt` 端点可达
- **THEN** fetch 发送 POST 请求，body 为 payload 的 JSON 字符串

#### Scenario: dev server 不可达不影响业务
- **WHEN** dev server 未启动或 `/rt` 返回错误
- **THEN** `__rt_log` 的 fetch promise 被 catch，业务代码不抛异常

### Requirement: 调用栈采集
payload 的 `callStack` 字段 SHALL 包含调用 `__rt_log` 处的最前 3 层调用栈信息（来自 `new Error().stack` 或同等能力的 API），用于 Agent 关联源码路径。

#### Scenario: callStack 字段非空
- **WHEN** `__rt_log` 被调用
- **THEN** payload.callStack 为字符串数组，最多 3 项
