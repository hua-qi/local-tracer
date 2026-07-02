import { describe, it, expect } from 'vitest'
import {
  validateConfig,
  buildMatcherIndex,
  matcherKey,
  DEFAULT_LOG_DIR,
} from '../src/core/config.js'

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    const cfg = validateConfig({
      version: 1,
      log: { dir: '.agent/tracer/logs' },
      traces: [
        {
          id: 'fetchUserData',
          type: 'api_call',
          match: { kind: 'function_call', name: 'fetchUserData' },
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
        { id: 'x', type: 'state_change', match: { kind: 'assignment', name: 'x' } },
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
          { id: '', type: 'api_call', match: { kind: 'function_call', name: 'x' }, capture: [] },
        ],
      }),
    ).toThrow(/id/)
  })

  it('rejects duplicate trace id', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          { id: 'dup', type: 'api_call', match: { kind: 'function_call', name: 'x' }, capture: [] },
          { id: 'dup', type: 'api_call', match: { kind: 'function_call', name: 'y' }, capture: [] },
        ],
      }),
    ).toThrow(/duplicate/)
  })

  it('rejects unsupported trace type', () => {
    expect(() =>
      validateConfig({
        version: 1,
        traces: [
          {
            id: 'x',
            type: 'branch_taken',
            match: { kind: 'function_call', name: 'x' },
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
          { id: 'x', type: 'api_call', match: { kind: 'event_handler', name: 'x' }, capture: [] },
        ],
      }),
    ).toThrow(/kind/)
  })
})

describe('buildMatcherIndex', () => {
  it('groups traces by (kind, name)', () => {
    const cfg = validateConfig({
      version: 1,
      traces: [
        { id: 'a_call', type: 'api_call', match: { kind: 'function_call', name: 'f' }, capture: [] },
        {
          id: 'a_resp',
          type: 'api_response',
          match: { kind: 'function_call', name: 'f' },
          capture: ['returnValue'],
        },
        { id: 's', type: 'state_change', match: { kind: 'assignment', name: 'x' }, capture: ['value'] },
      ],
    })
    const idx = buildMatcherIndex(cfg)
    expect(idx.get(matcherKey('function_call', 'f'))?.map((t) => t.id)).toEqual(['a_call', 'a_resp'])
    expect(idx.get(matcherKey('assignment', 'x'))?.map((t) => t.id)).toEqual(['s'])
  })

  it('returns empty map for empty traces', () => {
    const cfg = validateConfig({ version: 1, traces: [] })
    expect(buildMatcherIndex(cfg).size).toBe(0)
  })
})
