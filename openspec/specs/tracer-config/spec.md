# Tracer Config

## Purpose

TBD

## Requirements

### Requirement: Config 文件位置与加载入口
系统 SHALL 从项目根目录的 `.agent/tracer.config.json` 读取配置。配置加载函数 SHALL 在每次构建（包括冷启动和 HMR 热更新）时重新读取该文件，保证 Agent 在 dev server 运行期间修改 config 后立即生效。

#### Scenario: 冷启动加载 config
- **WHEN** dev server 冷启动并触发首次构建
- **THEN** 系统从 `.agent/tracer.config.json` 读取并解析配置

#### Scenario: HMP 重新加载 config
- **WHEN** dev server 处于运行中，Agent 修改 `.agent/tracer.config.json` 后触发 HMR 热更新
- **THEN** 系统重新读取配置文件并用最新规则进行 AST 注入，无需重启 dev server

#### Scenario: 配置文件不存在
- **WHEN** 项目根目录下不存在 `.agent/tracer.config.json`
- **THEN** 系统 SHALL 视作没有 traces 配置（空配置），不进行 AST 注入，且不阻塞构建

### Requirement: Config schema 校验
系统 SHALL 校验配置文件符合以下 schema：顶层字段 `{ version: 1, log: { dir: string }, traces: Trace[] }`。每个 `Trace` SHALL 包含 `id`（非空字符串）、`type`（取值 `api_call` | `api_response` | `state_change` | `error`）、`match: { kind: string, name: string }`、`capture: string[]`。

#### Scenario: 合法配置通过校验
- **WHEN** 配置文件包含合法 `version`、`log.dir` 与一组合法 trace（type 可为 api_call / api_response / state_change / error）
- **THEN** 系统通过校验并构建匹配器索引

#### Scenario: 缺少必填字段
- **WHEN** 某个 trace 缺少 `id`、`type`、`match` 或 `capture`
- **THEN** 系统 SHALL 抛出明确错误信息并终止该次构建的 AST 注入阶段，dev server 仍可正常启动但日志中将出现错误提示

#### Scenario: 不支持的 trace type
- **WHEN** trace 的 `type` 不在 `api_call` / `api_response` / `state_change` / `error` 范围内
- **THEN** 系统 SHALL 抛出错误，拒绝该 trace

### Requirement: 匹配器索引构建
系统 SHALL 在配置加载后构建 `(match.kind, match.name) → trace[]` 的索引，供 AST 遍历时 O(1) 查找匹配的 trace。

#### Scenario: 多个 trace 共享同一匹配键
- **WHEN** 多个 trace 的 `match.kind` 与 `match.name` 相同（例如同一个函数同时配置 api_call 与 api_response）
- **THEN** 系统将所有匹配的 trace 收集到同一索引项下供注入器逐个处理
