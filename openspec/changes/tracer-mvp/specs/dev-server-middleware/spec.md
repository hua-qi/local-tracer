## ADDED Requirements

### Requirement: POST /rt 端点
middleware SHALL 仅匹配 `POST /rt` 请求；其他 method 或 path SHALL 调用 `next()` 交给后续 middleware 处理。

#### Scenario: 处理 POST /rt
- **WHEN** 一个 POST 请求到达 `/rt`
- **THEN** middleware 拦截并处理该请求，不交给后续 middleware

#### Scenario: 放行其他请求
- **WHEN** 一个 GET /rt 或 POST /other 请求到达
- **THEN** middleware 调用 `next()` 放行

### Requirement: payload 校验
middleware SHALL 累积 request body chunk 后 `JSON.parse`，并校验 payload 包含必填字段 `traceId`、`eventId`、`type`、`timestamp`。任一字段缺失 SHALL 返回 HTTP 400 且不写入日志文件。

#### Scenario: 校验通过
- **WHEN** 请求 body 是合法 JSON 且包含全部必填字段
- **THEN** middleware 继续写入日志流程

#### Scenario: 缺失字段
- **WHEN** 请求 body 缺失 `traceId` 或其他必填字段
- **THEN** middleware 返回 HTTP 400 并丢弃该 payload，不写入任何 .jsonl 文件

#### Scenario: body 非法 JSON
- **WHEN** 请求 body 不是合法 JSON
- **THEN** middleware 返回 HTTP 400 并丢弃

### Requirement: 日志文件写入
middleware SHALL 将每条 payload 追加写入到 `{log.dir}/{traceId}.jsonl`，每条占一行（`JSON.stringify(payload) + '\n'`）。若 `log.dir` 目录不存在 SHALL 使用 `mkdirSync({ recursive: true })` 递归创建。写入 SHALL 使用同步 API（`fs.appendFileSync`）以保序。

#### Scenario: 追加写入
- **WHEN** 收到 payload `{ traceId: "abc", eventId: "x", type: "api_call", timestamp: 1, data: {} }` 且 `{log.dir}/abc.jsonl` 已存在
- **THEN** middleware 将该 payload JSON + `\n` 追加到文件末尾

#### Scenario: 目录不存在时创建
- **WHEN** 收到合法 payload 但 `{log.dir}` 目录不存在
- **THEN** middleware 递归创建目录后写入文件

### Requirement: 成功响应
写入成功后 middleware SHALL 返回 HTTP 200 与 body `"ok"`。

#### Scenario: 成功响应
- **WHEN** payload 校验与写入均成功
- **THEN** 客户端收到 `200 OK`，body 为 `"ok"`
