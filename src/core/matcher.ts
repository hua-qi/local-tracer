import type { PatternType } from './config'

const REGEX_SPECIAL = '.+^${}()|[]\\'

function escapeRegex(ch: string): string {
  return REGEX_SPECIAL.includes(ch) ? '\\' + ch : ch
}

/**
 * Convert a glob pattern to a RegExp.
 *
 * `pathSeparator` controls what `*` and `**` treat as a segment boundary:
 * - `*`  matches any characters except the separator.
 * - `**` matches zero or more segments joined by the separator.
 * - Everything else is matched literally (regex-special chars escaped).
 *
 * For member chains (a.b.c) use `pathSeparator = '.'` (default).
 * For file paths (src/App.tsx) use `pathSeparator = '/'`.
 */
export function globToRegex(pattern: string, pathSeparator = '.'): RegExp {
  const escSep = escapeRegex(pathSeparator)
  const notSep = `[^${escSep}]`
  const star = `${notSep}*`

  let escaped = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === pathSeparator) {
        // a.**.d  → segments are <name>., zero or more; skip trailing sep
        escaped += `(?:${notSep}*${escSep})*`
        i += 3
      } else if (i > 0 && pattern[i - 1] === pathSeparator) {
        // a.** or src/**  → trailing separator was already emitted; back it out
        // and produce: optional (sep + zero-or-more-segments + optional-final)
        const suffix = `(?:${notSep}*${escSep})*${notSep}*`
        // Remove the trailing separator from escaped
        escaped = escaped.slice(0, escaped.length - escSep.length)
        escaped += `(?:${escSep}${suffix})?`
        i += 2
      } else {
        // ** without leading or trailing sep: consume all
        escaped += `(?:${notSep}*${escSep})*${notSep}*`
        i += 2
      }
    } else if (pattern[i] === '*') {
      escaped += star
      i += 1
    } else {
      escaped += escapeRegex(pattern[i])
      i += 1
    }
  }
  return new RegExp(`^${escaped}$`)
}

/**
 * Compile a pattern string into a RegExp based on patternType.
 * Glob patterns use '.' as the path separator (member chain semantics).
 */
export function compilePattern(pattern: string, patternType: PatternType): RegExp {
  if (patternType === 'regex') {
    // If the user provided ^, keep it and don't force a trailing $.
    // Otherwise wrap with ^...$ for full-string matching.
    if (pattern.startsWith('^')) {
      return new RegExp(pattern)
    }
    return new RegExp(`^${pattern}$`)
  }
  return globToRegex(pattern)
}

/**
 * Test whether a target string matches a pattern.
 * Prefer passing compiledRegex when calling in a loop to avoid re-compilation.
 */
export function matchPattern(
  target: string,
  pattern: string,
  patternType: PatternType,
  compiledRegex?: RegExp,
): boolean {
  if (patternType === 'exact') {
    return target === pattern
  }
  const re = compiledRegex ?? compilePattern(pattern, patternType)
  return re.test(target)
}

/**
 * Check if a file path matches a file filter glob pattern.
 * Uses '/' as the path separator for glob interpretation.
 * Returns true if no filter is set (pass-through).
 */
export function matchesFileFilter(
  filePath: string | undefined,
  fileFilter: string | undefined,
  compiledRegex?: RegExp | null,
): boolean {
  if (!fileFilter) return true
  if (!filePath) return false
  const re = compiledRegex ?? globToRegex(fileFilter, '/')
  return re.test(filePath)
}
