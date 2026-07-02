import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import _generate from '@babel/generator'
import * as t from '@babel/types'
import { matcherKey, type MatcherIndex, type Trace } from './config'
import { RUNTIME_HELPER_SOURCE } from './runtime-helper'

// CJS/ESM interop for @babel/traverse and @babel/generator
const traverse: typeof import('@babel/traverse').default =
  // @ts-ignore - default export shape varies between CJS/ESM
  (_traverse as any).default ?? _traverse
const generate: typeof import('@babel/generator').default =
  // @ts-ignore
  (_generate as any).default ?? _generate

export interface InjectResult {
  code: string
  hasInjection: boolean
}

export interface InjectOptions {
  /** When true, prepend __rt_log helper source to the output (default: true). */
  prependHelper?: boolean
}

export function inject(
  code: string,
  index: MatcherIndex,
  options: InjectOptions = {},
): InjectResult {
  if (index.size === 0) return { code, hasInjection: false }

  let ast
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: ['typescript', 'jsx', 'dynamicImport', 'decorators-legacy', 'classProperties'],
      errorRecovery: true,
    })
  } catch {
    return { code, hasInjection: false }
  }

  let hasInjection = false

  traverse(ast, {
    CallExpression(path) {
      const name = calleeName(path.node.callee)
      if (!name) return
      const traces = index.get(matcherKey('function_call', name))
      if (!traces || traces.length === 0) return
      const stmtPath = path.getStatementParent()
      if (!stmtPath) return

      for (const trace of traces) {
        if (trace.type === 'api_call') {
          const dataObj = buildDataObject(trace, (spec) => buildArgCapture(spec, path.node.arguments))
          const [newPath] = stmtPath.insertBefore(makeLogStatement(trace.id, 'api_call', dataObj))
          // Skip traversal into the inserted statement: its `__rt_log(...)`
          // callee is intentionally not in the matcher index, but a captured
          // argument expression (cloned into the data object) might match.
          newPath?.skip()
          hasInjection = true
        } else if (trace.type === 'api_response') {
          const dataObj = buildDataObject(trace, (spec) => buildReturnCapture(spec, path))
          const [newPath] = stmtPath.insertAfter(makeLogStatement(trace.id, 'api_response', dataObj))
          newPath?.skip()
          hasInjection = true
        }
      }
    },
    AssignmentExpression(path) {
      if (!t.isIdentifier(path.node.left)) return
      const traces = index.get(matcherKey('assignment', path.node.left.name))
      if (!traces || traces.length === 0) return
      const stmtPath = path.getStatementParent()
      if (!stmtPath) return

      for (const trace of traces) {
        if (trace.type !== 'state_change') continue
        const dataObj = buildDataObject(trace, (spec) => buildValueCapture(spec, path))
        const [newPath] = stmtPath.insertAfter(makeLogStatement(trace.id, 'state_change', dataObj))
        newPath?.skip()
        hasInjection = true
      }
    },
  })

  if (!hasInjection) return { code, hasInjection: false }

  const out = generate(ast, { retainLines: false, jsescOption: { minimal: true } }, code)
  const helper = options.prependHelper === false ? '' : RUNTIME_HELPER_SOURCE + '\n'
  return { code: helper + out.code, hasInjection: true }
}

function makeLogStatement(traceId: string, type: string, dataObj: t.Expression): t.ExpressionStatement {
  return t.expressionStatement(
    t.callExpression(t.identifier('__rt_log'), [
      t.stringLiteral(traceId),
      t.stringLiteral(type),
      dataObj,
    ]),
  )
}

function buildDataObject(
  trace: Trace,
  build: (spec: string) => t.ObjectProperty | null,
): t.Expression {
  const props = trace.capture
    .map(build)
    .filter((p): p is t.ObjectProperty => p !== null)
  return t.objectExpression(props)
}

function buildArgCapture(spec: string, args: t.CallExpression['arguments']): t.ObjectProperty | null {
  const m = /^arguments\[(\d+)\]$/.exec(spec)
  if (!m) return null
  const i = parseInt(m[1], 10)
  const arg = args[i]
  const key = objectKey(spec)
  if (!arg || t.isSpreadElement(arg) || t.isArgumentPlaceholder(arg)) {
    return t.objectProperty(key, t.identifier('undefined'))
  }
  return t.objectProperty(key, t.cloneNode(arg as t.Expression))
}

function buildReturnCapture(spec: string, callPath: import('@babel/traverse').NodePath<t.CallExpression>): t.ObjectProperty | null {
  if (spec !== 'returnValue') return null
  // Look for: const <id> = [await] <call>()
  let p = callPath.parentPath
  if (p && p.isAwaitExpression()) p = p.parentPath
  if (p && p.isVariableDeclarator() && t.isIdentifier(p.node.id)) {
    return t.objectProperty(t.identifier('returnValue'), t.cloneNode(p.node.id))
  }
  // No binding to reference — capture undefined rather than cloning the call
  // expression (which would re-enter the visitor and recurse, and would also
  // re-evaluate side-effectful calls).
  return t.objectProperty(t.identifier('returnValue'), t.identifier('undefined'))
}

function buildValueCapture(spec: string, assignPath: import('@babel/traverse').NodePath<t.AssignmentExpression>): t.ObjectProperty | null {
  if (spec !== 'value') return null
  return t.objectProperty(t.identifier('value'), t.cloneNode(assignPath.node.right))
}

function objectKey(spec: string): t.Identifier | t.StringLiteral {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(spec)
    ? t.identifier(spec)
    : t.stringLiteral(spec)
}

function calleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string | null {
  if (t.isIdentifier(callee)) return callee.name
  if (
    t.isMemberExpression(callee) &&
    !callee.computed &&
    t.isIdentifier(callee.object) &&
    t.isIdentifier(callee.property)
  ) {
    return `${callee.object.name}.${callee.property.name}`
  }
  return null
}
