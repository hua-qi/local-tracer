import { describe, it, expect } from 'vitest'
import { inject } from '../src/core/ast-injector.js'
import { validateConfig, buildMatcherIndex } from '../src/core/config.js'

function idx(traces: any[]) {
  return buildMatcherIndex(validateConfig({ version: 1, traces }))
}

describe('inject', () => {
  it('injects api_call before the call', () => {
    const code = `
async function fetchUserData(id) {
  const res = await fetchUserData(id)
  return res
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', name: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("fetchUserData", "api_call"')
    expect(result.code).toContain('"arguments[0]": id')
  })

  it('injects api_response after the call capturing the bound variable', () => {
    const code = `
async function run() {
  const res = await api.get('/user')
  return res
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'getUser',
          type: 'api_response',
          match: { kind: 'function_call', name: 'api.get' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    // returnValue should reference `res` (the binding), not the raw call expression
    expect(result.code).toMatch(/returnValue: res\b/)
  })

  it('injects state_change after the assignment with the RHS value', () => {
    const code = `
function apply(data) {
  userAuth = data
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'setUserAuth',
          type: 'state_change',
          match: { kind: 'assignment', name: 'userAuth' },
          capture: ['value'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("setUserAuth", "state_change"')
    expect(result.code).toMatch(/value: data\b/)
  })

  it('prepends the runtime helper when injection occurs', () => {
    const code = `fetchUserData(1)`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', name: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.code).toContain('function __rt_log(eventId, type, data)')
    expect(result.code).toContain('window.__TRACER_SESSION_ID__')
  })

  it('does not inject when no trace matches', () => {
    const code = `fetchOther(1)`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', name: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(false)
    expect(result.code).toBe(code)
  })

  it('returns original code when index is empty', () => {
    const code = `foo()`
    const result = inject(code, idx([]))
    expect(result.hasInjection).toBe(false)
    expect(result.code).toBe(code)
  })

  it('handles missing argument index with undefined', () => {
    const code = `fetchUserData()`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', name: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.code).toMatch(/"arguments\[0\]": undefined/)
  })

  it('preserves the original call expression semantics', () => {
    const code = `
const x = fetchUserData(42)
`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', name: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    // Original assignment must still be present
    expect(result.code).toMatch(/const x = fetchUserData\(42\)/)
  })

  it('parses TS source without exceptions', () => {
    const code = `
async function fetchUserData(id: number): Promise<User> {
  return await api.get('/user/' + id)
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'getUser',
          type: 'api_response',
          match: { kind: 'function_call', name: 'api.get' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
  })

  it('parses JSX without exceptions', () => {
    const code = `
function Hello() {
  return <div onClick={() => handleClick("x")}>hi</div>
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'click',
          type: 'api_call',
          match: { kind: 'function_call', name: 'handleClick' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
  })

  it('returns original code on unparseable input', () => {
    const code = '}}}}not valid js{{{{'
    const result = inject(
      code,
      idx([
        {
          id: 'foo',
          type: 'api_call',
          match: { kind: 'function_call', name: 'foo' },
          capture: [],
        },
      ]),
    )
    expect(result.hasInjection).toBe(false)
  })
})
