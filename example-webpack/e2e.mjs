// End-to-end smoke test for the Webpack plugin.
// Mirrors example-vite/e2e.mjs but against webpack-dev-server.
import { spawn } from 'node:child_process'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const logDir = resolve(root, '.agent/tracer/logs')

rmSync(logDir, { recursive: true, force: true })

const wds = spawn('npx', ['webpack', 'serve', '--port', '5184'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
wds.stdout.on('data', (c) => {
  stdout += c.toString()
  process.stdout.write('[wds] ' + c)
})
wds.stderr.on('data', (c) => process.stderr.write('[wds!] ' + c))

function exit(code) {
  wds.kill('SIGTERM')
  setTimeout(() => {
    wds.kill('SIGKILL')
    process.exit(code)
  }, 500)
}

async function waitForReady() {
  // Probe the health endpoint — when wds is listening, /health returns 200.
  // Fall back to grepping stdout for "listening".
  const start = Date.now()
  while (Date.now() - start < 30000) {
    try {
      const r = await fetch('http://localhost:5184/health')
      if (r.status === 200) return
    } catch {}
    if (stdout.includes('listening')) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('webpack-dev-server did not become ready')
}

async function post(path, body) {
  const res = await fetch('http://localhost:5184' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

try {
  await waitForReady()

  const payload = {
    traceId: 'e2e-webpack-trace',
    eventId: 'fetchUserData',
    type: 'api_call',
    data: { 'arguments[0]': 1 },
    callStack: ['fetchUserData'],
    url: 'http://localhost:5184/',
    timestamp: Date.now(),
  }

  const { status, text } = await post('/rt', payload)
  if (status !== 200 || text !== 'ok') {
    console.error(`FAIL: /rt returned ${status} "${text}"`)
    exit(1)
  }

  // Verify the bundle contains __rt_log instrumentation.
  const bundleRes = await fetch('http://localhost:5184/bundle.js')
  const bundleText = await bundleRes.text()
  if (!bundleText.includes('__rt_log')) {
    console.error('FAIL: bundle.js was not instrumented with __rt_log')
    exit(1)
  }

  const logFile = resolve(logDir, 'e2e-webpack-trace.jsonl')
  if (!existsSync(logFile)) {
    console.error('FAIL: log file was not created')
    exit(1)
  }
  const line = readFileSync(logFile, 'utf-8').trim()
  if (JSON.parse(line).eventId !== 'fetchUserData') {
    console.error('FAIL: log content mismatch')
    exit(1)
  }

  console.log('\n✓ e2e passed: /rt accepted payload, bundle contains __rt_log, log file written')
  exit(0)
} catch (e) {
  console.error('e2e error:', e)
  exit(1)
}
