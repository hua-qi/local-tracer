## MODIFIED Requirements

### Requirement: payload 校验
middleware SHALL 累积 request body chunk 后 `JSON.parse`，并校验 payload 包含必填字段 `seq`、`traceId`、`eventId`、`type`、`timestamp`。任一字段缺失 SHALL 返回 HTTP 400 且不写入日志文件。新增字段（`request`、`error`、`callStack` 新格式）SHALL 透传写入，不做额外校验。

#### Scenario: 校验通过
- **WHEN** 请求 body 是合法 JSON 且包含全部必填字段（seq、traceId、eventId、type、timestamp）
- **THEN** middleware 继续写入日志流程

#### Scenario: 缺失 seq 字段
- **WHEN** 请求 body 缺失 `seq` 字段
- **THEN** middleware 返回 HTTP 400 并丢弃该 payload，不写入任何 .jsonl 文件

#### Scenario: 缺失其他必填字段
- **WHEN** 请求 body 缺失 `traceId`、`eventId`、`type` 或 `timestamp` 中任一字段
- **THEN** middleware 返回 HTTP 400 并丢弃该 payload，不写入任何 .jsonl 文件

#### Scenario: body 非法 JSON
- **WHEN** 请求 body 不是合法 JSON
- **THEN** middleware 返回 HTTP 400 并丢弃
