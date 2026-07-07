# Design — Tracer MVP

## 概述

@toft/local-runtime-tracer 是一个纯本地 dev 工具，让 Code Agent 能看到前端运行时实际状态。MVP 范围：Vite + Webpack 全链路 + `api_call` / `api_response` / `state_change` 三类埋点。

## 架构

```
vite.config.ts / webpack.config.js
        │
        ▼  (插件入口)
vite-plugin / webpack-plugin (适配层)
        │
        ├─ configureServer / setupMiddlewares → core/middleware.ts (POST /rt)
        └─ transform / processAssets → core/ast-injector.ts (AST 注入)
                                          │
                                          ▼
                                  core/config.ts (读取 .agent/tracer.config.json)
                                          │
                                          ▼
                                  core/runtime-helper.ts (__rt_log 源码 prepend 到 bundle)
```

共用的核心在 `src/core/`，适配层在 `src/vite/` 与 `src/webpack/`。

## 关键设计决策

### 1. 共用核心 + 适配层

四个核心能力（config、ast-injector、runtime-helper、middleware）与构建工具无关，Vite / Webpack 仅写薄薄的适配层。理由：PRD 明确两个构建工具共用核心，避免重复实现 AST 注入与日志写入。

### 2. AST 注入策略

- 解析器：`@babel/parser`（默认配置，能处理 TS / JSX）
- 遍历：`@babel/traverse`
- 生成：`@babel/generator`
- 拦截点：
  - `CallExpression` → 检查 callee 名字是否匹配 `traces[type=api_call]` 或 `api_response`，在调用表达式前（api_call）/后（api_response，需 await 上下文）插入 `__rt_log()` 语句
  - `AssignmentExpression` → 检查 LHS 变量名是否匹配 `traces[type=state_change]`，在赋值之后插入 `__rt_log()`
- 注入的 `__rt_log(traceId, type, dataRecord)` 中 `dataRecord` 是从 `capture` 字段表达式求值得到的对象字面量
- `__rt_log` 函数源码 prepend 到 bundle 顶部，确保全局可调用

### 3. Config 加载与生命周期

- 路径：`.agent/tracer.config.json`（cwd 根目录）
- 读取时机：每次构建（冷启动 + HMR）都重新读取，因为 Agent 可能在 dev server 跑着的时候更新 config
- 校验：检查 `version`、`log.dir`、`traces[]`，单 trace 校验 `id`、`type`、`match.kind`、`match.name`、`capture`
- 匹配器索引：`(match.kind, match.name) → trace[]`，加速 AST 遍历时查找

### 4. 日志清空策略

- 冷启动：清空 `.agent/tracer/logs/*.jsonl`
- HMR：不清空，追加到当前 traceId 的 jsonl
- 理由：日志清空与 config 读取是两个独立维度。同一轮调试会话期间 HMR 触发的重建不应丢失已有日志；冷启动 = 新一轮调试，需要清空

实现：插件在 `buildStart`（Vite）/ `compilation` 首次触发（Webpack）钩子中，标记 `logsCleared` boolean，仅清一次。HMR 重建跳过清理。

### 5. Middleware 设计

`core/middleware.ts` 导出一个 `createTracerMiddleware({ logDir })`，返回 `(req, res, next) => void`：

1. 仅处理 `POST /rt`，其他请求 `next()`
2. 累积 request body chunk → Buffer → `JSON.parse`
3. 校验必填字段：`traceId`、`eventId`、`type`、`timestamp`。缺失 → 400 + 丢弃
4. 文件路径 `{logDir}/{traceId}.jsonl`；目录不存在则 `mkdirSync({ recursive: true })`
5. `fs.appendFileSync(path, JSON.stringify(payload) + '\n')`
6. `res.writeHead(200)` → `res.end('ok')`

### 6. Runtime Helper 行为

注入到 bundle 顶部的 `__rt_log(eventId, type, data)`：

- `traceId`：从 `window.__TRACER_SESSION_ID__` 读取；若不存在（首次加载），生成 UUID 并写入
- payload 字段：`traceId`、`eventId`、`type`、`data`、`callStack`（前 3 层）、`url`、`timestamp`（`Date.now()`）
- `fetch('/rt', { method: POST, headers: JSON, body, keepalive: true }).catch(() => {})`
- 注意：fetch URL 用相对路径 `/rt`，自动同源到当前 dev server，无需知道端口

### 7. Build 工具适配对比

| | Vite | Webpack |
|---|---|---|
| middleware 挂载 | `configureServer(server)` → `server.middlewares.use('/rt', ...)` | `devServer.setupMiddlewares` |
| 产物注入 | `transform(code, id)` hook（过滤 node_modules 与非 JS/TS） | `compiler.hooks.compilation.tap` → `compilation.hooks.processAssets` |
| 重读 config | `buildStart` hook | `compiler.hooks.watchRun` |
| 清空日志 | `buildStart` 中第一次执行 | `compiler.hooks.watchRun` 第一次执行 |

### 8. 不做（MVP 阶段）

- `branch_taken`、`user_interaction` 埋点
- 正则 / 代码位置匹配（仅函数名 + 变量名精确匹配）
- 调用栈深度自动追踪
- postinstall 自动安装 skill
- 任何远端上报 —— 纯本地工具

## 风险权衡

- **AST 匹配精度**：MVP 仅函数名 / 变量名精确匹配，可能误埋同名函数。Skill 提示 Agent 配置时注意唯一性，后续版本支持正则。
- **HMR 期间 config 一致性**：HMR 触发的部分模块重建使用最新 config，但已注入的旧模块仍在浏览器里跑——Agent 可能读到混合日志。Skill 需提示用户在 config 变更后刷新页面。
- **同源端口**：fetch 用相对路径 `/rt` 规避端口感知，但若业务有自定义 origin（如 service worker）需调整。MVP 假设标准 dev server origin。

## 测试策略

- `core/`：单元测试（config schema 校验、middleware 请求处理、AST 注入快照）
- `vite/` + `webpack/`：e2e 测试，启动示例项目 dev server，curl POST /rt 验证日志写入，浏览器自动化（或 jsdom）触发 `__rt_log` 验证端到端
- 示例项目本身作为集成测试载体
