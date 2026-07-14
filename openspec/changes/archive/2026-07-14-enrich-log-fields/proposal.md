## Why

当前每条日志只包含 `traceId`、`eventId`、`type`、`data`、`callStack`（截取 3 帧）、`url`、`timestamp` 七个字段，Agent 排障时可用的上下文信息不足：无法确认事件先后顺序（timestamp 精度不够）、无法了解请求细节、无法捕获异常信息、调用栈太短且为原始字符串不易解析。

## What Changes

- **新增 `seq` 字段** — 会话内自增序号，解决 timestamp 精度不足以排序的问题
- **新增 `error` type** — 被追踪函数抛异常时记录错误信息，补齐 `api_call` → `api_response` → `error` 三种生命周期
- **新增 `request` 字段** — 承载 HTTP 请求详情（method / url / headers / body），单字段承载，仅 `api_call` 类型有值
- **新增 `error` 字段** — 承载异常详情（message / name），仅 `error` 类型有值
- **改造 `callStack`** — 不再截取 3 帧，保留全量调用栈；从原始字符串数组改为结构化 `[{function, file, line, col}]` 格式
- **兼容性** — 会话模型（window 生命周期边界）、JSONL 格式、日志目录和文件名规则均不变。新增字段客户端不发送也不影响服务端写入

## Capabilities

### New Capabilities

（无新增 capability，均在现有 capability 范围内修改）

### Modified Capabilities

- `runtime-helper`: payload 新增 seq / request / error 字段，callStack 改为全量结构化，支持 error type
- `dev-server-middleware`: type 校验新增 `error` 值，log 写入逻辑不变（透传所有字段）
- `tracer-config`: Trace type 允许值新增 `error`

## Impact

| 影响范围 | 说明 |
|---------|------|
| `src/core/runtime-helper.ts` | 修改 `__rt_log` 和 `__rt_log_getShortStack` 逻辑 |
| `src/core/middleware.ts` | `type` 校验扩展（当前只校验必填字段存在性，不校验值，影响较小） |
| `src/core/config.ts` | `TraceType` 类型联合新增 `'error'`，schema 校验更新 |
| `src/core/ast-injector.ts` | 注入 error 事件的 log 调用（try/catch 包裹被追踪调用） |
| `test/` | 相关单测更新 |
| `skill.md` | 文档更新，说明新增字段和 type |
