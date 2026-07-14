import { describe, it, expect } from 'vitest'
import {
  validateConfig,
  buildMatcherIndex,
  matcherKey,
  DEFAULT_LOG_DIR,
} from '../src/core/config.js'

describe('validateConfig', () => {
  // ── Existing tests (updated to use "pattern") ───────────────
  it('accepts a valid config', () => {
    const cfg = validateConfig({
      version: 1,
      log: { dir: '.agent/tracer/logs' },
      traces: [
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ],
    })
    expect(cfg.version).toBe(1)
    expect(cfg.traces).toHaveLength(1)
    expect(cfg.traces[0].capture).toEqual(['arguments[0]'])
  })

  it('fills default log dir when missing', () => {
    const cfg = validateConfig({ version: 1, traces: [] })
    expect(cfg.log.dir).toBe(DEFAULT_LOG_DIR)
  })

  it('allows missing capture (defaults to empty)', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        { id: 'x', type: 'state_change', match: { kind: 'assignment', pattern: 'x' } },
      ],
    })
    expect(cfg.traces[0].capture).toEqual([])
  })

  it('rejects unsupported version', () => {
    expect(() => validateConfig({ version: 2, traces: [] })).toThrow(/version/)
  })

  it('rejects missing traces array', () => {
    expect(() => validateConfig({ version: 1 })).toThrow(/traces/)
  })

  it('rejects empty trace id', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          { id: '', type: 'api_call', match: { kind: 'function_call', pattern: 'x' }, capture: [] },
        ],
      }),
    ).toThrow(/id/)
  })

  it('rejects duplicate trace id', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          { id: 'dup', type: 'api_call', match: { kind: 'function_call', pattern: 'x' }, capture: [] },
          { id: 'dup', type: 'api_call', match: { kind: 'function_call', pattern: 'y' }, capture: [] },
        ],
      }),
    ).toThrow(/duplicate/)
  })

  it('accepts error trace type', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'fetchUserDataErr',
          type: 'error',
          match: { kind: 'function_call', pattern: 'fetchUserData' },
          capture: ['arguments[0]'],
        },
      ],
    })
    expect(cfg.traces[0].type).toBe('error')
  })

  it('rejects unsupported trace type', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          {
            id: 'x',
            type: 'branch_taken',
            match: { kind: 'function_call', pattern: 'x' },
            capture: [],
          },
        ],
      }),
    ).toThrow(/type/)
  })

  it('rejects unsupported match.kind', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          { id: 'x', type: 'api_call', match: { kind: 'event_handler', pattern: 'x' }, capture: [] },
        ],
      }),
    ).toThrow(/kind/)
  })

  // ── Backward compat: accept "name" ──────────────────────────
  it('normalizes match.name to match.pattern (backward compat)', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        { id: 'x', type: 'api_call', match: { kind: 'function_call', name: 'oldName' }, capture: [] },
      ],
    })
    expect(cfg.traces[0].match.pattern).toBe('oldName')
  })

  // ── New MatchKind tests ─────────────────────────────────────
  it('accepts member_assignment match kind', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'setLoading',
          type: 'state_change',
          match: { kind: 'member_assignment', pattern: 'this.state.loading' },
          capture: ['value'],
        },
      ],
    })
    expect(cfg.traces[0].match.kind).toBe('member_assignment')
  })

  it('accepts constructor_call match kind', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'newPromise',
          type: 'api_call',
          match: { kind: 'constructor_call', pattern: 'Promise' },
          capture: ['arguments[0]'],
        },
      ],
    })
    expect(cfg.traces[0].match.kind).toBe('constructor_call')
  })

  it('accepts return_point match kind', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'retVal',
          type: 'state_change',
          match: { kind: 'return_point', pattern: 'computeValue' },
          capture: ['returnValue'],
        },
      ],
    })
    expect(cfg.traces[0].match.kind).toBe('return_point')
  })

  it('accepts throw_point match kind', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'throwErr',
          type: 'error',
          match: { kind: 'throw_point', pattern: 'validate' },
          capture: ['value'],
        },
      ],
    })
    expect(cfg.traces[0].match.kind).toBe('throw_point')
  })

  // ── Pattern type tests ──────────────────────────────────────
  it('accepts glob patternType', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'anyAction',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'dispatch_*', patternType: 'glob' },
          capture: ['arguments[0]'],
        },
      ],
    })
    expect(cfg.traces[0].match.patternType).toBe('glob')
  })

  it('accepts regex patternType', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'handlers',
          type: 'api_call',
          match: { kind: 'function_call', pattern: '^handle[A-Z]', patternType: 'regex' },
          capture: [],
        },
      ],
    })
    expect(cfg.traces[0].match.patternType).toBe('regex')
  })

  it('defaults patternType to exact when omitted', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        { id: 'x', type: 'api_call', match: { kind: 'function_call', pattern: 'foo' }, capture: [] },
      ],
    })
    expect(cfg.traces[0].match.patternType).toBe('exact')
  })

  it('rejects invalid patternType', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          {
            id: 'x',
            type: 'api_call',
            match: { kind: 'function_call', pattern: 'foo', patternType: 'fuzzy' },
            capture: [],
          },
        ],
      }),
    ).toThrow(/patternType/)
  })

  // ── File filter tests ───────────────────────────────────────
  it('accepts fileFilter on match', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'x',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'foo', fileFilter: 'src/store/**' },
          capture: [],
        },
      ],
    })
    expect(cfg.traces[0].match.fileFilter).toBe('src/store/**')
  })

  it('rejects empty fileFilter', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          {
            id: 'x',
            type: 'api_call',
            match: { kind: 'function_call', pattern: 'foo', fileFilter: '' },
            capture: [],
          },
        ],
      }),
    ).toThrow(/fileFilter/)
  })

  // ── Pattern length limit ────────────────────────────────────
  it('rejects excessively long pattern', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          {
            id: 'x',
            type: 'api_call',
            match: { kind: 'function_call', pattern: 'x'.repeat(201) },
            capture: [],
          },
        ],
      }),
    ).toThrow(/pattern/)
  })

  // ── Invalid regex pattern ───────────────────────────────────
  it('rejects invalid regex pattern', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          {
            id: 'x',
            type: 'api_call',
            match: { kind: 'function_call', pattern: '[invalid', patternType: 'regex' },
            capture: [],
          },
        ],
      }),
    ).toThrow(/pattern/)
  })
})

describe('buildMatcherIndex', () => {
  it('groups traces by (kind, name) in exact map', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        { id: 'a_call', type: 'api_call', match: { kind: 'function_call', pattern: 'f' }, capture: [] },
        {
          id: 'a_resp',
          type: 'api_response',
          match: { kind: 'function_call', pattern: 'f' },
          capture: ['returnValue'],
        },
        { id: 's', type: 'state_change', match: { kind: 'assignment', pattern: 'x' }, capture: ['value'] },
      ],
    })
    const idx = buildMatcherIndex(cfg)
    expect(idx.exact.get(matcherKey('function_call', 'f'))?.map((t) => t.id)).toEqual(['a_call', 'a_resp'])
    expect(idx.exact.get(matcherKey('assignment', 'x'))?.map((t) => t.id)).toEqual(['s'])
  })

  it('returns empty index for empty traces', () => {
    const cfg = validateConfig({ version: 1, traces: [] })
    const idx = buildMatcherIndex(cfg)
    expect(idx.exact.size).toBe(0)
    expect(idx.patterns).toHaveLength(0)
  })

  it('puts glob patterns in patterns array', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'anyFetch',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'fetch*', patternType: 'glob' },
          capture: ['arguments[0]'],
        },
      ],
    })
    const idx = buildMatcherIndex(cfg)
    expect(idx.exact.size).toBe(0)
    expect(idx.patterns).toHaveLength(1)
    expect(idx.patterns[0].kind).toBe('function_call')
    expect(idx.patterns[0].traces[0].id).toBe('anyFetch')
  })

  it('groups same glob patterns into one entry', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'fetchCall',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'fetch*', patternType: 'glob' },
          capture: [],
        },
        {
          id: 'fetchResp',
          type: 'api_response',
          match: { kind: 'function_call', pattern: 'fetch*', patternType: 'glob' },
          capture: ['returnValue'],
        },
      ],
    })
    const idx = buildMatcherIndex(cfg)
    expect(idx.patterns).toHaveLength(1)
    expect(idx.patterns[0].traces.map((t) => t.id)).toEqual(['fetchCall', 'fetchResp'])
  })

  it('compiles fileFilter glob to regex', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'x',
          type: 'api_call',
          match: {
            kind: 'function_call',
            pattern: 'dispatch_*',
            patternType: 'glob',
            fileFilter: 'src/store/**',
          },
          capture: [],
        },
      ],
    })
    const idx = buildMatcherIndex(cfg)
    expect(idx.patterns[0].fileFilterRegex).not.toBeNull()
    expect(idx.patterns[0].fileFilterRegex!.test('src/store/actions.ts')).toBe(true)
    expect(idx.patterns[0].fileFilterRegex!.test('lib/utils.ts')).toBe(false)
  })

  it('sets fileFilterRegex to null when no fileFilter', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        {
          id: 'x',
          type: 'api_call',
          match: { kind: 'function_call', pattern: 'foo*', patternType: 'glob' },
          capture: [],
        },
      ],
    })
    const idx = buildMatcherIndex(cfg)
    expect(idx.patterns[0].fileFilterRegex).toBeNull()
  })
})
