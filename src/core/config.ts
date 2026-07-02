import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type TraceType = 'api_call' | 'api_response' | 'state_change'

export type MatchKind = 'function_call' | 'assignment'

export interface Match {
  kind: MatchKind
  name: string
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

export type MatcherIndex = Map<string, Trace[]>

export const SUPPORTED_TRACE_TYPES: readonly TraceType[] = [
  'api_call',
  'api_response',
  'state_change',
] as const

export const SUPPORTED_MATCH_KINDS: readonly MatchKind[] = [
  'function_call',
  'assignment',
] as const

export const DEFAULT_LOG_DIR = '.agent/tracer/logs'
export const CONFIG_PATH = '.agent/tracer.config.json'

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
    if (typeof m.name !== 'string' || m.name.length === 0) {
      throw new Error(`[tracer] traces[${i}].match.name must be a non-empty string`)
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
      match: { kind: m.kind as MatchKind, name: m.name },
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
  const index: MatcherIndex = new Map()
  for (const trace of config.traces) {
    const key = matcherKey(trace.match.kind, trace.match.name)
    const list = index.get(key)
    if (list) list.push(trace)
    else index.set(key, [trace])
  }
  return index
}
