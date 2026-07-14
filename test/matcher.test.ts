import { describe, it, expect } from 'vitest'
import {
  globToRegex,
  compilePattern,
  matchPattern,
  matchesFileFilter,
} from '../src/core/matcher.js'

describe('globToRegex', () => {
  it('converts * to [^.]* (match any chars except dot)', () => {
    const re = globToRegex('fetch*')
    expect(re.test('fetchUserData')).toBe(true)
    expect(re.test('fetch')).toBe(true)
    expect(re.test('fetch.User')).toBe(false)
    expect(re.test('notFetch')).toBe(false)
  })

  it('converts ** to zero-or-more segments', () => {
    const re = globToRegex('a.**.d')
    expect(re.test('a.b.c.d')).toBe(true)
    expect(re.test('a.b.d')).toBe(true)
    expect(re.test('a.d')).toBe(true)
    expect(re.test('a.x')).toBe(false)
  })

  it('escapes regex special characters', () => {
    const re = globToRegex('obj.method')
    expect(re.test('obj.method')).toBe(true)
    expect(re.test('objxmethod')).toBe(false)
  })

  it('anchors the match to start and end', () => {
    const re = globToRegex('foo')
    expect(re.test('foo')).toBe(true)
    expect(re.test('foobar')).toBe(false)
    expect(re.test('barfoo')).toBe(false)
  })

  it('handles leading *', () => {
    const re = globToRegex('*.method')
    expect(re.test('obj.method')).toBe(true)
    expect(re.test('a.b.method')).toBe(false) // dot in prefix stops *
  })

  it('handles trailing *', () => {
    const re = globToRegex('handle*')
    expect(re.test('handleClick')).toBe(true)
    expect(re.test('handle')).toBe(true)
  })

  it('handles complex mixed pattern', () => {
    const re = globToRegex('this.*.set*')
    expect(re.test('this.state.setValue')).toBe(true)
    expect(re.test('this.state.set')).toBe(true)
    expect(re.test('this.state.change')).toBe(false)
  })
})

describe('compilePattern', () => {
  it('compiles glob patterns', () => {
    const re = compilePattern('fetch*', 'glob')
    expect(re.test('fetchUserData')).toBe(true)
  })

  it('compiles regex patterns', () => {
    const re = compilePattern('^handle[A-Z]', 'regex')
    expect(re.test('handleClick')).toBe(true)
    expect(re.test('handle_click')).toBe(false)
  })

  it('wraps unanchored regex with ^...$', () => {
    const re = compilePattern('foo', 'regex')
    expect(re.test('foo')).toBe(true)
    expect(re.test('foobar')).toBe(false)
  })

  it('preserves anchored regex', () => {
    const re = compilePattern('^foo.*', 'regex')
    expect(re.test('foo')).toBe(true)
    expect(re.test('foobar')).toBe(true)
    expect(re.test('barfoobar')).toBe(false)
  })
})

describe('matchPattern', () => {
  it('exact: returns true for equal strings', () => {
    expect(matchPattern('foo', 'foo', 'exact')).toBe(true)
  })

  it('exact: returns false for different strings', () => {
    expect(matchPattern('foo', 'bar', 'exact')).toBe(false)
  })

  it('glob: matches wildcard', () => {
    expect(matchPattern('fetchUserData', 'fetch*', 'glob')).toBe(true)
    expect(matchPattern('fetchUser.Data', 'fetch*', 'glob')).toBe(false)
  })

  it('glob: ** matches dots', () => {
    expect(matchPattern('a.b.c.d', 'a.**.d', 'glob')).toBe(true)
  })

  it('regex: uses regex matching', () => {
    expect(matchPattern('handleClick', '^handle[A-Z]\\w+', 'regex')).toBe(true)
    expect(matchPattern('handle_click', '^handle[A-Z]\\w+', 'regex')).toBe(false)
  })

  it('accepts compiledRegex for performance', () => {
    const re = compilePattern('fetch*', 'glob')
    expect(matchPattern('fetchData', 'fetch*', 'glob', re)).toBe(true)
  })
})

describe('matchesFileFilter', () => {
  it('returns true when filter is undefined', () => {
    expect(matchesFileFilter('src/App.tsx', undefined)).toBe(true)
  })

  it('returns false when filter is set but filePath is undefined', () => {
    expect(matchesFileFilter(undefined, 'src/**')).toBe(false)
  })

  it('matches single-level glob', () => {
    expect(matchesFileFilter('src/App.tsx', 'src/*')).toBe(true)
    expect(matchesFileFilter('src/components/App.tsx', 'src/*')).toBe(false)
  })

  it('matches multi-level glob with **', () => {
    expect(matchesFileFilter('src/components/App.tsx', 'src/**')).toBe(true)
    expect(matchesFileFilter('lib/utils.ts', 'src/**')).toBe(false)
  })

  it('uses compiled regex when provided', () => {
    const re = globToRegex('src/**', '/')
    expect(matchesFileFilter('src/a/b/c.ts', 'src/**', re)).toBe(true)
    expect(matchesFileFilter('lib/x.ts', 'src/**', re)).toBe(false)
  })
})
