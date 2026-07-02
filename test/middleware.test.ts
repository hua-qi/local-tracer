import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createTracerMiddleware } from '../src/core/middleware.js'

class FakeReq extends EventEmitter {
  method = 'POST'
  url = '/rt'
  private readonly _body: Buffer
  constructor(body: string) {
    super()
    this._body = Buffer.from(body, 'utf-8')
  }
  emitBody() {
    setImmediate(() => {
      this.emit('data', this._body)
      this.emit('end')
    })
  }
}

class FakeRes {
  status?: number
  body?: string
  writeHead(status: number) {
    this.status = status
  }
  end(body?: string) {
    this.body = body
  }
}

function call(middleware: any, body: string): Promise<{ status?: number; body?: string }> {
  const req = new FakeReq(body)
  const res = new FakeRes()
  return new Promise((resolve) => {
    middleware(req, res, () => {
      resolve({ status: 404, body: 'next' })
    })
    req.emitBody()
    setTimeout(() => resolve({ status: res.status, body: res.body }), 50)
  })
}

describe('createTracerMiddleware', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracer-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a valid payload to {traceId}.jsonl and returns 200', async () => {
    const logDir = join(dir, 'logs')
    const mw = createTracerMiddleware({ logDir })
    const payload = {
      traceId: 'abc',
      eventId: 'fetchUserData',
      type: 'api_call',
      data: { x: 1 },
      callStack: [],
      url: 'http://localhost:5173',
      timestamp: 1716000000000,
    }
    const res = await call(mw, JSON.stringify(payload))
    expect(res.status).toBe(200)
    expect(res.body).toBe('ok')
    const file = join(logDir, 'abc.jsonl')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf-8').trim()).toBe(JSON.stringify(payload))
  })

  it('appends multiple payloads to the same jsonl file', async () => {
    const mw = createTracerMiddleware({ logDir: join(dir, 'logs') })
    await call(mw, JSON.stringify({ traceId: 't', eventId: 'a', type: 'api_call', timestamp: 1 }))
    await call(mw, JSON.stringify({ traceId: 't', eventId: 'b', type: 'api_call', timestamp: 2 }))
    const file = join(dir, 'logs', 't.jsonl')
    const lines = readFileSync(file, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).eventId).toBe('a')
    expect(JSON.parse(lines[1]).eventId).toBe('b')
  })

  it('returns 400 when traceId is missing', async () => {
    const mw = createTracerMiddleware({ logDir: join(dir, 'logs') })
    const res = await call(mw, JSON.stringify({ eventId: 'x', type: 'api_call', timestamp: 1 }))
    expect(res.status).toBe(400)
    const file = join(dir, 'logs', 'x.jsonl')
    expect(existsSync(file)).toBe(false)
  })

  it('returns 400 when body is not JSON', async () => {
    const mw = createTracerMiddleware({ logDir: join(dir, 'logs') })
    const res = await call(mw, 'not json{')
    expect(res.status).toBe(400)
  })

  it('returns 400 when eventId is missing', async () => {
    const mw = createTracerMiddleware({ logDir: join(dir, 'logs') })
    const res = await call(mw, JSON.stringify({ traceId: 't', type: 'api_call', timestamp: 1 }))
    expect(res.status).toBe(400)
  })

  it('passes through non-POST requests via next()', async () => {
    const mw = createTracerMiddleware({ logDir: join(dir, 'logs') })
    const req: any = new EventEmitter()
    req.method = 'GET'
    req.url = '/rt'
    const res = new FakeRes()
    const result = await new Promise<{ status?: number; body?: string }>((resolve) => {
      mw(req as any, res as any, () => resolve({ status: 404, body: 'next' }))
      setTimeout(() => resolve({ status: 404, body: 'next' }), 30)
    })
    expect(result.body).toBe('next')
  })

  it('passes through non-/rt paths via next()', async () => {
    const mw = createTracerMiddleware({ logDir: join(dir, 'logs') })
    const req: any = new EventEmitter()
    req.method = 'POST'
    req.url = '/other'
    const res = new FakeRes()
    const result = await new Promise<{ status?: number; body?: string }>((resolve) => {
      mw(req as any, res as any, () => resolve({ status: 404, body: 'next' }))
      setTimeout(() => resolve({ status: 404, body: 'next' }), 30)
    })
    expect(result.body).toBe('next')
  })

  it('creates nested log dir if missing', async () => {
    const nested = join(dir, 'deep', 'logs')
    const mw = createTracerMiddleware({ logDir: nested })
    const res = await call(mw, JSON.stringify({ traceId: 't', eventId: 'e', type: 'api_call', timestamp: 1 }))
    expect(res.status).toBe(200)
    expect(existsSync(join(nested, 't.jsonl'))).toBe(true)
  })
})
