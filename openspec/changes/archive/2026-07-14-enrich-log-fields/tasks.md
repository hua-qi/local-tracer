## 1. Runtime Helper — 浏览器端 payload 改造

- [x] 1.1 新增 `window.__TRACER_SEQ__` 会话内自增计数器，每次 `__rt_log` 调用时读取并自增
- [x] 1.2 payload 新增 `seq` 字段（值为当前计数器）、`error` 字段（非 error 类型时为 null）、`request` 字段（非 api_call 类型时为 null）
- [x] 1.3 重写 `__rt_log_getShortStack`：不再截取 3 帧，返回全量调用栈，格式改为 `[{function, file, line, col}]`，兼容 V8 和 Firefox 格式

## 2. Config — type 类型扩展

- [x] 2.1 `TraceType` 类型联合新增 `'error'`，`SUPPORTED_TRACE_TYPES` 数组同步更新

## 3. AST Injector — error type 注入

- [x] 3.1 `CallExpression` 处理器识别 `error` type：当存在 error trace 时，将原始调用包裹在 try/catch 中，catch 块内调用 `__rt_log(id, 'error', {message: e.message, name: e.name})` 并重新抛出
- [x] 3.2 `api_response` + `error` 协同：当同时存在 response 和 error trace 时，生成统一 try/catch 结构，try 后记录 response，catch 内记录 error 并 rethrow

## 4. Middleware — 校验字段更新

- [x] 4.1 `REQUIRED_FIELDS` 新增 `'seq'`

## 5. 测试更新

- [x] 5.1 更新 runtime-helper 单测：覆盖 seq 递增、error 字段、全量结构化 callStack
- [x] 5.2 更新 middleware 单测：覆盖 seq 必填校验、透传新增字段
- [x] 5.3 更新 config 单测：覆盖 `error` type 校验
- [x] 5.4 更新 ast-injector 单测：覆盖 error type 注入、api_response + error 协同

## 6. 文档更新

- [x] 6.1 更新 `skill.md`：补充新增字段说明、error type 使用示例
