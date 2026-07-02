// End-to-end smoke test for the Vite plugin.
// Spawns `vite dev`, POSTs a fake __rt_log payload to /rt, verifies the JSONL
// log file is written, and tears the server down.
import { spawn } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const logDir = resolve(root, '.agent/tracer/logs')

rmSync(logDir, { recursive: true, force: true })

const vite = spawn('npx', ['vite', '--port', '5183', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
vite.stdout.on('data', (c) => {
  stdout += c.toString()
  process.stdout.write('[vite] ' + c)
})
vite.stderr.on('data', (c) => process.stderr.write('[vite!] ' + c))

function exit(code) {
  vite.kill('SIGTERM')
  setTimeout(() => {
    vite.kill('SIGKILL')
    process.exit(code)
  }, 500)
}

async function waitFor(predicate, { timeout = 15000, interval = 250 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`waitFor: timed out after ${timeout}ms`)
}

async function post(path, body) {
  const res = await fetch('http://localhost:5183' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

try {
  await waitFor(() => stdout.includes('Local:   http://localhost:5183') || stdout.includes('ready in'), {
    timeout: 30000,
  })

  const payload = {
    traceId: 'e2e-vite-trace',
    eventId: 'fetchUserData',
    type: 'api_call',
    data: { 'arguments[0]': 1 },
    callStack: ['fetchUserData', 'handleLogin'],
    url: 'http://localhost:5183/',
    timestamp: Date.now(),
  }

  const { status, text } = await post('/rt', payload)
  if (status !== 200 || text !== 'ok') {
    console.error(`FAIL: /rt returned ${status} "${text}"`)
    exit(1)
  }

  // Verify the main entry module gets __rt_log injected.
  const mainRes = await fetch('http://localhost:5183/src/main.tsx')
  const mainText = await mainRes.text()
  if (!mainText.includes('__rt_log')) {
    console.error('FAIL: main.tsx was not instrumented with __rt_log')
    exit(1)
  }

  const logFile = resolve(logDir, 'e2e-vite-trace.jsonl')
  if (!existsSync(logFile)) {
    console.error('FAIL: log file was not created')
    exit(1)
  }
  const line = readFileSync(logFile, 'utf-8').trim()
  if (JSON.parse(line).eventId !== 'fetchUserData') {
    console.error('FAIL: log content mismatch')
    exit(1)
  }

  console.log('\n✓ e2e passed: /rt accepted payload, transform injected __rt_log, log file written')
  exit(0)
} catch (e) {
  console.error('e2e error:', e)
  exit(1)
}
