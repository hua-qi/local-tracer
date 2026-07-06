# local-runtime-tracer — 运行时追踪脚手架 MVP PRD v2

## 1. 概述

### 1.1 产品定位

**local-runtime-tracer 是一个纯本地开发调试工具，辅助 Code Agent 在前端项目中定位复杂 bug。**

它不面向生产环境，不上报任何数据到远端，不考虑性能开销和产物体积。唯一的使用场景是：开发者在本地 `npm run dev`，Code Agent 借助运行时日志来理解代码的实际执行情况，从而更精准地定位问题。

打个比方：Tracer 之于 Code Agent，就像 Chrome DevTools 的断点调试之于人类开发者——它让 Agent「看到」代码在浏览器里到底发生了什么。

**适用场景**：需要多轮迭代才能修复的复杂 bug。典型如：

- 数据流经多层组件，不知道哪一层把值搞丢了
- 异步时序问题，不确定哪个 Promise 先 resolve
- 条件分支跑进了意料之外的分支，看源码看不出为什么

对于一眼就能定位的一行修 bug，不需要 Tracer。Tracer 解决的是「看源码看不出来，必须在运行时观察数据流动」的问题。

### 1.2 与生产监控工具的区别

| | Tracer | Sentry / Datadog / 自建埋点 |
|---|---|---|
| 场景 | 本地 dev，Agent debug | 线上生产，人类排查 |
| 数据去向 | 本地 JSONL 文件 | 远端服务 |
| 性能要求 | 无所谓 | 必须低开销 |
| 激活方式 | Code Agent 按需写 config | 提前预埋 |
| 保留时间 | dev server 关了就没 | 长期存储 |

### 1.3 核心目标

在 Webpack / Vite 项目的构建阶段，根据 Spec 配置在产物中自动注入运行时埋点，将结构化运行时数据写入本地日志文件，供 Code Agent 读取和消费。

**一句话**：让 AI Coding Agent 能「看见」前端应用的运行时状态。

---

## 2. 核心流程

一切发生在**本地开发环境**，无需网络、无需远端服务。

```
用户遇到 BUG，在 Claude Code 中描述问题
  │
  ▼
Code Agent 接到调试任务（如"登录接口报错了"）
  │
  ├─ ① 阅读相关源码，确定需要追踪的关键路径
  ├─ ② 生成/更新 .agent/tracer.config.json（Skill 指导格式）
  ├─ ③ 提示用户刷新页面并操作以触发日志
  │
  ▼
用户操作本地页面（localhost）→ 业务逻辑触发
  │
  ▼
注入的 __rt_log() 自动上报
  │
  ├─ fetch POST /rt（挂在 localhost dev server 上）
  ├─ dev server middleware 接收，写入本地 JSONL
  │
  ▼
Code Agent
  │
  ├─ ④ 读取 .agent/tracer/logs/ 下最新的 JSONL
  ├─ ⑤ 结合日志中的运行时数据 + 源码分析
  └─ ⑥ 输出诊断结论和修复方案
```

**关键角色分工**：

| 环节 | 负责方 |
|---|---|
| 决定追踪什么 | Code Agent（根据问题上下文） |
| 生成 tracer.config.json | Code Agent（Skill 指导格式） |
| AST 注入埋点代码 | Build 插件（Vite / Webpack） |
| 运行时数据上报 | Runtime helper → dev server middleware |
| 写日志文件 | Middleware（共用） |
| 读日志、分析问题 | Code Agent（Skill 提醒） |

---

## 3. MVP 范围

### 3.1 要做

| 模块 | 内容 |
|---|---|
| Vite 插件 | 适配层，挂 middleware，拦截产物做 AST 注入 |
| Webpack 插件 | 适配层，挂 middleware，拦截产物做 AST 注入 |
| AST 注入器（共用） | @babel/parser 解析 → traverse 匹配 → 注入 `__rt_log` |
| Runtime Helper（共用） | `__rt_log` 函数源码，编译时注入，运行时 fetch 上报 |
| Dev Server Middleware（共用） | POST /rt 接收事件，写入 JSONL |
| Config 解析（共用） | Spec 配置类型与加载逻辑 |
| Skill 文件 | 教 Agent 如何生成 config、如何读日志、如何分析 |
| 示例项目 | Vite 和 Webpack 各一个 |

### 3.2 不做

- Agent 自动发现关键路径并生成 Spec（MVP 依赖 Skill 提示 + Agent 自行阅读源码后手写 config）
- 复杂的数据过滤和聚合
- 非 Vite / Webpack 项目
- 实时推送给 Agent（Agent 按需读取日志文件）
- 可视化 Dashboard
- Log Server 独立进程（直接挂 dev server）
- postinstall 自动安装 skill（用户手动 cp）
- **生产环境、线上部署、远端上报——local-runtime-tracer 是纯本地工具**

### 3.3 支持的埋点类型

| 类型 | 说明 | 匹配方式 |
|---|---|---|
| api_call | API 请求发起 | 函数名匹配 |
| api_response | API 响应返回 | 函数名 + 调用上下文匹配 |
| state_change | 状态变更（setState / dispatch） | 变量名 / 函数名匹配 |
| branch_taken | 条件分支走向 if/else/switch | 位置匹配 |
| user_interaction | 用户交互事件 | 事件处理函数名匹配 |

---

## 4. 技术方案

### 4.1 架构图

```
┌─ vite.config.ts ─────────────────────┐
│ plugins: [tracerVitePlugin(config)]   │
│   └─ configureServer → 挂 middleware  │
└──────────────────────────────────────┘
┌─ webpack.config.js ──────────────────┐
│ plugins: [new TracerWebpackPlugin()]  │
│   └─ setupMiddlewares → 挂 middleware │
└──────────────────────────────────────┘
          │
          ▼ (共享核心)
┌─ core/ ──────────────────────────────┐
│ ast-injector.ts    AST 解析与注入     │
│ config.ts          Spec 加载与类型    │
│ runtime-helper.ts  __rt_log 源码      │
│ middleware.ts      POST /rt 处理      │
└──────────────────────────────────────┘
          │
          ▼
┌─ Dev Server ─────────────────────────┐
│ POST /rt → 写入 JSONL                │
│ .agent/tracer/logs/{session}.jsonl   │
└──────────────────────────────────────┘
```

### 4.2 目录结构

```
local-runtime-tracer/
├── package.json
├── src/
│   ├── core/
│   │   ├── ast-injector.ts     # AST 解析注入（共用）
│   │   ├── config.ts           # Spec 加载/类型（共用）
│   │   ├── runtime-helper.ts   # __rt_log 源码（共用）
│   │   └── middleware.ts       # POST /rt 处理函数（共用）
│   ├── vite/
│   │   └── index.ts            # configureServer → 挂 middleware
│   └── webpack/
│       └── index.ts            # setupMiddlewares → 挂 middleware
├── skill.md                    # Code Agent 使用指引
├── example-vite/
├── example-webpack/
└── README.md
```

### 4.3 关键技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| AST 解析 | @babel/parser + @babel/traverse + @babel/generator | 产物已是 JS，Babel 生态成熟 |
| 日志路由 | 直接挂 dev server middleware | 零额外端口、生命周期自动化、用户无感 |
| 日志格式 | JSONL（每行一个 JSON 对象） | 流式追加友好，Agent 逐行读取 |

### 4.4 Vite 与 Webpack 适配对比

| | Vite | Webpack |
|---|---|---|
| Dev Server 钩子 | `configureServer(server)` → `server.middlewares.use('/rt', ...)` | `setupMiddlewares(middlewares)` → `middlewares.push(...)` |
| 产物处理 | `transform` hook | `compilation.hooks.processAssets` |
| 日志路由 | 同一个 `core/middleware.ts` | 同一个 `core/middleware.ts` |

### 4.5 Log Server 方案

**决策**：不启动独立进程，直接挂在 dev server 上。

- Vite 侧通过 `configureServer` 添加 `/rt` 路由（仅冷启动时执行一次）
- Webpack 侧通过 `setupMiddlewares` 添加 `/rt` 路由（仅冷启动时执行一次）
- 两者共用同一个 `core/middleware.ts` 处理函数
- 生命周期随 dev server 启动/关闭，无需额外管理

**Config 读取策略**：

- 每次构建（冷启动和 HMR 热更新）都重新读取 `.agent/tracer.config.json`
- 理由：开发者修完一个 bug 接着修下一个，dev server 一直跑着，Agent 更新 config 后 HMR 触发重建，插件必须立即用新规则重新注入

**日志清空策略**：

- **冷启动**（`npm run dev`）时清空所有日志文件
- **HMR 热更新**不清空日志，继续追加到当前 traceId 的 JSONL 文件

理由：日志清空和 config 读取是两个独立维度。Config 需要每次构建都重新读（Agent 可能改了规则），但日志不能每次构建都清（同一轮调试会话的积累数据会丢失）。HMR 不清空日志，冷启动才清空——因为冷启动意味着新一轮调试开始。

### 4.6 Spec 配置格式

```json
// .agent/tracer.config.json
{
  "version": 1,
  "log": {
    "dir": ".agent/tracer/logs"
  },
  "traces": [
    {
      "id": "fetchUserData",
      "type": "api_call",
      "match": {
        "kind": "function_call",
        "name": "fetchUserData"
      },
      "capture": ["arguments[0]", "returnValue"]
    },
    {
      "id": "setUserAuth",
      "type": "state_change",
      "match": {
        "kind": "assignment",
        "name": "userAuth"
      },
      "capture": ["value"]
    },
    {
      "id": "loginSubmit",
      "type": "user_interaction",
      "match": {
        "kind": "event_handler",
        "name": "handleLogin"
      },
      "capture": ["event.type"]
    }
  ]
}
```

### 4.7 注入效果

**源码（不变）**：
```ts
async function fetchUserData(id: number) {
  const res = await api.get(`/user/${id}`)
  setUserAuth(res.data)
  return res.data
}
```

**产物（插件注入后）**：
```ts
async function fetchUserData(id: number) {
  __rt_log("fetchUserData", "api_call", { "arguments[0]": id })
  const res = await api.get(`/user/${id}`)
  __rt_log("fetchUserData", "api_response", { returnValue: res.data })
  setUserAuth(res.data)
  return res.data
}
```

### 4.9 运行时数据流转详解

以下是从「用户在浏览器中操作」到「Agent 读到日志」的完整数据流，按时间顺序展开：

```
时间线 ──────────────────────────────────────────────────────────────────────────────▶

┌─ 0. 构建阶段（npm run dev） ──────────────────────────────────────────────────────────┐
│                                                                                        │
│  Vite / Webpack 启动                                                                    │
│    │                                                                                    │
│    ├─ ① 插件读取 .agent/tracer.config.json（每次构建都重新读取）                         │
│    │     │                                                                              │
│    │     └─ config.ts: loadConfig()                                                     │
│    │         ├─ 校验 JSON Schema                                                        │
│    │         ├─ 解析 traces[] 数组                                                      │
│    │         └─ 构建匹配器索引（match.kind + match.name → trace 映射）                  │
│    │                                                                                    │
│    ├─ ② 清空上次冷启动的日志（HMR 不清空）                                                  │
│    │     └─ fs.rmSync(.agent/tracer/logs/*.jsonl)                                       │
│    │                                                                                    │
│    ├─ ③ 挂载 /rt 路由                                                                   │
│    │     ├─ Vite:  configureServer(server) → server.middlewares.use('/rt', middleware)  │
│    │     └─ Webpack: setupMiddlewares(middlewares) → middlewares.push(...)              │
│    │                                                                                    │
│    └─ ④ 拦截产物，AST 注入                                                               │
│          │                                                                              │
│          ├─ 读取产物 JS 源码                                                             │
│          ├─ @babel/parser 解析为 AST                                                    │
│          ├─ @babel/traverse 遍历 AST 节点                                               │
│          │   ├─ 遇到 CallExpression → 检查函数名是否匹配 traces[type=api_call]          │
│          │   ├─ 遇到 AssignmentExpression → 检查变量名是否匹配 traces[type=state_change]│
│          │   ├─ 遇到 IfStatement/SwitchStatement → 检查位置是否匹配 branch_taken        │
│          │   └─ 遇到事件处理函数 → 检查函数名是否匹配 user_interaction                   │
│          ├─ 在匹配节点前后插入 __rt_log() 调用节点                                       │
│          │   └─ __rt_log(traceId, type, capturedData)                                   │
│          └─ @babel/generator 生成新代码，替换原产物                                      │
│                                                                                        │
│  产物变化示例：                                                                          │
│  注入前:  const res = await api.get(`/user/${id}`)                                      │
│  注入后:  __rt_log("fetchUserData","api_call",{args:{id}})                              │
│           const res = await api.get(`/user/${id}`)                                      │
│           __rt_log("fetchUserData","api_response",{res})                                │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ 1. 页面加载（浏览器） ──────────────────────────────────────────────────────────────────┐
│                                                                                        │
│  浏览器加载 HTML → 解析 <script> → 执行 JS                                               │
│    │                                                                                    │
│    └─ __rt_log 函数定义被注册到全局作用域                                                  │
│       （runtime-helper.ts 源码已被注入到 bundle 顶部）                                    │
│                                                                                        │
│  __rt_log 函数内部：                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐                      │
│  │ function __rt_log(eventId, type, data) {                     │                      │
│  │   const payload = {                                          │                      │
│  │     traceId:  window.__TRACER_SESSION_ID__,  // 页面级 UUID   │                      │
│  │     eventId,                                                 │                      │
│  │     type,                                                    │                      │
│  │     data,              // 捕获的运行时值                       │                      │
│  │     callStack: getShortStack(),  // 调用栈（前 3 层）         │                      │
│  │     url: location.href,   // 当前页面 URL                     │                      │
│  │     timestamp: Date.now()                                    │                      │
│  │   }                                                          │                      │
│  │   fetch('http://localhost:<port>/rt', {                      │
│  │     method: 'POST',                                          │                      │
│  │     headers: { 'Content-Type': 'application/json' },         │                      │
│  │     body: JSON.stringify(payload),                           │                      │
│  │     keepalive: true         // 页面关闭时也不丢数据            │                      │
│  │   }).catch(() => {})        // 静默失败，不影响业务            │                      │
│  │ }                                                            │                      │
│  └──────────────────────────────────────────────────────────────┘                      │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ 2. 用户操作触发（浏览器） ──────────────────────────────────────────────────────────────┐
│                                                                                        │
│  用户点击「登录」按钮                                                                     │
│    │                                                                                    │
│    ├─ handleLogin(event) 被调用                                                         │
│    │   └─ __rt_log("loginSubmit", "user_interaction", { type: "click" })                │
│    │       → fetch POST /rt ①                                                          │
│    │                                                                                    │
│    ├─ fetchUserData(id) 被调用                                                          │
│    │   └─ __rt_log("fetchUserData", "api_call", { args: { id: 1 } })                   │
│    │       → fetch POST /rt ②                                                          │
│    │                                                                                    │
│    ├─ api.get() 返回响应                                                                 │
│    │   └─ __rt_log("fetchUserData", "api_response", { res: { name: "子蒙" } })          │
│    │       → fetch POST /rt ③                                                          │
│    │                                                                                    │
│    └─ setUserAuth(res.data) 被调用                                                      │
│        └─ __rt_log("setUserAuth", "state_change", { value: { name: "子蒙" } })          │
│            → fetch POST /rt ④                                                          │
│                                                                                        │
│  每次调用都是独立的 fetch，顺序由浏览器保证（同源串行）                                      │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ 3. HTTP 传输层 ────────────────────────────────────────────────────────────────────────┐
│                                                                                        │
│  浏览器网络栈                                                                            │
│    │                                                                                    │
│    ├─ POST http://localhost:5173/rt  (Vite 默认端口)                                     │
│    │   或                                                                                │
│    └─ POST http://localhost:8080/rt  (Webpack 默认端口)                                  │
│                                                                                        │
│  Request:                                                                               │
│    Method: POST                                                                          │
│    Content-Type: application/json                                                        │
│    Body: {"traceId":"abc123","eventId":"fetchUserData","type":"api_call",...}           │
│                                                                                        │
│  同源策略：天然满足（页面和 /rt 在同一个 origin）                                          │
│  无 CORS 问题，无跨域限制                                                                │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ 4. Middleware 处理（Node.js） ──────────────────────────────────────────────────────────┐
│                                                                                        │
│  core/middleware.ts                                                                     │
│    │                                                                                    │
│    ├─ ① 接收 IncomingMessage                                                             │
│    │     ├─ 仅处理 POST /rt（其他请求放行给下一个 middleware）                              │
│    │     └─ 非 POST → 404                                                                │
│    │                                                                                    │
│    ├─ ② 读取 request body                                                               │
│    │     └─ 累积 chunk → Buffer → JSON.parse(payload)                                   │
│    │                                                                                    │
│    ├─ ③ 简单校验                                                                         │
│    │     ├─ 必须有 traceId、eventId、type、timestamp                                     │
│    │     └─ 缺失字段 → 400 + 丢弃（不写文件）                                             │
│    │                                                                                    │
│    ├─ ④ 写入日志文件                                                                      │
│    │     ├─ 确定文件路径: .agent/tracer/logs/{traceId}.jsonl                             │
│    │     ├─ fs.appendFileSync(path, JSON.stringify(payload) + '\n')                     │
│    │     └─ 若目录不存在 → fs.mkdirSync({ recursive: true })                             │
│    │                                                                                    │
│    └─ ⑤ 返回响应                                                                         │
│          └─ res.writeHead(200) → res.end('ok')                                          │
│                                                                                        │
│  写入结果（.agent/tracer/logs/abc123.jsonl）：                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │ {"traceId":"abc123","eventId":"loginSubmit","type":"user_interaction",...}       │   │
│  │ {"traceId":"abc123","eventId":"fetchUserData","type":"api_call",...}             │   │
│  │ {"traceId":"abc123","eventId":"fetchUserData","type":"api_response",...}         │   │
│  │ {"traceId":"abc123","eventId":"setUserAuth","type":"state_change",...}           │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─ 5. Agent 消费（Claude Code） ───────────────────────────────────────────────────────────┐
│                                                                                        │
│  Skill 提醒 Agent 执行以下步骤：                                                          │
│    │                                                                                    │
│    ├─ ① 列出日志文件                                                                     │
│    │     └─ ls .agent/tracer/logs/                                                      │
│    │         → abc123.jsonl  (最新的 traceId)                                            │
│    │                                                                                    │
│    ├─ ② 读取日志内容                                                                     │
│    │     └─ cat .agent/tracer/logs/abc123.jsonl                                         │
│    │                                                                                    │
│    ├─ ③ 关联源码分析                                                                     │
│    │     ├─ eventId → 对应源码中的函数/变量                                               │
│    │     ├─ callStack → 了解调用路径                                                     │
│    │     ├─ data → 检查运行时实际值                                                       │
│    │     │   例: fetchUserData 返回 { name: "子蒙" }                                     │
│    │     │   但调用方取的是 res.data.user，而 res.data 本身才是 user 对象                 │
│    │     │   → 定位到 bug: 多取了一层 .user                                              │
│    │     └─ timestamp → 判断异步时序问题                                                  │
│    │                                                                                    │
│    └─ ④ 输出诊断 + 修复方案                                                               │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**关键设计点**：

- **traceId**：页面加载时在 `window.__TRACER_SESSION_ID__` 生成一个 UUID，同一个页面会话的所有日志共享此 ID。刷新页面 → 新的 traceId，天然隔离不同调试轮次。
- **keepalive**：`fetch` 使用 `keepalive: true`，确保用户在页面关闭/跳转时触发的最后一个 `__rt_log` 不会丢失。
- **静默失败**：`.catch(() => {})` 确保即使 dev server 没启动，业务代码也不报错。
- **同步写入**：`fs.appendFileSync` 保证日志写入顺序与 fetch 到达顺序一致（Node.js 单线程）。

---

## 5. Skill 设计

### 5.1 安装方式

Skill 文件随 npm 包分发，用户手动安装：

```bash
npm install -D local-runtime-tracer
cp node_modules/local-runtime-tracer/skill.md .claude/skills/tracer.md
```

选择手动复制而非 postinstall 自动安装，降低侵入性。

### 5.2 Skill 内容要点

Skill 指导 Code Agent 完成以下闭环：

1. **生成 config**：根据用户问题，阅读相关源码，确定关键路径，按 Spec 格式生成 `.agent/tracer.config.json`（若 dev server 已在运行，config 变更会在下一次 HMR 时自动生效，无需重启）
2. **等待日志**：提示用户刷新页面并操作以触发日志
3. **读取日志**：读取 `.agent/tracer/logs/` 下最新 JSONL 文件（按文件修改时间排序，取最新）
4. **关联分析**：将日志中的运行时数据与源码位置对应，定位问题根因
5. **输出方案**：给出诊断结论和修复代码

---

## 6. 用户使用流程（全本地）

```bash
# 1. 安装（本地 devDependency）
npm install -D local-runtime-tracer

# 2. 配置构建工具（二选一，本地配置文件）
# vite.config.ts:
import { tracerVitePlugin } from 'local-runtime-tracer/vite'
export default { plugins: [tracerVitePlugin()] }

# webpack.config.js:
const { TracerWebpackPlugin } = require('local-runtime-tracer/webpack')
module.exports = { plugins: [new TracerWebpackPlugin()] }

# 3. 安装 Skill（本地 skill 目录）
cp node_modules/local-runtime-tracer/skill.md .claude/skills/tracer.md

# 4. 启动本地 dev server（插件自动挂载 /rt 路由）
npm run dev

# 5. 在 Claude Code 中发起调试，Agent 按照 Skill 指引：
#    - 写 .agent/tracer.config.json（本地配置文件）
#    - 提示你在浏览器中操作页面（localhost）
#    - 读 .agent/tracer/logs/（本地 JSONL）
#    - 结合源码输出分析结论
```

全程无网络依赖，所有数据留在本地。

---

## 7. 里程碑

| 阶段 | 内容 |
|---|---|
| P0 | 跑通 Vite + Webpack 插件框架 + AST 注入 + Middleware + JSONL 全链路 |
| P1 | 支持 api_call / api_response / state_change 三种埋点类型 |
| P2 | 支持 branch_taken / user_interaction |
| P3 | 编写 skill.md + Vite 和 Webpack 示例项目 |

---

## 8. 风险与缓解

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| AST 匹配精度不够 | 误埋或漏埋，Agent 拿到错误上下文 | MVP 用函数名精确匹配，后续支持正则 / 代码位置 |
| 增加心智负担 | 用户需手动 cp skill 文件 | README 写清楚步骤，后续版本评估 postinstall 方案 |
| Spec 编写门槛 | Agent 需理解 config 格式 | Skill 提供格式说明和示例，Agent 参照生成 |
| 埋点信息过少 | 单次 trace 看不到完整调用链 | 后续支持调用栈自动追踪，降低 config 编写负担 |

> 注：性能开销和产物体积不在风险表中，因为 Tracer 只用于本地 dev 环境，这些指标不构成实际风险。
