import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RUNTIME_HELPER_SOURCE } from '../src/core/runtime-helper.js'

function setupWindow() {
  const w: any = {}
  w.crypto = { randomUUID: () => 'uuid-1234' }
  w.fetch = vi.fn(() => Promise.resolve({ ok: true }))
  w.location = { href: 'http://localhost:5173/login' }
  return w
}

function loadHelper(globalScope: any) {
  // Run the helper source in a function with the global scope as `this`.
  // The helper references `window` and `location` — bridge them via globalScope.
  const fn = new Function('window', 'location', 'crypto', 'fetch', 'Date', RUNTIME_HELPER_SOURCE + '\nreturn { __rt_log, __TRACER_SESSION_ID__ };')
  return fn(globalScope, globalScope.location, globalScope.crypto, globalScope.fetch, Date)
}

describe('runtime-helper', () => {
  let w: any
  let api: any
  beforeEach(() => {
    w = setupWindow()
    api = loadHelper(w)
  })

  it('generates a session id on first call', () => {
    api.__rt_log('e', 'api_call', { a: 1 })
    expect(w.__TRACER_SESSION_ID__).toBe('uuid-1234')
  })

  it('reuses session id across calls', () => {
    api.__rt_log('e1', 'api_call', {})
    api.__rt_log('e2', 'api_call', {})
    const calls = w.fetch.mock.calls
    const t1 = JSON.parse(calls[0][1].body).traceId
    const t2 = JSON.parse(calls[1][1].body).traceId
    expect(t1).toBe(t2)
    expect(t1).toBe('uuid-1234')
  })

  it('assembles a complete payload shape', () => {
    api.__rt_log('fetchUserData', 'api_call', { 'arguments[0]': 1 })
    const call = w.fetch.mock.calls[0]
    expect(call[0]).toBe('/rt')
    expect(call[1].method).toBe('POST')
    expect(call[1].headers['Content-Type']).toBe('application/json')
    expect(call[1].keepalive).toBe(true)
    const payload = JSON.parse(call[1].body)
    expect(payload.eventId).toBe('fetchUserData')
    expect(payload.type).toBe('api_call')
    expect(payload.data).toEqual({ 'arguments[0]': 1 })
    expect(payload.url).toBe('http://localhost:5173/login')
    expect(payload.traceId).toBe('uuid-1234')
    expect(payload.callStack).toBeInstanceOf(Array)
    expect(typeof payload.timestamp).toBe('number')
    expect(typeof payload.seq).toBe('number')
    expect(payload.error).toBeNull()
  })

  it('increments seq on each call', () => {
    api.__rt_log('e1', 'api_call', {})
    api.__rt_log('e2', 'api_call', {})
    api.__rt_log('e3', 'api_call', {})
    const calls = w.fetch.mock.calls
    expect(JSON.parse(calls[0][1].body).seq).toBe(0)
    expect(JSON.parse(calls[1][1].body).seq).toBe(1)
    expect(JSON.parse(calls[2][1].body).seq).toBe(2)
  })

  it('callStack entries are structured objects', () => {
    api.__rt_log('e', 'api_call', {})
    const call = w.fetch.mock.calls[0]
    const payload = JSON.parse(call[1].body)
    expect(payload.callStack.length).toBeGreaterThan(0)
    for (const frame of payload.callStack) {
      expect(frame).toHaveProperty('function')
      expect(frame).toHaveProperty('file')
      expect(frame).toHaveProperty('line')
      expect(frame).toHaveProperty('col')
      expect(typeof frame.function).toBe('string')
      expect(typeof frame.file).toBe('string')
      expect(typeof frame.line).toBe('number')
      expect(typeof frame.col).toBe('number')
    }
  })

  it('populates error field when errorInfo is passed', () => {
    api.__rt_log('e', 'error', {}, { message: 'Something broke', name: 'TypeError' })
    const call = w.fetch.mock.calls[0]
    const payload = JSON.parse(call[1].body)
    expect(payload.type).toBe('error')
    expect(payload.error).toEqual({ message: 'Something broke', name: 'TypeError' })
  })

  it('sets error field to null when no errorInfo provided', () => {
    api.__rt_log('e', 'api_call', {})
    const call = w.fetch.mock.calls[0]
    const payload = JSON.parse(call[1].body)
    expect(payload.error).toBeNull()
  })

  it('swallows fetch failures silently', async () => {
    w.fetch = vi.fn(() => Promise.reject(new Error('network')))
    const api2 = loadHelper(w)
    expect(() => api2.__rt_log('e', 'api_call', {})).not.toThrow()
    await Promise.resolve()
  })
})
