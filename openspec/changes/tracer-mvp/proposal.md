## Why

Code Agent 在前端项目中调试复杂 bug 时，只能依靠读源码——但数据流、异步时序、运行时分支走向看不出来，需要多轮盲目猜测才能定位。Tracer 是一个纯本地 dev 工具：构建阶段根据 Spec 自动注入运行时埋点，把结构化事件写入本地 JSONL，让 Agent 能「看见」浏览器中代码实际跑出的状态。MVP 聚焦跑通 Vite + Webpack 全链路与三种核心埋点类型。

## What Changes

- 新增共用的核心模块：AST 注入器（`@babel/parser` + `traverse` + `generator`）、Spec 配置加载、`__rt_log` 运行时 helper、`POST /rt` middleware
- 新增 Vite 插件适配层：`huaqiFEVitePlugin`，`configureServer` 挂 middleware、`transform` 注入埋点
- 新增 Webpack 插件适配层：`HuaqiFEWebpackPlugin`，`setupMiddlewares` 挂 middleware、`compilation.hooks.processAssets` 注入埋点
- 支持的埋点类型（MVP）：`api_call`、`api_response`、`state_change`
- 配置文件 `.agent/tracer.config.json`：每次构建（冷启动 + HMR）重新读取；HMR 不清空日志，冷启动清空
- 运行时 `__rt_log` 通过 `fetch('/rt', { keepalive: true })` 静默上报到 dev server，浏览器内 `window.__TRACER_SESSION_ID__` 提供 traceId
- 日志按 `{traceId}.jsonl` 追加写入，目录默认 `.agent/tracer/logs`
- 新增 `skill.md`：指引 Agent 生成 config、读取日志、关联源码分析
- 新增 Vite 与 Webpack 两个示例项目
- 不做：`branch_taken`、`user_interaction`、可视化、远端上报、postinstall 自动安装 skill

## Capabilities

### New Capabilities

- `tracer-config`: Spec 配置文件的 schema、加载、校验与匹配器索引构建
- `ast-injection`: 通过 AST 解析与遍历，根据 Spec 在产物中注入 `__rt_log` 调用
- `runtime-helper`: 编译时注入的 `__rt_log` 函数，负责组装事件数据并 fetch 上报
- `dev-server-middleware`: 挂在 dev server 上的 `POST /rt` 处理函数，校验并写入 JSONL
- `vite-plugin`: Vite 侧适配层，挂 middleware + transform 注入埋点 + 生命周期（冷启动清日志、HMR 重读 config）
- `webpack-plugin`: Webpack 侧适配层，挂 middleware + processAssets 注入埋点 + 生命周期（冷启动清日志、HMR 重读 config）
- `tracer-skill`: 指引 Code Agent 完成「写 config → 等日志 → 读日志 → 关联源码 → 输出结论」闭环的 skill 文件

### Modified Capabilities

_None — 项目当前 openspec/specs/ 为空，本次为首次建立 spec。_

## Impact

- 新增包 `@toft/local-runtime-tracer`，依赖 `@babel/parser`、`@babel/traverse`、`@babel/generator`、`@babel/types`
- 对 Vite/Webpack 用户：以 devDependency 接入，零侵入业务代码；仅在本地 dev 生效，不影响生产构建
- 引入 `.agent/tracer.config.json`（tracer 配置）与 `.agent/tracer/logs/*.jsonl`（运行时日志），需加入 `.gitignore`
- 新增示例项目 `example-vite/`、`example-webpack/`
- 工具仅用于本地调试：不考虑性能、产物体积、远端上报
