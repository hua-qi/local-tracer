# Vite Plugin

## Purpose

TBD

## Requirements

### Requirement: 插件入口与配置
`huaqiFEVitePlugin(options?)` SHALL 返回一个符合 Vite `Plugin` 接口的对象，将其加入 `vite.config.ts` 的 `plugins` 数组即可启用 Tracer。

#### Scenario: Vite 配置接入
- **WHEN** 用户在 `vite.config.ts` 的 `plugins` 中加入 `tracerVitePlugin()`
- **THEN** 启动 `npm run dev` 后 Tracer 全链路（middleware + AST 注入 + 日志写入）可用

### Requirement: 挂载 /rt middleware
插件 SHALL 在 `configureServer(server)` 钩子中调用 `server.middlewares.use('/rt', createTracerMiddleware(...))`，仅执行一次。

#### Scenario: middleware 一次挂载
- **WHEN** dev server 冷启动
- **THEN** `/rt` 端点被挂载一次，HMR 热更新不会重复挂载

### Requirement: transform 注入埋点
插件 SHALL 通过 `transform(code, id)` 钩子拦截 JS/TS 模块，调用 `core/ast-injector` 注入 `__rt_log` 调用与 runtime helper。`node_modules` 中的模块 SHALL 被跳过。

#### Scenario: 业务代码被注入
- **WHEN** 业务模块被 Vite transform
- **THEN** 返回的 code 包含 `__rt_log` 注入与 runtime helper prepend

#### Scenario: 跳过 node_modules
- **WHEN** 模块 id 在 `node_modules` 中
- **THEN** transform 直接返回原 code 不做注入

### Requirement: 配置重新加载
插件 SHALL 在 `buildStart` 钩子中重新读取 `.agent/tracer.config.json`，使得每次构建（含 HMR）使用最新规则。

#### Scenario: HMR 后使用新 config
- **WHEN** HMR 触发 `buildStart` 且 Agent 已修改 config
- **THEN** 后续 transform 使用最新 config 进行匹配

### Requirement: 冷启动清空日志
插件 SHALL 在 dev server 冷启动时（`buildStart` 第一次执行）清空 `{log.dir}/*.jsonl`；HMR 期间触发的 `buildStart` SHALL 不清空。

#### Scenario: 冷启动清空
- **WHEN** dev server 冷启动触发第一次 `buildStart`
- **THEN** `.agent/tracer/logs/*.jsonl` 被清空

#### Scenario: HMR 不清空
- **WHEN** HMR 触发后续 `buildStart`
- **THEN** 已有 .jsonl 文件保留，继续追加
