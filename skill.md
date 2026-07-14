---
description: 使用 @toft/local-tracer 调试棘手的前端 bug：生成运行时追踪配置，让用户复现问题，然后读取生成的 JSONL 日志来诊断问题。
---

# Tracer — Code Agent 运行时追踪

本技能指导你（Code Agent）完成 **@toft/local-tracer** 调试循环。Tracer 是一个**本地开发专用**工具：它在构建阶段注入运行时探针，将结构化事件写入本地 JSONL 日志，你则通过读取该日志来了解代码在浏览器中的实际行为。

仅在以下场景使用 Tracer：

- Bug 需要多次迭代才能修复（而非显而易见的一行改动）。
- 疑似原因在于**跨层数据流**、**异步时序**或**非预期的分支选择**，仅靠阅读源码无法定位。

**不要**将 Tracer 用于：生产监控、性能分析或任何远程 / 上传遥测——它设计为纯本地工具。

---

## 闭环工作流

你需要重复以下五个步骤。每次调试迭代 = 一个完整循环。

1. **阅读源码，定位关键路径**——确定 bug 症状最可能流经的函数、赋值和 API 调用。保持列表精简（3-8 个追踪点）；范围太广会导致日志噪音过多。
2. **编写 `.agent/tracer.config.json`**——按照 §配置 中的 schema 声明追踪点。如果已有上一轮迭代的配置文件，替换它（或合并新的追踪点）——插件会在每次 HMR 重建时重新加载。
3. **让用户复现**——告诉用户刷新页面（以生成新的 `traceId`），然后执行触发 bug 的确切操作。注入的 `__rt_log` 会将事件 POST 到开发服务器的 `/rt` 路由，该路由将事件追加到 `.agent/tracer/logs/{traceId}.jsonl`。
4. **读取最新的 JSONL 日志**——列出 `.agent/tracer/logs/`，按修改时间排序，取最新的文件。逐行读取（每行一个 JSON 事件）。
5. **将事件与源码关联并诊断**——将 `eventId` 映射到源码位置，检查 `data` 字段中的实际运行时值，使用 `callStack` 确认调用路径，比较事件之间的 `timestamp` 来推断异步执行顺序。输出诊断结论和具体修复方案。

用户应用修复后，你可以再次循环：刷新以生成新的 traceId，重新读取新日志，确认数据形态按预期变化。

---

## 配置 Schema

文件位置：项目根目录下的 `.agent/tracer.config.json`。

```json
{
  "version": 1,
  "log": { "dir": ".agent/tracer/logs" },
  "traces": [
    {
      "id": "fetchUserData",
      "type": "api_call",
      "match": { "kind": "function_call", "name": "fetchUserData" },
      "capture": ["arguments[0]"]
    },
    {
      "id": "fetchUserDataResp",
      "type": "api_response",
      "match": { "kind": "function_call", "name": "fetchUserData" },
      "capture": ["returnValue"]
    },
    {
      "id": "setUserAuth",
      "type": "state_change",
      "match": { "kind": "assignment", "name": "userAuth" },
      "capture": ["value"]
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `version` | number | 是 | 必须为 `1`。 |
| `log.dir` | string | 否 | 默认为 `.agent/tracer/logs`。 |
| `traces[].id` | string | 是 | 对应日志中的 `eventId`。必须唯一。 |
| `traces[].type` | enum | 是 | `api_call` \| `api_response` \| `state_change` \| `error` |
| `traces[].match.kind` | enum | 是 | `function_call` \| `assignment`（MVP） |
| `traces[].match.name` | string | 是 | `function_call`：函数名（`fetchUserData`）或 `obj.method`（`api.get`）。`assignment`：被赋值的变量名。 |
| `traces[].capture` | string[] | 否 | 要捕获的值，见下表。 |

### 捕获表达式

| 表达式 | 含义 | 适用于 |
|---|---|---|
| `arguments[N]` | 匹配调用的第 N 个参数 | `api_call`、`error` |
| `returnValue` | 调用返回的值。若为 `const x = [await] <call>()`，捕获 `x`。否则捕获原始调用表达式（通常为 Promise）。 | `api_response` |
| `value` | 赋值语句的右侧值。 | `state_change` |

### 匹配语义

- **`function_call`** 匹配被调用者为标识符（`fetchUserData(...)`）或一级成员表达式（`api.get(...)`）的调用表达式。
- **`assignment`** 匹配对变量的赋值（`userAuth = ...`）。复合赋值和对对象属性的更新在 MVP 中**不**匹配。

### 重载行为

- 每次构建（冷启动和 HMR）都会重新读取配置。编辑 `.agent/tracer.config.json` 后**无需**重启开发服务器——等待 HMR 完成即可（通常瞬间完成）。
- 冷启动时，`log.dir` 下的所有日志会被清空。HMR 时日志**保留**，以保证当前调试会话的历史记录不丢失。
- 编辑配置后，让用户**刷新页面**——这会生成新的 `traceId`，并用新的探针重新运行代码。

---

## 读取日志

日志文件位于 `.agent/tracer/logs/{traceId}.jsonl`。每行一个 JSON 对象。格式：

```json
{
  "seq": 0,
  "traceId": "9b4e...uuid",
  "eventId": "fetchUserData",
  "type": "api_call",
  "timestamp": 1716000000000,
  "data": { "arguments[0]": 42 },
  "request": { "method": "GET", "url": "/api/users", "headers": {}, "body": null },
  "error": null,
  "callStack": [
    { "function": "fetchUserData", "file": "src/api.ts", "line": 45, "col": 12 },
    { "function": "handleLogin", "file": "src/login.ts", "line": 100, "col": 5 }
  ],
  "url": "http://localhost:5173/login"
}
```

### 推荐命令

```bash
# 获取最新日志文件
ls -t .agent/tracer/logs/ | head -1

# 格式化打印最新日志中的所有事件
cat .agent/tracer/logs/$(ls -t .agent/tracer/logs/ | head -1) | jq .

# 仅打印 eventId + 时间戳 + data，按顺序排列
cat .agent/tracer/logs/$(ls -t .agent/tracer/logs/ | head -1) | jq '{eventId, t: .timestamp, data}'
```

如果没有 `jq`，直接读取文件——每行都是完整的 JSON 对象，可以直接阅读理解。

### 需要关注的内容

- **`seq` → 事件顺序**：会话内单调递增的序号，用于精确判断事件发生先后。比 `timestamp` 更可靠（不受时钟偏差影响）。
- **`eventId` → 源码**：每个 `eventId` 对应你编写的 `trace.id`，按约定它与源码中的函数名或变量名匹配。这个关联是你的锚点。
- **`type` → 事件类型**：`api_call`（函数被调用）、`api_response`（函数返回）、`error`（函数抛异常）、`state_change`（状态变更）。
- **`data` → 实际运行时值**：这里最常见的 bug 类型是数据形态不匹配——API 返回了 `{ name: "子蒙" }`，但消费层代码访问的是 `res.data.user.name`。检查 `data.returnValue` 查看实际形态，然后在源码中搜索该值上被访问的字段。
- **`error` → 异常信息**：当 type 为 `error` 时，此字段包含 `{message, name}`，记录被追踪函数抛出的异常详情。
- **`callStack` → 调用路径**：全量调用栈，每帧包含 `{function, file, line, col}` 用于定位到源码行列。确认哪个调用者触发了该函数。如果 `fetchUserData` 意外地从 `onMount` 调用而非 `handleLogin`，那就是 bug。
- **`timestamp` → 异步顺序**：相邻事件的时间戳差异揭示了一个 await resolve 是在某个状态变更之前还是之后发生的。如果 `setUserAuth`（state_change）在 `fetchUserData`（api_response）之前触发，说明状态在它应依赖的值到达之前就被变更了——经典的竞态问题。

---

## 何时停止迭代

满足以下条件时停止：

- 日志显示数据端到端按预期流转 → bug 在别处（重新设定配置范围）。
- 日志显示明显的数据形态不匹配、竞态或意外分支 → 提出修复方案。
- 三轮迭代后仍无头绪 → 退后一步，重新阅读源码，重新评估 Tracer 是否适用（bug 可能是静态/逻辑问题，而非运行时问题）。

---

## 典型诊断模式

### 模式 A：跨层数据形态漂移

用户报告"登录后 username 为 undefined"。你怀疑 API 返回了某种形态，而代码期望的是另一种形态。

1. 在 `fetchUserData` 上添加 `api_response` 追踪，捕获 `returnValue`；在 `userAuth` 上添加 `state_change` 追踪，捕获 `value`。
2. 读取日志：`data.returnValue` 为 `{ name: "子蒙" }`，state_change 事件中的 `data.value` 也是 `{ name: "子蒙" }`。在源码中搜索 `.user.name`——消费层代码很可能多访问了一层。

### 模式 B：异步竞态

用户报告"有时重定向在 auth 设置之前发生"。你怀疑 `setUserAuth` 在重定向之后执行。

1. 在 auth 请求上添加 `api_call` + `api_response` 追踪，在 `userAuth` 上添加 `state_change` 追踪，在导航调用（`router.push` 等）上添加 `api_call` 追踪。
2. 按时间戳排序读取日志。如果 `router.push`（api_call）在 t=100 触发，`setUserAuth`（state_change）在 t=250 才触发，说明导航先执行了 → 修复方案是在导航之前 `await` auth 操作。

### 模式 C：函数抛异常

用户报告"点击登录按钮后页面崩溃白屏"。你怀疑 `fetchUserData` 内部抛出了异常。

1. 在 `fetchUserData` 上添加 `api_call` + `error` 追踪，捕获 `arguments[0]`。
2. 读取日志：`type: "error"` 事件的 `error.message` 为 `"Cannot read property 'id' of undefined"`，说明入参的第 0 个参数的 `id` 属性为 undefined。
3. 回查 `data.arguments[0]` 确认入参的实际值，定位上游传参问题。

### 模式 D：调用完全缺失

用户报告"表单提交有时不触发 API"。你添加了 `submitForm` 的 `api_call` 追踪。对于失败的复现，日志中**没有** `submitForm` 事件。结论：调用路径在上游被截断（例如验证守卫提前返回了）。在上游重新设定追踪范围以找到该守卫。

---

## 注意事项

- Tracer 是**纯本地**工具。不要建议上传日志，不要建议在 CI 或生产环境中运行，不要建议加入到部署产物中。
- 注入的 `__rt_log` 调用在生产构建中会被剥离（插件仅在 `serve` 模式下激活）。
- 捕获表达式的值会被克隆到 log 调用中。对于有副作用的捕获表达式（例如 `arguments[0]` 本身是一个函数调用），该调用会执行两次。这在开发调试中是可接受的，但需注意。
- 如果用户复现后日志目录为空，请检查：开发服务器是否在运行？`/rt` 路由是否可达（`curl POST http://localhost:<port>/rt` 发送假数据返回 200）？配置中的 `name` 是否与实际函数名匹配？
