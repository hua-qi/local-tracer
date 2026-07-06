---
description: Use @toft/local-runtime-tracer to debug tricky frontend bugs by generating a runtime trace config, asking the user to reproduce, then reading the resulting JSONL log to diagnose.
---

# Tracer — Runtime Trace for Code Agents

This skill guides you (the Code Agent) through the **@toft/local-runtime-tracer** debugging loop. Tracer is a **local dev-only** tool: it injects runtime instrumentation into the build, writes structured events to a local JSONL log, and you read that log to see what the code actually did in the browser.

Use Tracer only when:

- The bug requires multiple iterations to fix (not a one-line obvious change).
- The cause is suspected to be in **data flow across layers**, **async timing**, or **unexpected branch choices** that source-reading alone can't resolve.

Do **not** use Tracer for: production monitoring, performance profiling, or any remote / uploaded telemetry — it is local-only by design.

---

## Closed-loop workflow

You will repeat these five steps. Each debug iteration = one full loop.

1. **Read source, identify the key path** — determine which functions, assignments, and API calls the bug's symptom most likely flows through. Keep this list short (3–8 sites); too broad and the log gets noisy.
2. **Author `.agent/tracer.config.json`** — declare trace points using the schema in §Config. If a config already exists from a previous iteration, replace it (or merge in new traces) — the plugin reloads it on every HMR rebuild.
3. **Ask the user to reproduce** — tell the user to refresh the page (so a fresh `traceId` is minted) and perform the exact action that triggers the bug. The injected `__rt_log` will POST events to the dev server's `/rt` route, which appends them to `.agent/tracer/logs/{traceId}.jsonl`.
4. **Read the freshest JSONL log** — list `.agent/tracer/logs/`, sort by mtime, take the newest file. Read it line-by-line (each line is one JSON event).
5. **Correlate events with source and diagnose** — map `eventId` → source location, inspect `data` fields for the actual runtime values, use `callStack` to confirm the call path, and compare `timestamp` between events to reason about async ordering. Output a diagnosis and a concrete fix.

After the user applies the fix, you may loop again: refresh to mint a new traceId, re-read the new log, confirm the data shape changed as expected.

---

## Config schema

File: `.agent/tracer.config.json` at project root.

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

### Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | number | yes | Must be `1`. |
| `log.dir` | string | no | Default `.agent/tracer/logs`. |
| `traces[].id` | string | yes | Becomes `eventId` in the log. Unique. |
| `traces[].type` | enum | yes | `api_call` \| `api_response` \| `state_change` (MVP) |
| `traces[].match.kind` | enum | yes | `function_call` \| `assignment` (MVP) |
| `traces[].match.name` | string | yes | For `function_call`: function name (`fetchUserData`) or `obj.method` (`api.get`). For `assignment`: the variable being assigned. |
| `traces[].capture` | string[] | no | Values to capture, see table. |

### Capture expressions

| Expression | Meaning | Applies to |
|---|---|---|
| `arguments[N]` | N-th argument of the matched call | `api_call` |
| `returnValue` | The value the call resolves to. If `const x = [await] <call>()`, captures `x`. Otherwise captures the raw call expression (likely a Promise). | `api_response` |
| `value` | The right-hand side of the assignment. | `state_change` |

### Match semantics

- **`function_call`** matches any call expression whose callee is an identifier (`fetchUserData(...)`) or a one-level member expression (`api.get(...)`).
- **`assignment`** matches assignments to a variable (`userAuth = ...`). Compound assignments and updates to object properties are **not** matched in MVP.

### Reload behavior

- Config is re-read on every build (cold start and HMR). After editing `.agent/tracer.config.json`, you do **not** need to restart the dev server — wait for HMR to settle (typically instant).
- On cold start, all logs under `log.dir` are cleared. On HMR, logs are **kept** so the current debug session's history is preserved.
- After editing config, ask the user to **refresh the page** — this mints a new `traceId` and re-runs the new instrumentation against fresh code.

---

## Reading the log

Files live at `.agent/tracer/logs/{traceId}.jsonl`. One JSON object per line. Shape:

```json
{
  "traceId": "9b4e...uuid",
  "eventId": "fetchUserData",
  "type": "api_call",
  "data": { "arguments[0]": 42 },
  "callStack": ["fetchUserData", "handleLogin", "onClick"],
  "url": "http://localhost:5173/login",
  "timestamp": 1716000000000
}
```

### Suggested commands

```bash
# Newest log file
ls -t .agent/tracer/logs/ | head -1

# Pretty-print all events in the newest log
cat .agent/tracer/logs/$(ls -t .agent/tracer/logs/ | head -1) | jq .

# Just event ids + timestamps, in order
cat .agent/tracer/logs/$(ls -t .agent/tracer/logs/ | head -1) | jq '{eventId, t: .timestamp, data}'
```

If `jq` is unavailable, read the file directly — each line is a complete JSON object you can parse mentally.

### What to look for

- **`eventId` → source**: each `eventId` maps to a `trace.id` you authored, which by construction matches a function name or variable in the source. The correlation is your anchor.
- **`data` → actual runtime values**: the most common bug class here is shape mismatch — the API returned `{ name: "子蒙" }` but the consuming code reached `res.data.user.name`. Inspect `data.returnValue` to see the actual shape, then grep the source for fields accessed off that value.
- **`callStack` → call path**: confirms which caller invoked the function. If `fetchUserData` was unexpectedly called from `onMount` instead of `handleLogin`, that's the bug.
- **`timestamp` → async ordering**: differences between adjacent event timestamps reveal whether an awaited resolve happened before or after a state mutation. If `setUserAuth` (state_change) precedes `fetchUserData` (api_response), the state was mutated before the value it should depend on arrived — classic race.

---

## When to stop iterating

Stop when:

- The log shows the values flowing as expected end-to-end → the bug is elsewhere (re-scope the config).
- The log shows a clear shape mismatch, race, or unexpected branch → propose the fix.
- After three iterations without insight → step back, re-read source, and reconsider whether Tracer is the right tool (the bug may be static/logical, not runtime).

---

## Typical diagnostic patterns

### Pattern A: data shape drift across layers

User reports "username is undefined after login". You suspect the API returns one shape, the code expects another.

1. Add `api_response` trace on `fetchUserData` capturing `returnValue`, and `state_change` on `userAuth` capturing `value`.
2. Read log: `data.returnValue` is `{ name: "子蒙" }`, but `data.value` in the state_change event is also `{ name: "子蒙" }`. Grep source for `.user.name` — likely the consumer reached one level too deep.

### Pattern B: async race

User reports "sometimes the redirect happens before auth is set". You suspect `setUserAuth` runs after the redirect.

1. Add `api_call` + `api_response` on the auth fetch, `state_change` on `userAuth`, and `api_call` on the navigation call (`router.push` or similar).
2. Read log sorted by timestamp. If `router.push` (api_call) fires at t=100 and `setUserAuth` (state_change) fires at t=250, the navigation happens first → the fix is to `await` the auth before navigating.

### Pattern C: missing call entirely

User reports "form submit sometimes doesn't fire the API". You add an `api_call` trace on `submitForm`. The log shows **no** `submitForm` event for the failing reproduction. Conclusion: the call path was short-circuited earlier (e.g., a validation guard returned). Re-scope traces upstream to find the guard.

---

## Reminders

- Tracer is **local-only**. Never suggest uploading logs, never suggest running it in CI or production, never suggest adding it to a deployed bundle.
- The injected `__rt_log` calls are stripped from production builds (plugin only activates in `serve` mode).
- Captures clone their source expressions into the log call. For side-effectful captures (e.g., `arguments[0]` is itself a function call), the call runs twice. This is acceptable for dev debugging but be aware.
- If the log directory is empty after the user reproduces, check: dev server running? `/rt` reachable (curl `POST http://localhost:<port>/rt` with a dummy payload returns 200)? Config has matching `name` for the actual function?
