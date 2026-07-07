# Tracer Skill

## Purpose

TBD

## Requirements

### Requirement: Skill 文件交付
仓库 SHALL 在 `skill.md` 提供 Code Agent 的使用指引，用户通过 `cp node_modules/@toft/local-runtime-tracer/skill.md .claude/skills/tracer.md` 手动安装。

#### Scenario: 用户安装 skill
- **WHEN** 用户执行 `cp node_modules/@toft/local-runtime-tracer/skill.md .claude/skills/tracer.md`
- **THEN** Claude Code 在后续会话中可调用 tracer skill

### Requirement: Skill 指导 config 生成
skill.md SHALL 包含 `.agent/tracer.config.json` 的格式说明、字段语义、示例片段，以便 Agent 阅读相关源码后自行生成配置。

#### Scenario: Agent 写 config
- **WHEN** Agent 收到调试任务并阅读相关源码
- **THEN** Agent 按照 skill.md 描述的 schema 写出合法的 `.agent/tracer.config.json`

### Requirement: Skill 指导日志消费
skill.md SHALL 指导 Agent 读取 `.agent/tracer/logs/` 下最新的 .jsonl（按 mtime 排序取最新），逐行解析 payload，将 `eventId`、`callStack`、`data` 与源码位置关联以定位 bug 根因。

#### Scenario: Agent 读日志
- **WHEN** 用户已操作页面触发埋点，Agent 接到分析任务
- **THEN** Agent 按 skill.md 指引列出 logs 目录、读取最新 .jsonl、关联源码分析问题

### Requirement: Skill 提醒页内操作
skill.md SHALL 明确告知 Agent：在生成或修改 config 后需要提示用户刷新页面（如需立即生效）或在浏览器中操作目标流程，以便触发埋点上报。

#### Scenario: 提示用户操作
- **WHEN** Agent 完成 config 生成
- **THEN** Agent 向用户输出明确动作指令（如「请刷新 localhost:5173 并触发登录流程」）
