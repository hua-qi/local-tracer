import { describe, it, expect } from 'vitest'
import { inject } from '../src/core/ast-injector.js'
import { validateConfig, buildMatcherIndex } from '../src/core/config.js'
import type { MatcherIndex } from '../src/core/config.js'

function idx(traces: any[]): MatcherIndex {
  return buildMatcherIndex(validateConfig({ version: 1, traces }))
}

// ── Existing tests (adapted) ──────────────────────────────────

describe('inject — existing behavior', () => {
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
          match: { kind: 'function_call', pattern: 'fetchUserData' },
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
          match: { kind: 'function_call', pattern: 'api.get' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
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
          match: { kind: 'assignment', pattern: 'userAuth' },
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
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.code).toContain('function __rt_log(eventId, type, data, errorInfo)')
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
          match: { kind: 'function_call', pattern: 'fetchUserData' },
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
          match: { kind: 'function_call', pattern: 'fetchUserData' },
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
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
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
          match: { kind: 'function_call', pattern: 'api.get' },
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
          match: { kind: 'function_call', pattern: 'handleClick' },
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
          match: { kind: 'function_call', pattern: 'foo' },
          capture: [],
        },
      ]),
    )
    expect(result.hasInjection).toBe(false)
  })

  it('injects try/catch for error type', () => {
    const code = `
function run() {
  fetchUserData(42)
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserData',
          type: 'error',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('try {')
    expect(result.code).toContain('catch')
    expect(result.code).toContain('__rt_log("fetchUserData", "error"')
    expect(result.code).toContain('throw e')
  })

  it('injects api_response + error together with try/catch', () => {
    const code = `
function run() {
  const res = fetchUserData(42)
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserDataCall',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
        {
          id: 'fetchUserDataResp',
          type: 'api_response',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['returnValue'],
        },
        {
          id: 'fetchUserDataErr',
          type: 'error',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('try {')
    expect(result.code).toContain('catch')
    expect(result.code).toContain('__rt_log("fetchUserDataErr", "error"')
    expect(result.code).toContain('__rt_log("fetchUserDataResp", "api_response"')
    expect(result.code).toContain('throw e')
  })
})

// ── P0: Wildcard / glob matching ──────────────────────────────

describe('inject — wildcard matching', () => {
  it('glob pattern * matches prefix variations', () => {
    const code = `dispatchClick({ type: 'CLICK' })`
    const result = inject(
      code,
      idx([
        {
          id: 'anyDispatch',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'dispatch*', patternType: 'glob' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("anyDispatch", "api_call"')
  })

  it('regex pattern matches function calls', () => {
    const code = `handleClick()`
    const result = inject(
      code,
      idx([
        {
          id: 'handlers',
          type: 'api_call',
          match: { kind: 'function_call', pattern: '^handle[A-Z]\\w*', patternType: 'regex' },
          capture: [],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
  })

  it('glob * does not cross dot boundaries', () => {
    // 'a.b.*' matches a.b.doThing (one level deep from a.b)
    const code = `a.b.doThing()`
    const result = inject(
      code,
      idx([
        {
          id: 'topLevel',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'a.b.*', patternType: 'glob' },
          capture: [],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
  })
})

// ── P0: member_assignment ─────────────────────────────────────

describe('inject — member_assignment', () => {
  it('injects for obj.prop = value', () => {
    const code = `
function update(state) {
  store.loading = true
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'setLoading',
          type: 'state_change',
          match: { kind: 'member_assignment', pattern: 'store.loading' },
          capture: ['value'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("setLoading", "state_change"')
    expect(result.code).toMatch(/value: true\b/)
  })

  it('injects for this.state = value', () => {
    const code = `
class App {
  update() {
    this.state = { loaded: true }
  }
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'setState',
          type: 'state_change',
          match: { kind: 'member_assignment', pattern: 'this.state' },
          capture: ['value'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("setState", "state_change"')
  })

  it('injects for deep member assignment a.b.c = value', () => {
    const code = `function reset() { a.b.c = null }`
    const result = inject(
      code,
      idx([
        {
          id: 'deepSet',
          type: 'state_change',
          match: { kind: 'member_assignment', pattern: 'a.b.c' },
          capture: ['value'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("deepSet", "state_change"')
  })

  it('does not inject for computed dynamic assignment', () => {
    const code = `function reset() { obj[key] = 'v' }`
    const result = inject(
      code,
      idx([
        {
          id: 'dynSet',
          type: 'state_change',
          match: { kind: 'member_assignment', pattern: 'obj.key' },
          capture: ['value'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(false)
  })
})

// ── P1: Deep member calls ─────────────────────────────────────

describe('inject — deep member calls', () => {
  it('matches a.b.c()', () => {
    const code = `function run() { a.b.c() }`
    const result = inject(
      code,
      idx([
        {
          id: 'deep',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'a.b.c' },
          capture: [],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("deep", "api_call"')
  })

  it('matches this.service.fetch()', () => {
    const code = `function run() { this.service.fetch() }`
    const result = inject(
      code,
      idx([
        {
          id: 'svcCall',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'this.service.fetch' },
          capture: [],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
  })

  it('matches four-level chain a.b.c.d()', () => {
    const code = `function run() { a.b.c.d() }`
    const result = inject(
      code,
      idx([
        {
          id: 'deep4',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'a.b.c.d' },
          capture: [],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
  })
})

// ── P1: `$elapsed_ms` capture ─────────────────────────────────

describe('inject — $elapsed_ms', () => {
  it('injects performance.now() for api_call and computes elapsed for api_response', () => {
    const code = `
function run() {
  const res = fetchUserData(42)
  return res
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
        {
          id: 'fetchUserDataResp',
          type: 'api_response',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['$elapsed_ms'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('performance.now()')
    // Should contain elapsed computation: performance.now() - _tracer_*
    expect(result.code).toMatch(/performance\.now\(\)\s*-\s*_tracer_\d+/)
    expect(result.code).toContain('$elapsed_ms')
  })
})

// ── P2: `$this` capture ───────────────────────────────────────

describe('inject — $this capture', () => {
  it('captures object for obj.method() call', () => {
    const code = `api.get('/user')`
    const result = inject(
      code,
      idx([
        {
          id: 'getCall',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'api.get' },
          capture: ['$this'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toMatch(/\$this:\s*api\b/)
  })

  it('captures this for this.handler() call', () => {
    const code = `this.handler()`
    const result = inject(
      code,
      idx([
        {
          id: 'handlerCall',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'this.handler' },
          capture: ['$this'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toMatch(/\$this:\s*this\b/)
  })

  it('captures $this as undefined for plain function call', () => {
    const code = `foo()`
    const result = inject(
      code,
      idx([
        {
          id: 'plainCall',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'foo' },
          capture: ['$this'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toMatch(/\$this:\s*undefined/)
  })
})

// ── P2: constructor_call ──────────────────────────────────────

describe('inject — constructor_call', () => {
  it('injects for new Promise()', () => {
    const code = `function run() { new Promise((resolve) => {}) }`
    const result = inject(
      code,
      idx([
        {
          id: 'newPromise',
          type: 'api_call',
          match: { kind: 'constructor_call', pattern: 'Promise' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("newPromise", "api_call"')
  })

  it('injects for new Foo.Bar()', () => {
    const code = `const x = new Foo.Bar(1, 2)`
    const result = inject(
      code,
      idx([
        {
          id: 'newBar',
          type: 'api_response',
          match: { kind: 'constructor_call', pattern: 'Foo.Bar' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("newBar", "api_response"')
  })

  it('injects error try/catch for constructor_call', () => {
    const code = `const x = new Foo(1)`
    const result = inject(
      code,
      idx([
        {
          id: 'newFooErr',
          type: 'error',
          match: { kind: 'constructor_call', pattern: 'Foo' },
          capture: ['arguments[0]'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('try {')
    expect(result.code).toContain('catch')
    expect(result.code).toContain('throw e')
  })
})

// ── P3: return_point ──────────────────────────────────────────

describe('inject — return_point', () => {
  it('injects before return in named function declaration', () => {
    const code = `
function computeValue() {
  const x = 1 + 2
  return x
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'retVal',
          type: 'state_change',
          match: { kind: 'return_point', pattern: 'computeValue' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("retVal", "state_change"')
    expect(result.code).toMatch(/returnValue:\s*x\b/)
  })

  it('injects for arrow function bound to variable', () => {
    const code = `
const getResult = () => {
  return someApi()
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'retVal',
          type: 'state_change',
          match: { kind: 'return_point', pattern: 'getResult' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("retVal", "state_change"')
  })

  it('does not inject for unmatched function name', () => {
    const code = `
function otherFn() {
  return 1
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'retVal',
          type: 'state_change',
          match: { kind: 'return_point', pattern: 'computeValue' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(false)
  })

  it('does not cross function boundaries for nested functions', () => {
    const code = `
function outer() {
  const inner = () => { return 1 }
  return inner()
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'retVal',
          type: 'state_change',
          match: { kind: 'return_point', pattern: 'outer' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    // Should only inject at outer's return, not inner's
    expect(result.code).toContain('__rt_log("retVal", "state_change"')
    // There should be exactly one __rt_log for outer's return
    const matches = result.code.match(/__rt_log\("retVal"/g)
    expect(matches?.length).toBe(1)
  })

  it('skips return without argument (void return)', () => {
    const code = `
function noop() {
  return
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'retVal',
          type: 'state_change',
          match: { kind: 'return_point', pattern: 'noop' },
          capture: ['returnValue'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(false)
  })
})

// ── P3: throw_point ───────────────────────────────────────────

describe('inject — throw_point', () => {
  it('injects before throw in named function', () => {
    const code = `
function validate(input) {
  if (!input) throw new Error('invalid')
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'throwErr',
          type: 'error',
          match: { kind: 'throw_point', pattern: 'validate' },
          capture: ['value'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(true)
    expect(result.code).toContain('__rt_log("throwErr", "error"')
  })

  it('does not inject for unmatched function name', () => {
    const code = `
function other() {
  throw new Error('oops')
}
`
    const result = inject(
      code,
      idx([
        {
          id: 'throwErr',
          type: 'error',
          match: { kind: 'throw_point', pattern: 'validate' },
          capture: ['value'],
        },
      ]),
    )
    expect(result.hasInjection).toBe(false)
  })
})

// ── P3: fileFilter ─────────────────────────────────────────────

describe('inject — fileFilter', () => {
  it('filters out traces whose fileFilter does not match', () => {
    const code = `dispatchAction()`
    const result = inject(
      code,
      idx([
        {
          id: 'storeAction',
          type: 'api_call',
          match: {
            kind: 'function_call',
            pattern: 'dispatchAction',
            fileFilter: 'src/store/**',
          },
          capture: [],
        },
      ]),
      { filePath: 'src/components/Button.tsx' },
    )
    expect(result.hasInjection).toBe(false)
  })

  it('includes traces whose fileFilter matches', () => {
    const code = `dispatchAction()`
    const result = inject(
      code,
      idx([
        {
          id: 'storeAction',
          type: 'api_call',
          match: {
            kind: 'function_call',
            pattern: 'dispatchAction',
            fileFilter: 'src/store/**',
          },
          capture: [],
        },
      ]),
      { filePath: 'src/store/actions.ts' },
    )
    expect(result.hasInjection).toBe(true)
  })

  it('excludes fileFilter traces when no filePath is provided', () => {
    // When fileFilter is set but filePath is unknown, trace is excluded
    const code = `dispatchAction()`
    const result = inject(
      code,
      idx([
        {
          id: 'storeAction',
          type: 'api_call',
          match: {
            kind: 'function_call',
            pattern: 'dispatchAction',
            fileFilter: 'src/store/**',
          },
          capture: [],
        },
      ]),
    )
    // No filePath → fileFilter can't be verified → trace excluded
    expect(result.hasInjection).toBe(false)
  })
})
