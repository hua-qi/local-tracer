# @toft/local-runtime-tracer

一个纯本地的 Vite / Webpack 插件，辅助 Code Agent（Claude Code 等）在前端项目中定位 bug。

**一句话**：让 AI Coding Agent 能「看见」前端应用的运行时状态。

---

## 1. 定位

| | @toft/local-runtime-tracer | Sentry / Datadog / 自建埋点 |
|---|---|---|
| 场景 | 本地 dev，Agent debug | 线上生产，人类排查 |
| 数据去向 | 本地 JSONL 文件 | 远端服务 |
| 性能要求 | 无所谓 | 必须低开销 |
| 激活方式 | Code Agent 按需写 config | 提前预埋 |
| 保留时间 | dev server 关了就没 | 长期存储 |

@toft/local-runtime-tracer 不面向生产环境，不上报任何数据到远端。唯一的使用场景是：开发者在本地 `npm run dev`，Code Agent 借助运行时日志来理解代码的实际执行情况，从而更精准地定位**需要多轮迭代才能修复的复杂 bug**。

**打个比方**：Tracer 之于 Code Agent，就像 Chrome DevTools 的断点调试之于人类开发者——它让 Agent「看到」代码在浏览器里到底发生了什么。

**适用场景**：数据流经多层组件不知道哪一层丢了值、异步时序问题不确定哪个 Promise 先 resolve、条件分支跑进了意料之外的分支看源码看不出原因。对于一眼就能定位的一行修 bug，不需要 Tracer。

### 1.1 与 Browser DevTools MCP 类工具的对比

最近出现的「Browser DevTools MCP / chrome-devtools-mcp」类插件（如 [`serkan-ozal/browser-devtools-claude`](https://github.com/serkan-ozal/browser-devtools-claude)）也让 Code Agent 能看见前端运行时，但走了完全不同的路线：通过 CDP/Playwright 实时接管一个真浏览器。

**诚实说，运行时能力的广度上它更强**——它的 tracepoint/logpoint 走 CDP，能拿到完整作用域、完整调用栈；浏览器侧还能 `/screenshot`、`/accessibility`、`/network`、`/webvitals`、`/run-js` 执行任意代码。本项目的运行时信息只限于 `.agent/tracer.config.json` 里写死的埋点。

本项目不与它在「运行时能力广度」上竞争，差异收窄在**产物形态**这一点上：

| | @toft/local-runtime-tracer | Browser DevTools MCP 类 |
|---|---|---|
| 运行时信息怎么交付 | 落盘为本地 JSONL 文件 | MCP 工具调用的一次性返回 |
| 历史回看 | `cat` / `jq` / `head` 任意读，跨多轮对话复用 | 上一次操作的状态已丢，需重跑 |
| 异步时序复盘 | 时间线就在文件里，按 timestamp 排好 | 交互式 query 模型，事后复盘吃力 |
| 人类可介入 | 开发者直接 `cat`、`grep`、改 config、入 git | 数据绕着 Claude Code 转，人参与需透过 Agent |
| Agent 兼容性 | 文件即合约，任何 Code Agent / 人类都可消费 | 绑定 Claude Code / Cursor 等 MCP 客户端 |
| 基础设施 | 蹭 dev server，零额外进程端口 | 常驻 MCP server + Playwright/Chromium 实例 |
| Token 成本 | 一行 JSONL 几十字节，可截断、可选择性读 | snapshot / a11y 树 / 截图体积大、进上下文即计费 |

**一句话总结**：DevTools MCP 类是**交互式实时探针**，能力全但数据不沉淀、绑定 MCP 协议；本项目是**沉淀式离线日志**，能力窄但产物是文件、人机平权、Agent 无关。两条路解决的不是同一个问题——前者擅长「Agent 当场问、当场答」，后者擅长「事后对着时间线复盘异步时序与跨层数据流」。

### 1.2 思路的语言可迁移性

「构建期注入 + 运行期上报 + JSONL 落盘 + Agent 离线消费」这套**模式**不绑定前端：DevTools MCP 受 CDP / Node inspector 协议限制只能覆盖 JS 运行时，本项目的沉淀式日志模式天然不绑定运行时协议，原则上可迁移到 Java（字节码改写 + 本地接收）、Python（import hook / `sys.settrace` + 本地接收）。

但需诚实说明：**思路通用，机制不通用**。前端这套 Babel + Vite/Webpack + dev server 的代码在后端不复用——每语言需独立实现注入器与接收器，只有 core 层（JSONL 格式、Spec schema、Agent 消费协议）可跨语言共享。后端版本目前不在 MVP 范围内，详见 PRD v2 §3.2。

---

## 2. 工作流程

一切发生在**本地开发环境**，无需网络、无需远端服务。

```
用户遇到 BUG，在 Claude Code 中描述问题
  │
  ▼
Code Agent 接到调试任务
  ├─ ① 阅读相关源码，确定需要追踪的关键路径
  ├─ ② 生成/更新 .agent/tracer.config.json
  ├─ ③ 提示用户刷新页面并操作以触发日志
  │
  ▼
用户操作本地页面（localhost）→ 业务逻辑触发
  │
  ▼
注入的 __rt_log() 自动上报
  ├─ fetch POST /rt（挂在 localhost dev server 上）
  ├─ dev server middleware 接收，写入本地 JSONL
  │
  ▼
Code Agent
  ├─ ④ 读取 .agent/tracer/logs/ 下最新的 JSONL
  ├─ ⑤ 结合日志中的运行时数据 + 源码分析
  └─ ⑥ 输出诊断结论和修复方案
```

---

## 3. 快速开始

### 3.1 安装

```bash
npm install -D @toft/local-runtime-tracer
```

### 3.2 配置构建工具

**Vite 项目**（`vite.config.ts`）：

```ts
import { huaqiFEVitePlugin } from '@toft/local-runtime-tracer/vite'

export default {
  plugins: [huaqiFEVitePlugin()]
}
```

**Webpack 项目**（`webpack.config.js`）：

```js
const { HuaqiFEWebpackPlugin } = require('@toft/local-runtime-tracer/webpack')

module.exports = {
  plugins: [new HuaqiFEWebpackPlugin()]
}
```

### 3.3 安装 Skill

```bash
cp node_modules/@toft/local-runtime-tracer/skill.md .claude/skills/@toft/local-runtime-tracer.md
```

### 3.4 启动

```bash
npm run dev
```

插件会自动挂载 `/rt` 路由到 dev server，无需额外配置或启动独立进程。

### 3.5 在 Claude Code 中调试

向 Claude Code 描述你遇到的 bug。Agent 会在 Skill 指导下：

1. 读源码，确定关键路径
2. 生成 `.agent/tracer.config.json`
3. 提示你刷新页面触发操作
4. 读取 `.agent/tracer/logs/` 中的日志
5. 结合日志和源码输出诊断结论

全程无网络依赖，所有数据留在本地。

---

## 4. 配置参考

配置文件位于项目根目录：`.agent/tracer.config.json`

### 4.1 完整配置示例

```json
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
      "capture": ["arguments[0]"]
    },
    {
      "id": "fetchUserDataResp",
      "type": "api_response",
      "match": {
        "kind": "function_call",
        "name": "fetchUserData"
      },
      "capture": ["returnValue"]
    },
    {
      "id": "setUserAuth",
      "type": "state_change",
      "match": {
        "kind": "assignment",
        "name": "userAuth"
      },
      "capture": ["value"]
    }
  ]
}
```

### 4.2 字段说明

**顶层字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | number | 是 | 配置版本号，当前为 1 |
| `log.dir` | string | 否 | 日志输出目录，默认 `.agent/tracer/logs` |
| `traces` | array | 是 | 埋点规则列表 |

**trace 对象**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 埋点唯一标识，会出现在日志的 `eventId` 字段中 |
| `type` | string | 是 | 埋点类型，见下方类型表 |
| `match` | object | 是 | 匹配规则，定义如何定位注入点 |
| `capture` | string[] | 否 | 要捕获的运行时值列表 |

**match.kind 可选值**：

| kind | 说明 |
|---|---|
| `function_call` | 匹配函数调用表达式 |
| `assignment` | 匹配变量赋值表达式 |

**capture 支持的值**：

| 捕获表达式 | 说明 | 适用类型 |
|---|---|---|
| `arguments[0]` | 函数第一个参数 | api_call |
| `arguments[N]` | 函数第 N 个参数 | api_call |
| `returnValue` | 函数返回值 | api_response |
| `value` | 赋值的值 | state_change |

### 4.3 支持的埋点类型详解

| 类型 | 说明 | 典型 match | 典型 capture |
|---|---|---|---|
| `api_call` | API 请求发起时 | `function_call` 匹配请求函数名 | `arguments[0]` 等 |
| `api_response` | API 响应返回时 | `function_call` 匹配请求函数名 | `returnValue` |
| `state_change` | 状态变更时 | `assignment` 匹配变量名 | `value` |

---

## 5. 运行机制

### 5.1 构建阶段

1. Vite / Webpack 冷启动时，插件读取 `.agent/tracer.config.json`
2. 清空上次冷启动的日志文件（HMR 热更新不清空，保留当前调试会话数据）
3. 将 `/rt` 路由挂载到 dev server
4. 拦截产物 JS，通过 Babel 进行 AST 解析：
   - 使用 `@babel/parser` 将 JS 源码解析为 AST
   - 使用 `@babel/traverse` 遍历 AST 节点，匹配 config 中定义的规则
   - 在匹配节点处插入 `__rt_log()` 调用节点
   - 使用 `@babel/generator` 重新生成代码

**注入前**：

```ts
async function fetchUserData(id: number) {
  const res = await api.get(`/user/${id}`)
  setUserAuth(res.data)
  return res.data
}
```

**注入后**：

```ts
async function fetchUserData(id: number) {
  __rt_log("fetchUserData", "api_call", { "arguments[0]": id })
  const res = await api.get(`/user/${id}`)
  __rt_log("fetchUserData", "api_response", { returnValue: res.data })
  setUserAuth(res.data)
  return res.data
}
```

### 5.2 运行时（浏览器端）

`__rt_log` 函数定义（被注入到 bundle 顶部）：

```js
function __rt_log(eventId, type, data) {
  const payload = {
    traceId:  window.__TRACER_SESSION_ID__,   // 页面级 UUID，刷新即变
    eventId,
    type,
    data,               // 捕获的运行时值
    callStack: getShortStack(),  // 调用栈前 3 层
    url: location.href,         // 当前页面 URL
    timestamp: Date.now()
  }
  fetch('http://localhost:<dev-server-port>/rt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true       // 页面关闭/跳转时不丢数据
  }).catch(() => {})      // 静默失败，不影响业务
}
```

关键设计：

- **traceId**：页面加载时生成一个 UUID，同一页面会话的所有日志共享此 traceId，刷新页面即产生新的 traceId，天然隔离不同调试轮次。
- **keepalive**：确保页面关闭/跳转时触发的最后一个 `__rt_log` 不会因页面销毁而丢失。
- **静默失败**：`.catch(() => {})` 确保即使 dev server 未启动，业务代码也不会报错。
- **同源**：页面和 `/rt` 在同一 origin，无 CORS 问题。

### 5.3 传输层

```
浏览器 → fetch POST /rt → dev server (localhost)
```

- 与页面共享同一个 dev server 端口，无需额外启动进程
- 同源策略天然满足，无需处理 CORS
- 每次 `__rt_log` 调用对应一次独立 fetch，顺序由浏览器保证（同源串行）

### 5.4 Middleware（Node.js 端）

`/rt` 路由的处理逻辑：

1. 仅处理 `POST /rt`，其他请求交给下一个 middleware
2. 读取 request body 并 JSON 解析
3. 校验必要字段（traceId、eventId、type、timestamp），缺失则 400
4. 追加写入 `.agent/tracer/logs/{traceId}.jsonl`
5. 返回 200

**日志文件格式**（JSONL，每行一个 JSON 对象）：

```
{"traceId":"abc123","eventId":"fetchUserData","type":"api_call","data":{"arguments[0]":1},"callStack":["fetchUserData","handleLogin","onClick"],"url":"http://localhost:5173/login","timestamp":1716000000000}
{"traceId":"abc123","eventId":"fetchUserData","type":"api_response","data":{"returnValue":{"name":"子蒙"}},"callStack":["fetchUserData","handleLogin","onClick"],"url":"http://localhost:5173/login","timestamp":1716000000100}
{"traceId":"abc123","eventId":"setUserAuth","type":"state_change","data":{"value":{"name":"子蒙"}},"callStack":["setUserAuth","fetchUserData","handleLogin"],"url":"http://localhost:5173/login","timestamp":1716000000105}
```

### 5.5 日志清空策略

- **冷启动**（`npm run dev`）时清空所有日志文件。
- **HMR 热更新**不清空日志，继续追加到当前 traceId 的 JSONL 文件。

理由：HMR 不刷新页面，同一轮调试会话仍在进行中（traceId 不变），此时清空日志会导致已积累的调试数据全部丢失。只有冷启动才意味着「新一轮调试开始」，需要清空旧数据。

---

## 6. Agent 如何消费日志（Skill）

Skill 文件随 npm 包分发，用户需手动安装到 `.claude/skills/` 目录。Skill 指导 Code Agent 完成以下闭环：

1. **生成 config**：根据用户问题，阅读相关源码，确定需要追踪的关键路径，按 Spec 格式生成 `.agent/tracer.config.json`
2. **等待日志**：提示用户重新构建（若 config 有变更）并刷新页面触发操作
3. **读取日志**：读取 `.agent/tracer/logs/` 下最新 JSONL 文件
4. **关联分析**：将日志中的运行时数据与源码位置对应，定位问题根因。例如：
   - `eventId` → 对应源码中的函数/变量
   - `callStack` → 了解调用路径
   - `data` → 检查运行时实际值（如 API 返回了 `{ name: "子蒙" }`，但代码取了 `res.data.user`，多取了一层）
   - `timestamp` → 判断异步时序问题
5. **输出方案**：给出诊断结论和修复代码

---

## 7. 架构概览

```
项目根目录
│
├─ vite.config.ts  (或 webpack.config.js)
│   └─ 引入 @toft/local-runtime-tracer 插件
│       └─ configureServer / setupMiddlewares → 挂 /rt middleware
│
├─ .agent/
│   ├─ tracer.config.json          ← Agent 生成的埋点配置
│   └─ tracer/logs/
│       └─ {traceId}.jsonl         ← 运行时日志
│
└─ node_modules/@toft/local-runtime-tracer/
    ├── src/
    │   ├── core/
    │   │   ├── ast-injector.ts     # AST 解析注入
    │   │   ├── config.ts           # 配置加载
    │   │   ├── runtime-helper.ts   # __rt_log 源码
    │   │   └── middleware.ts       # POST /rt 处理
    │   ├── vite/index.ts           # Vite 适配
    │   └── webpack/index.ts        # Webpack 适配
    └── skill.md                    # Agent 使用指引
```

---

## 8. 常见问题

### Q: 日志会留在浏览器的 Network 面板里吗？

会的。每次 `__rt_log` 调用都是一次 `POST /rt` 请求，可以在 Network 面板中看到。这是设计如此——开发者也可以在浏览器中直接观察日志。

### Q: 注入的埋点会影响我的源码吗？

不会。AST 注入只作用于构建产物（bundle），不修改磁盘上的源码。

### Q: 生产构建会包含埋点吗？

默认不会。插件仅在 dev server 模式下激活，生产构建（`npm run build`）时不注入任何埋点代码。

### Q: 需要额外启动一个 log server 进程吗？

不需要。`/rt` 路由直接挂在 dev server 上，生命周期随 dev server 启动/关闭。

### Q: 支持 TypeScript 吗？

支持。AST 解析作用于编译后的 JS 产物，与是否使用 TypeScript 无关。

---

## 9. 许可

MIT
