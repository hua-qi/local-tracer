Tracer — 运行时追踪脚手架 MVP PRD

1. 概述

项目名称：Tracer（暂定） 目标：在 Vite 项目的构建阶段，根据 Spec 配置在产物中自动注入运行时埋点，将结构化运行时数据写入本地文件，供 Code Agent（Claude Code
等）读取和消费。

一句话：让 AI Coding Agent 能「看见」前端应用的运行时状态。

---

2. 核心流程

Agent / 开发者
│
├─ 编写 Spec 配置 ──────▶ .agent/tracer.config.json
│
▼
Vite Build / Dev
│
├─ tracer-vite-plugin 读取配置
├─ AST 解析产物 → 匹配关键路径
├─ 注入 **rt_log() 调用
│
▼
浏览器运行时
│
├─ 用户操作 → 业务逻辑触发
├─ **rt_log() 自动上报
│
▼
本地 log 服务 (localhost)
│
├─ 接收 → 结构化 → 写入 .agent/tracer/logs/
│
▼
Code Agent (Claude Code / Cursor)
│
├─ 读取 log 文件
├─ 结合 Spec 和源码定位问题
└─ 输出修复方案

---

3. MVP 范围（Phase 1）

3.1 要做

模块 内容
────────────────────────────────────────────────────────────────────────
Vite 插件 读取 spec 配置，AST 注入 **rt_log 调用
Runtime Helper **rt_log 函数（注入到产物中），通过 fetch 上报到本地服务
Log Server 极简 Node.js HTTP 服务，接收事件并写入 JSONL 文件
Spec 配置 JSON 格式，定义关键路径的匹配规则和捕获内容
Log 文件 每次构建清空，按 traceId + 时间 组织

3.2 不做

• ❌ Agent 自动生成 Spec（MVP 阶段手动编写）
• ❌ 复杂的数据过滤和聚合
• ❌ 非 Vite 项目（Webpack / Rspack 后续考虑）
• ❌ 实时推送给 Agent（Agent 按需读取）
• ❌ 可视化 Dashboard

3.3 支持的埋点类型（MVP）

类型 说明 匹配方式
──────────────────────────────────────────────────────────────────────────
api_call API 请求发起 函数名匹配
api_response API 响应返回 函数名 + 调用上下文匹配
state_change 状态变更（setState / dispatch） 变量名 / 函数名匹配
branch_taken 条件分支走向 if/else/switch 位置匹配
user_interaction 用户交互事件 事件处理函数名匹配

---

4. 技术方案

4.1 架构图

┌─ vite.config.ts ────────────────────┐
│ plugins: [tracerVitePlugin(config)] │
└──────────────────────────────────────┘
│
▼ (buildTransform hook)
┌─ AST 转换层 ────────────────────────┐
│ ① 用 @babel/parser 解析产物 JS │
│ ② 遍历 AST 匹配 spec 中的关键路径 │
│ ③ 在匹配节点处插入 **rt_log() 调用 │
│ ④ 用 @babel/generator 生成代码 │
└──────────────────────────────────────┘
│
▼ (产物)
┌─ 运行时 ─────────────────────────────┐
│ 用户操作 → 业务逻辑 → **rt_log() │
│ │ │
│ fetch("http://localhost:9876/rt") │
└──────────────────────────────────────┘
│
▼
┌─ Log Server (port 9876) ────────────┐
│ Express / 原生 http │
│ POST /rt → 写入 JSONL │
│ .agent/tracer/logs/{session}.jsonl │
└──────────────────────────────────────┘

4.2 关键技术选型

层 选型 理由
─────────────────────────────────────────────────────────────────────────────────────────────────
AST 解析 @babel/parser + @babel/traverse + @babel/generator Vite 产物已经是 JS，Babel 生态成熟
插件 Hook transform（Vite 插件） 在产物生成前做最后的 AST 转换
本地服务 Node.js http 模块（零依赖） 足够简单，MVP 不引入框架
日志格式 JSONL（每行一个 JSON 对象） 流式追加友好，Agent 逐行读取

4.3 Spec 配置格式

// .agent/tracer.config.json
{
"version": 1,
"server": {
"port": 9876,
"endpoint": "/rt"
},
"log": {
"dir": ".agent/tracer/logs",
"maxLines": 500,
"clearOnBuild": true
},
"traces": [
{
"id": "fetchUserData",
"type": "api_call",
"match": {
"kind": "function_call", // 匹配函数调用
"name": "fetchUserData" // 函数名
},
"capture": ["arguments[0]", "returnValue"]
},
{
"id": "setUserAuth",
"type": "state_change",
"match": {
"kind": "assignment", // 匹配赋值操作
"name": "userAuth" // 变量名
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

4.4 注入效果

源码（不变）：

async function fetchUserData(id: number) {
const res = await api.get(`/user/${id}`)
setUserAuth(res.data)
return res.data
}

产物（插件注入后）：

async function fetchUserData(id: number) {
**rt_log("fetchUserData", "api_call", { "arguments[0]": id })
const res = await api.get(`/user/${id}`)
**rt_log("fetchUserData", "api_response", { returnValue: res.data })
setUserAuth(res.data)
return res.data
}

4.5 运行时日志格式（JSONL）

{"traceId":"abc123","eventId":"fetchUserData","type":"api_call","data":{"arguments[0]":1},"timestamp":1716000000000}
{"traceId":"abc123","eventId":"fetchUserData","type":"api_response","data":{"returnValue":{"name":"子蒙"}},"timestamp":1716000000100}
{"traceId":"abc123","eventId":"setUserAuth","type":"state_change","data":{"value":{"name":"子蒙"}},"timestamp":1716000000105}

4.6 项目目录结构

tracer/
├── package.json
├── src/
│ ├── index.ts # 插件入口
│ ├── vite-plugin.ts # Vite 插件主逻辑
│ ├── ast-injector.ts # AST 解析与注入
│ ├── runtime-helper.ts # \_\_rt_log 源码（将被注入）
│ ├── server.ts # 本地 log 接收服务
│ ├── config.ts # Spec 配置类型与加载
│ └── types.ts # 类型定义
├── example/ # 示例项目
│ ├── vite.config.ts
│ ├── .agent/tracer.config.json
│ └── src/
└── README.md

---

5. 用户使用流程

# 1. 安装

npm install -D tracer-vite-plugin

# 2. 配置 vite.config.ts

import { tracerVitePlugin } from 'tracer-vite-plugin'
export default {
plugins: [tracerVitePlugin()]
}

# 3. 编写 spec

# .agent/tracer.config.json

# 4. 启动（插件自动启动 log server）

npm run dev

# 5. 操作页面 → 自动产生 log

# 6. 在 Claude Code 中：

# "请读取 .agent/tracer/logs/ 下的最新日志，

# 结合 fetchUserData 的源码分析为什么返回了 undefined"

---

6. 里程碑

阶段 内容 预估
───────────────────────────────────────────────────────────────────
P0 跑通 Vite 插件 + AST 注入 + Log Server + JSONL 全链路 1 天
P1 支持 api_call/api_response/state_change 三种埋点类型 1 天
P2 支持 branch_taken/user_interaction 0.5 天
P3 写一个示例 React 项目 + Agent Prompt 示例 0.5 天

---

7. 风险与思考

风险 影响 缓解措施
─────────────────────────────────────────────────────────────────────────────────────────────────
AST 匹配精度不够，误埋或漏埋 Agent 拿到错误上下文 MVP 用函数名精确匹配，后续支持正则 / 代码位置
Log Server 增加心智负担 开发者觉得麻烦 MVP 中插件自动启动/关闭 server，开发者无感
埋点影响运行时性能 关键路径延迟 MVP 只埋少量关键点，后续支持采样率配置
产物体积变大 构建时间略增 埋点 helper 压缩后 < 1KB，影响可忽略

---

这份 PRD 和技术方案你觉得方向对吗？如果没问题我可以开始写代码了——先从 vite-plugin.ts + ast-injector.ts 的核心逻辑开始。
