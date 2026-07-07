# Webpack Plugin

## Purpose

TBD

## Requirements

### Requirement: 插件入口
`HuaqiFEWebpackPlugin` SHALL 是一个可 `new` 调用的类，加入 `webpack.config.js` 的 `plugins` 数组即可启用 Tracer。

#### Scenario: Webpack 配置接入
- **WHEN** 用户在 `webpack.config.js` 的 `plugins` 中加入 `new TracerWebpackPlugin()`
- **THEN** 启动 dev server 后 Tracer 全链路（middleware + AST 注入 + 日志写入）可用

### Requirement: 挂载 /rt middleware
插件 SHALL 通过 `devServer.setupMiddlewares` 钩子向 middlewares 数组 push `createTracerMiddleware(...)`，仅挂载一次。

#### Scenario: middleware 一次挂载
- **WHEN** dev server 冷启动
- **THEN** `/rt` 端点被挂载一次

### Requirement: processAssets 注入埋点
插件 SHALL 通过 `compiler.hooks.compilation.tap` 注册到 `compilation.hooks.processAssets`，遍历产物 assets，对 JS chunk 调用 `core/ast-injector` 注入埋点。`node_modules` 来源的 chunk SHALL 被跳过。

#### Scenario: 业务 chunk 被注入
- **WHEN** 产物中包含业务代码 chunk
- **THEN** 该 chunk 的最终 source 包含 `__rt_log` 注入与 runtime helper prepend

#### Scenario: 跳过 vendor chunk
- **WHEN** chunk 全部来自 node_modules
- **THEN** 该 chunk 不被注入

### Requirement: 配置重新加载
插件 SHALL 在 `compiler.hooks.watchRun` 中重新读取 `.agent/tracer.config.json`，使得每次构建（含 HMR）使用最新规则。

#### Scenario: watchRun 后使用新 config
- **WHEN** HMR 触发 `watchRun` 且 Agent 已修改 config
- **THEN** 后续 processAssets 使用最新 config 进行匹配

### Requirement: 冷启动清空日志
插件 SHALL 在 dev server 冷启动时（`watchRun` 第一次执行）清空 `{log.dir}/*.jsonl`；HMR 期间触发的 `watchRun` SHALL 不清空。

#### Scenario: 冷启动清空
- **WHEN** dev server 冷启动触发第一次 `watchRun`
- **THEN** `.agent/tracer/logs/*.jsonl` 被清空

#### Scenario: HMR 不清空
- **WHEN** HMR 触发后续 `watchRun`
- **THEN** 已有 .jsonl 文件保留，继续追加
