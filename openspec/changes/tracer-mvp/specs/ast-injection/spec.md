## ADDED Requirements

### Requirement: AST 解析与重生成
系统 SHALL 使用 `@babel/parser` 将产物模块源码解析为 AST，使用 `@babel/traverse` 遍历节点，并使用 `@babel/generator` 将修改后的 AST 重新生成为代码字符串。

#### Scenario: 解析 TS / JSX 模块
- **WHEN** 产物模块是 TypeScript 或 JSX
- **THEN** 系统使用兼容的 parser plugins 成功解析为 AST

#### Scenario: 跳过非 JS 模块
- **WHEN** 模块 id 表明是非 JS/TS 文件（如 `.css`、`.json`、`.svg`）
- **THEN** 系统 SHALL 跳过该模块不做注入

### Requirement: api_call 埋点注入
对于配置中 `type: "api_call"` 且 `match.kind: "function_call"` 的 trace，系统 SHALL 在每个匹配的 `CallExpression` 节点之前插入一条 `__rt_log(traceId, "api_call", dataRecord)` 语句，其中 `dataRecord` 的字段由 `capture` 数组中的表达式求值得到（如 `arguments[0]`、`returnValue`）。

#### Scenario: 注入 api_call
- **WHEN** 源码包含 `fetchUserData(id)` 调用，且配置中存在 `id: "fetchUserData", type: "api_call", match: { kind: "function_call", name: "fetchUserData" }, capture: ["arguments[0]"]`
- **THEN** 产物在调用前注入 `__rt_log("fetchUserData", "api_call", { "arguments[0]": id })`

#### Scenario: 函数名不匹配
- **WHEN** 源码包含 `fetchOrder(id)` 调用，但配置只匹配 `fetchUserData`
- **THEN** 系统 SHALL 不在该调用处注入埋点

### Requirement: api_response 埋点注入
对于配置中 `type: "api_response"` 且 `match.kind: "function_call"` 的 trace，系统 SHALL 在匹配的 `CallExpression` 之后（具体为该调用所在语句之后）插入 `__rt_log(traceId, "api_response", dataRecord)`，应支持捕获 `returnValue`（即调用表达式的求值结果）。

#### Scenario: 注入 api_response
- **WHEN** 源码包含 `const res = await api.get(url)`，配置存在 `type: "api_response"` 匹配 `api.get`，`capture: ["returnValue"]`
- **THEN** 产物在该语句之后注入 `__rt_log(traceId, "api_response", { returnValue: <表达式求值> })`

### Requirement: state_change 埋点注入
对于配置中 `type: "state_change"` 且 `match.kind: "assignment"` 的 trace，系统 SHALL 在每个匹配变量名（`match.name`）的 `AssignmentExpression` 之后插入 `__rt_log(traceId, "state_change", dataRecord)`，`capture` 默认包含 `value`。

#### Scenario: 注入 state_change
- **WHEN** 源码包含 `userAuth = newValue`，配置存在 `id: "setUserAuth", type: "state_change", match: { kind: "assignment", name: "userAuth" }, capture: ["value"]`
- **THEN** 产物在赋值之后注入 `__rt_log("setUserAuth", "state_change", { value: newValue })`

### Requirement: runtime helper 必须可达
系统 SHALL 在使用 `__rt_log` 的产物 bundle 中 prepend `__rt_log` 函数定义（来源 `runtime-helper.ts`），确保所有注入点都能调用到该函数。

#### Scenario: bundle 顶部包含 __rt_log 定义
- **WHEN** 注入了任意埋点
- **THEN** 重新生成的 bundle 顶部 SHALL 包含 `function __rt_log(...)` 定义

### Requirement: 不破坏原始代码语义
AST 注入 SHALL 保持原代码逻辑不变，仅添加 `__rt_log` 调用语句，不修改原有表达式的求值顺序与返回值。

#### Scenario: 原始逻辑保留
- **WHEN** 注入 `api_call` 埋点到 `fetchUserData(id)` 调用前
- **THEN** 产物中 `fetchUserData(id)` 仍按原序执行并返回原值
