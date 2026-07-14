## Context

当前 `__rt_log` 在浏览器端组装 payload 并通过 `fetch POST /rt` 上报，服务端 middleware 校验后写入 JSONL。所有字段均为必填或固定格式。本次改动在浏览器端新增字段、改造 callStack 格式、新增 error type，服务端基本透传。

涉及模块：
- `runtime-helper.ts` — 浏览器端字符串源码，注入到 bundle
- `ast-injector.ts` — Babel AST 注入，需要为 error type 生成 try/catch 包裹代码
- `middleware.ts` — 服务端校验与写入
- `config.ts` — type schema 校验

## Goals / Non-Goals

**Goals:**
- 新增 `seq` 会话内自增序号
- 新增 `error` type 及对应的 `error` 字段（message / name）
- 新增 `request` 字段（method / url / headers / body），仅 api_call 时填充
- callStack 改为全量保留，格式从 `string[]` 改为 `[{function, file, line, col}]`
- 向后兼容：旧版客户端不发送新字段不影响服务端写入

**Non-Goals:**
- 不改变会话模型（保持 window 生命周期边界）
- 不引入日志级别
- 不引入 source map 解析
- 不改变日志文件目录、命名、JSONL 格式
- 不引入浏览器环境信息（userAgent 等）

## Decisions

### 1. seq 自增序号的实现方式

**选择：** 在 `__TRACER_SESSION_ID__` 旁边维护一个 `window.__TRACER_SEQ__` 计数器，每次 `__rt_log` 调用时读取并自增。

**备选：** 使用闭包变量。但 `__rt_log` 是注入到 bundle 中的函数，每次重新注入可能丢失闭包状态。挂到 `window` 上与 traceId 管理方式一致，且页面刷新自然重置。

### 2. callStack 结构化格式

**选择：** `[{function: string, file: string, line: number, col: number}]`

**解析策略：** V8 stack trace 格式为 `at functionName (file:line:col)` 或 `at file:line:col`（匿名）。用正则 `/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/` 解析每一帧。匿名函数时 function 为空字符串。

**备选：** 保留原始字符串。但 Agent 需要解析字符串才能定位源码，结构化后 Agent 可直接使用 file/line/col 跳转，减少一步推断。

### 3. error type 的注入方式

**选择：** AST 注入时，将被追踪的函数调用包裹在 try/catch 中，catch 块内调用 `__rt_log(eventId, 'error', { message: e.message, name: e.name })`。

```
// 注入前
const result = fetchUserData(args)

// 注入后 (api_call + api_response)
__rt_log('fetchUserData', 'api_call', { ... })
let _result
try {
  _result = fetchUserData(args)
} catch (e) {
  __rt_log('fetchUserData', 'error', { message: e.message, name: e.name })
  throw e  // 重新抛出，不影响业务逻辑
}
__rt_log('fetchUserData', 'api_response', { returnValue: _result })
```

**关键点：** catch 块中必须 `throw e` 重新抛出，确保异常传播行为与注入前一致。对于 `state_change` 类型不需要 error 包裹（赋值操作通常不抛异常）。

### 4. request 字段的数据来源

**选择：** 不自动捕获。`request` 字段由 `capture` 表达式指定，用户在配置中通过 capture 指定要记录的请求字段。例如：

```json
{
  "capture": ["arguments[0].url", "arguments[0].method", "arguments[0].headers", "arguments[0].body"]
}
```

这些值会被合并到 `data` 字段中。

**备选：** 自动识别 fetch/axios 调用并提取请求信息。但这引入了对特定库的耦合，且无法覆盖所有 HTTP 客户端。不如交给用户通过 capture 配置灵活指定。

**修正：** 保持原有 `capture` 机制，`request` 字段实际由用户在 data 中组织。`request` 字段作为一个**约定的结构化字段**存在于 payload schema 中，由 `capture` 表达式按约定写入。这样 `api_call` 类型时，用户将请求信息 capture 到 `request` 字段中。

重新审视：上述方案增加了复杂度。更务实的做法是——`request` 不作为独立字段，而是在 `data` 中提供一个 `request` 子对象。但这需要 AST 注入层面支持嵌套 capture。当前 capture 是平铺的。

**最终决策：** `request` 作为 payload 的顶层可选字段，但目前**先不在 AST 注入层面自动填充**。用户通过 `data` 字段已有能力记录请求信息。后续如果有需求，可以在 AST 注入时识别 fetch/axios 模式自动填充 `request`。本次改动仅定义 schema 中的 `request` 字段位置。

**实际落地：** `request` 字段定义为 payload 顶层可选字段（`{method, url, headers, body}`），当前由 capture 表达式通过 data 间接承载。后续版本可考虑自动识别。

### 5. middleware 校验策略

**选择：** 保持现有校验逻辑不变——只校验 `traceId`、`eventId`、`type`、`timestamp` 四个必填字段是否存在。不校验 `type` 的具体值（当前也不校验），不校验新增字段。服务端透传所有字段写入 JSONL。

**理由：** 保持 middleware 简单，不做 schema 校验。字段的合法性由 config.ts 在构建时保证。

## Risks / Trade-offs

- **callStack 全量保留 → 日志体积增大** — 深层调用链可能有 20+ 帧，每条日志增加几百字节。但 JSONL 压缩效果好，且日志用完即弃，可接受。
- **结构化 callStack 解析失败** — 非 V8 引擎的 stack trace 格式可能不同（如 Firefox 使用 `function@file:line:col`）。需要兼容多种格式，否则 function/file/line/col 全部为 null。
- **error type 的 try/catch 包裹** — 可能影响浏览器 devtools 的断点调试体验（多了一层调用栈帧）。需要在 catch 块中重新抛出以保持异常行为不变。
