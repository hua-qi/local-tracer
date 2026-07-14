import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compilePattern, globToRegex } from './matcher'

export type TraceType = 'api_call' | 'api_response' | 'state_change' | 'error'

export type MatchKind =
  | 'function_call'
  | 'assignment'
  | 'member_assignment'
  | 'constructor_call'
  | 'return_point'
  | 'throw_point'

export type PatternType = 'exact' | 'glob' | 'regex'

export interface Match {
  kind: MatchKind
  pattern: string
  patternType?: PatternType
  fileFilter?: string
}

export interface Trace {
  id: string
  type: TraceType
  match: Match
  capture: string[]
}

export interface TraceConfig {
  version: number
  log: { dir: string }
  traces: Trace[]
}

export interface PatternEntry {
  kind: MatchKind
  pattern: string
  patternType: PatternType
  compiledRegex: RegExp
  fileFilterRegex: RegExp | null
  traces: Trace[]
}

export interface MatcherIndex {
  exact: Map<string, Trace[]>
  patterns: PatternEntry[]
}

export const SUPPORTED_TRACE_TYPES: readonly TraceType[] = [
  'api_call',
  'api_response',
  'state_change',
  'error',
] as const

export const SUPPORTED_MATCH_KINDS: readonly MatchKind[] = [
  'function_call',
  'assignment',
  'member_assignment',
  'constructor_call',
  'return_point',
  'throw_point',
] as const

export const SUPPORTED_PATTERN_TYPES: readonly PatternType[] = [
  'exact',
  'glob',
  'regex',
] as const

export const DEFAULT_LOG_DIR = '.agent/tracer/logs'
export const CONFIG_PATH = '.agent/tracer.config.json'

const MAX_PATTERN_LENGTH = 200

export function matcherKey(kind: string, name: string): string {
  return `${kind}:${name}`
}

export function loadConfig(rootDir: string = process.cwd()): TraceConfig {
  const filePath = resolve(rootDir, CONFIG_PATH)
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    return { version: 1, log: { dir: DEFAULT_LOG_DIR }, traces: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`[tracer] ${CONFIG_PATH} is not valid JSON: ${(e as Error).message}`)
  }
  return validateConfig(parsed, rootDir)
}

export function validateConfig(input: unknown, rootDir?: string): TraceConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('[tracer] config must be an object')
  }
  const obj = input as Record<string, unknown>
  if (obj.version !== 1) {
    throw new Error(`[tracer] config.version must be 1, got ${String(obj.version)}`)
  }
  const logDir =
    obj.log && typeof obj.log === 'object' && 'dir' in (obj.log as object)
      ? (obj.log as { dir: unknown }).dir
      : DEFAULT_LOG_DIR
  if (typeof logDir !== 'string' || logDir.length === 0) {
    throw new Error('[tracer] config.log.dir must be a non-empty string')
  }
  const tracesRaw = obj.traces
  if (!Array.isArray(tracesRaw)) {
    throw new Error('[tracer] config.traces must be an array')
  }
  const seenIds = new Set<string>()
  const traces: Trace[] = tracesRaw.map((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`[tracer] traces[${i}] must be an object`)
    }
    const t = raw as Record<string, unknown>
    if (typeof t.id !== 'string' || t.id.length === 0) {
      throw new Error(`[tracer] traces[${i}].id must be a non-empty string`)
    }
    if (seenIds.has(t.id)) {
      throw new Error(`[tracer] traces[${i}].id "${t.id}" duplicates an earlier trace id`)
    }
    seenIds.add(t.id)
    if (!SUPPORTED_TRACE_TYPES.includes(t.type as TraceType)) {
      throw new Error(
        `[tracer] traces[${i}].type "${String(t.type)}" is not supported (allowed: ${SUPPORTED_TRACE_TYPES.join(', ')})`,
      )
    }
    if (!t.match || typeof t.match !== 'object') {
      throw new Error(`[tracer] traces[${i}].match must be an object`)
    }
    const m = t.match as Record<string, unknown>
    if (!SUPPORTED_MATCH_KINDS.includes(m.kind as MatchKind)) {
      throw new Error(
        `[tracer] traces[${i}].match.kind "${String(m.kind)}" is not supported (allowed: ${SUPPORTED_MATCH_KINDS.join(', ')})`,
      )
    }

    // Resolve pattern: prefer `pattern`, fall back to `name` for backward compat
    let pattern: string | undefined
    if (typeof m.pattern === 'string' && m.pattern.length > 0) {
      pattern = m.pattern
    } else if (typeof (m as any).name === 'string' && (m as any).name.length > 0) {
      pattern = (m as any).name
      console.warn(
        `[tracer] traces[${i}].match.name is deprecated, use "pattern" instead`,
      )
    }
    if (!pattern) {
      throw new Error(`[tracer] traces[${i}].match.pattern must be a non-empty string`)
    }

    // Validate patternType
    let patternType: PatternType = 'exact'
    if (m.patternType !== undefined) {
      if (!SUPPORTED_PATTERN_TYPES.includes(m.patternType as PatternType)) {
        throw new Error(
          `[tracer] traces[${i}].match.patternType "${String(m.patternType)}" is not supported (allowed: ${SUPPORTED_PATTERN_TYPES.join(', ')})`,
        )
      }
      patternType = m.patternType as PatternType
    }

    // Validate fileFilter
    let fileFilter: string | undefined
    if (m.fileFilter !== undefined) {
      if (typeof m.fileFilter !== 'string' || m.fileFilter.length === 0) {
        throw new Error(`[tracer] traces[${i}].match.fileFilter must be a non-empty string`)
      }
      fileFilter = m.fileFilter
      try { globToRegex(fileFilter, '/') } catch {
        throw new Error(`[tracer] traces[${i}].match.fileFilter is not a valid glob pattern`)
      }
    }

    // Validate pattern length and regex compilability
    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(`[tracer] traces[${i}].match.pattern must be ≤ ${MAX_PATTERN_LENGTH} chars`)
    }
    if (patternType !== 'exact') {
      try { compilePattern(pattern, patternType) } catch {
        throw new Error(`[tracer] traces[${i}].match.pattern is not a valid ${patternType} pattern`)
      }
    }

    const capture = Array.isArray(t.capture)
      ? t.capture
      : t.capture === undefined
        ? []
        : null
    if (capture === null) {
      throw new Error(`[tracer] traces[${i}].capture must be an array of strings`)
    }
    for (const c of capture) {
      if (typeof c !== 'string' || c.length === 0) {
        throw new Error(`[tracer] traces[${i}].capture entries must be non-empty strings`)
      }
    }
    return {
      id: t.id,
      type: t.type as TraceType,
      match: { kind: m.kind as MatchKind, pattern, patternType, fileFilter },
      capture: capture as string[],
    }
  })
  return {
    version: 1,
    log: { dir: rootDir ? resolve(rootDir, logDir) : logDir },
    traces,
  }
}

export function buildMatcherIndex(config: TraceConfig): MatcherIndex {
  const exact = new Map<string, Trace[]>()
  const patterns: PatternEntry[] = []

  for (const trace of config.traces) {
    const { kind, pattern, patternType = 'exact', fileFilter } = trace.match

    if (patternType === 'exact') {
      const key = matcherKey(kind, pattern)
      const list = exact.get(key)
      if (list) list.push(trace)
      else exact.set(key, [trace])
    } else {
      let entry = patterns.find(
        (e) => e.kind === kind && e.pattern === pattern && e.patternType === patternType,
      )
      if (!entry) {
        entry = {
          kind,
          pattern,
          patternType,
          compiledRegex: compilePattern(pattern, patternType),
          fileFilterRegex: fileFilter ? globToRegex(fileFilter, '/') : null,
          traces: [],
        }
        patterns.push(entry)
      }
      entry.traces.push(trace)
    }
  }

  return { exact, patterns }
}
