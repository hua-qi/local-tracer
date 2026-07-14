import { appendFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export interface TracerMiddlewareOptions {
  logDir: string
}

export type NextFunction = () => void
export interface TracerRequest {
  method?: string
  url?: string
  on?(event: string, listener: (chunk: Buffer) => void): unknown
  body?: unknown
}
export interface TracerResponse {
  writeHead?(status: number, headers?: Record<string, string>): unknown
  end?(body?: string | Buffer): unknown
}

const REQUIRED_FIELDS = ['seq', 'traceId', 'eventId', 'type', 'timestamp'] as const

/**
 * Create a dev-server middleware that accepts POST /rt and appends the JSON
 * payload to {logDir}/{traceId}.jsonl. Other requests are passed through.
 *
 * Engine-agnostic: takes connect-style (req, res, next) — works under both
 * Vite (`server.middlewares.use`) and webpack-dev-server (`setupMiddlewares`).
 */
export function createTracerMiddleware(options: TracerMiddlewareOptions) {
  const logDir = resolve(options.logDir)
  return function tracerMiddleware(
    req: TracerRequest,
    res: TracerResponse,
    next: NextFunction,
  ): void {
    if (req.method !== 'POST') return next()
    const url = req.url ?? ''
    if (url.split('?')[0] !== '/rt') return next()

    const chunks: Buffer[] = []
    const onData = (chunk: Buffer) => chunks.push(chunk)
    const onEnd = () => {
      const buf = Buffer.concat(chunks)
      let payload: any
      try {
        payload = JSON.parse(buf.toString('utf-8'))
      } catch {
        respond(res, 400, 'invalid json')
        return
      }
      if (!payload || typeof payload !== 'object') {
        respond(res, 400, 'invalid payload')
        return
      }
      for (const field of REQUIRED_FIELDS) {
        if (payload[field] === undefined || payload[field] === null) {
          respond(res, 400, `missing field: ${field}`)
          return
        }
      }
      const traceId = String(payload.traceId)
      if (!traceId) {
        respond(res, 400, 'empty traceId')
        return
      }
      try {
        mkdirSync(logDir, { recursive: true })
        appendFileSync(resolve(logDir, `${traceId}.jsonl`), JSON.stringify(payload) + '\n')
      } catch (e) {
        respond(res, 500, 'write failed')
        return
      }
      respond(res, 200, 'ok')
    }
    const onError = () => {
      try { respond(res, 400, 'read error') } catch { /* ignore */ }
    }

    // If a concrete pre-parsed JS object body is present (e.g., express json()
    // middleware that already ran), accept it directly. A Buffer/string body
    // means raw bytes we still need to consume via the stream events below.
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      const buf = Buffer.from(JSON.stringify(req.body), 'utf-8')
      chunks.push(buf)
      onEnd()
      return
    }

    req.on?.('data', onData)
    req.on?.('end', onEnd)
    req.on?.('error', onError)
  }
}

function respond(res: TracerResponse, status: number, body: string): void {
  res.writeHead?.(status, { 'Content-Type': 'text/plain' })
  res.end?.(body)
}
