## MODIFIED Requirements

### Requirement: Config schema 校验
系统 SHALL 校验配置文件符合以下 schema：顶层字段 `{ version: 1, log: { dir: string }, traces: Trace[] }`。每个 `Trace` SHALL 包含 `id`（非空字符串）、`type`（取值 `api_call` | `api_response` | `state_change` | `error`）、`match: { kind: string, name: string }`、`capture: string[]`。

#### Scenario: 合法配置通过校验
- **WHEN** 配置文件包含合法 `version`、`log.dir` 与一组合法 trace（type 可为 api_call / api_response / state_change / error）
- **THEN** 系统通过校验并构建匹配器索引

#### Scenario: 不支持的 trace type
- **WHEN** trace 的 `type` 不在 `api_call` / `api_response` / `state_change` / `error` 范围内
- **THEN** 系统 SHALL 抛出错误，拒绝该 trace
