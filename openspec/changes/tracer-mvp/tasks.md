## 1. 项目骨架

- [x] 1.1 初始化 `package.json`（name: `local-runtime-tracer`，type: module，exports 暴露 `/vite` 与 `/webpack` 子路径）
- [x] 1.2 配置 TypeScript + 构建脚本（tsc 输出 ESM 到 `dist/`）
- [x] 1.3 安装依赖：`@babel/parser`、`@babel/traverse`、`@babel/generator`、`@babel/types`；dev 依赖：`vite`、`webpack`、`webpack-dev-server`、`vitest`
- [x] 1.4 建立目录结构 `src/core/`、`src/vite/`、`src/webpack/`、`example-vite/`、`example-webpack/`
- [x] 1.5 添加 `.gitignore`：忽略 `dist/`、`node_modules/`、`.agent/tracer/logs/`，新建空 `.agent/` 目录占位

## 2. Core: Config 加载

- [x] 2.1 在 `src/core/config.ts` 定义 `TraceConfig`、`Trace`、`Match` 的 TypeScript 类型
- [x] 2.2 实现 `loadConfig(rootDir): TraceConfig`：读取 `.agent/tracer.config.json`，文件不存在返回 `{ traces: [] }` 空配置
- [x] 2.3 实现 `validateConfig(config)`：校验 version、log.dir、traces[] 字段，违规抛错附详细信息
- [x] 2.4 实现 `buildMatcherIndex(config)`：返回 `Map<string, Trace[]>`，key 为 `${match.kind}:${match.name}`
- [x] 2.5 单元测试：合法配置、缺字段、不支持 type、空配置

## 3. Core: AST 注入器

- [x] 3.1 在 `src/core/ast-injector.ts` 实现 `inject(code, config): { code: string, hasInjection: boolean }`
- [x] 3.2 `@babel/parser` 解析模块源码（启用 TypeScript 与 JSX parser plugins）
- [x] 3.3 `@babel/traverse` 遍历 `CallExpression`：匹配 `function_call` 类型 trace，注入 `api_call` / `api_response` 埋点
- [x] 3.4 `@babel/traverse` 遍历 `AssignmentExpression`：匹配 `assignment` 类型 trace，注入 `state_change` 埋点
- [x] 3.5 实现 `capture` 字段表达式 → 对象字面量属性转换（如 `arguments[0]`、`returnValue`、`value`）
- [x] 3.6 实现 runtime helper prepend：当 `hasInjection=true` 时把 `runtime-helper.ts` 编译后的字符串 prepend 到产物
- [x] 3.7 `@babel/generator` 重新生成代码字符串
- [x] 3.8 单元测试 + 快照：api_call、api_response、state_change、不匹配、非 JS 跳过

## 4. Core: Runtime Helper

- [x] 4.1 在 `src/core/runtime-helper.ts` 实现 `__rt_log(eventId, type, data)` 函数源码字符串导出
- [x] 4.2 `__rt_log` 读取 `window.__TRACER_SESSION_ID__`，缺失则生成 UUID 并写入
- [x] 4.3 组装 payload：traceId、eventId、type、data、callStack（前 3 层）、url、timestamp
- [x] 4.4 `fetch('/rt', { method: 'POST', headers: JSON, body, keepalive: true }).catch(() => {})`
- [x] 4.5 单元测试：jsdom 环境验证 traceId 复用、payload 字段、fetch 调用

## 5. Core: Dev Server Middleware

- [x] 5.1 在 `src/core/middleware.ts` 实现 `createTracerMiddleware({ logDir })`
- [x] 5.2 仅匹配 POST /rt，其他请求 `next()`
- [x] 5.3 累积 body chunk → Buffer → JSON.parse
- [x] 5.4 校验必填字段 `traceId`、`eventId`、`type`、`timestamp`，缺失返回 400 并丢弃
- [x] 5.5 写入 `{logDir}/{traceId}.jsonl`：`fs.mkdirSync({ recursive: true })` + `fs.appendFileSync(path, JSON.stringify(payload) + '\n')`
- [x] 5.6 写入成功返回 200 + `"ok"`
- [x] 5.7 单元测试：合法 payload、缺字段、非 JSON body、目录自动创建、多次追加

## 6. Vite 插件适配

- [x] 6.1 在 `src/vite/index.ts` 实现 `tracerVitePlugin(config?)` 返回 Vite `Plugin`
- [x] 6.2 `configureServer(server)` 中挂载 `/rt` middleware（仅一次）
- [x] 6.3 `buildStart` 中重新 loadConfig + buildMatcherIndex；首次执行时清空 `{log.dir}/*.jsonl`
- [x] 6.4 `transform(code, id)` 钩子：跳过 `id.includes('node_modules')` 或非 JS/TS，调用 `core/ast-injector` 注入
- [x] 6.5 单元测试 + 在 `example-vite` 跑端到端：启动 dev server，curl POST /rt 验证日志写入，验证 transform 注入

## 7. Webpack 插件适配

- [x] 7.1 在 `src/webpack/index.ts` 实现 `TracerWebpackPlugin` 类
- [x] 7.2 `apply(compiler)` 中通过 `devServer.setupMiddlewares` 挂载 `/rt` middleware（仅一次）
- [x] 7.3 `compiler.hooks.watchRun` 重新 loadConfig + buildMatcherIndex；首次执行清空 `{log.dir}/*.jsonl`
- [x] 7.4 `compiler.hooks.compilation.tap` → `compilation.hooks.processAssets`：遍历 assets，对 JS chunk 调用 ast-injector 注入（跳过 vendor）
- [x] 7.5 单元测试 + 在 `example-webpack` 跑端到端

## 8. Skill 文件

- [x] 8.1 编写 `skill.md`：config schema 说明、生成指引（含示例）、日志读取流程（按 mtime 取最新 .jsonl、逐行解析、关联源码）
- [x] 8.2 包含明确动作提示："生成/修改 config 后提示用户刷新页面并操作目标流程触发埋点"
- [x] 8.3 包含典型 bug 诊断示例（数据流丢失、异步时序）

## 9. 示例项目

- [x] 9.1 `example-vite/`：最小 React + Vite 项目，含一个 `fetchUserData(userId)` 调用与 `setUserAuth` 赋值的 demo 页面
- [x] 9.2 `example-vite/` 配好 `.agent/tracer.config.json` 涵盖 api_call、api_response、state_change 三类埋点
- [x] 9.3 `example-webpack/`：等价的 Webpack 版本（React + Webpack 5 + dev server）
- [x] 9.4 两个示例项目添加 e2e 脚本：启动 dev server → 触发埋点（headless 浏览器或手动 curl）→ 校验 .jsonl 内容

## 10. 文档与发布

- [x] 10.1 编写 `README.md`：定位（纯本地工具）、安装、Vite/Webpack 接入、skill 安装步骤、配置格式、目录约定
- [x] 10.2 添加 `.agent/tracer.config.json` 与 `.agent/tracer/logs/` 到示例的 `.gitignore`
- [x] 10.3 在 `package.json` 配置 `files` 字段确保 `dist/`、`skill.md`、`README.md` 进入 npm 包
- [x] 10.4 npm 发布前手动验证：在两个示例项目跑通完整闭环（写 config → dev → 操作 → 读日志）
