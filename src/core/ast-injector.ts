import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import _generate from '@babel/generator'
import * as t from '@babel/types'
import {
  matcherKey,
  type MatcherIndex,
  type Trace,
  type MatchKind,
} from './config'
import { matchesFileFilter } from './matcher'
import { RUNTIME_HELPER_SOURCE } from './runtime-helper'

// CJS/ESM interop
const traverse: typeof import('@babel/traverse').default =
  // @ts-ignore
  (_traverse as any).default ?? _traverse
const generate: typeof import('@babel/generator').default =
  // @ts-ignore
  (_generate as any).default ?? _generate

export interface InjectResult {
  code: string
  hasInjection: boolean
}

export interface InjectOptions {
  prependHelper?: boolean
  filePath?: string
}

let tempVarCounter = 0

function makeTempVarName(): string {
  return `_tracer_${tempVarCounter++}`
}

export function inject(
  code: string,
  index: MatcherIndex,
  options: InjectOptions = {},
): InjectResult {
  if (index.exact.size === 0 && index.patterns.length === 0) {
    return { code, hasInjection: false }
  }

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

  const filePath = options.filePath
  let hasInjection = false
  const processedNodes = new WeakSet<t.Node>()

  traverse(ast, {
    CallExpression(path) {
      if (processedNodes.has(path.node)) return
      const name = calleeName(path.node.callee)
      if (!name) return
      const traces = findMatchingTraces('function_call', name, index, filePath)
      if (traces.length === 0) return
      const stmtPath = path.getStatementParent()
      if (!stmtPath) return

      const apiCallTrace = traces.find((tr) => tr.type === 'api_call')
      const apiResponseTrace = traces.find((tr) => tr.type === 'api_response')
      const errorTrace = traces.find((tr) => tr.type === 'error')

      const needsElapsed = traces.some((tr) => tr.capture.includes('$elapsed_ms'))
      let elapsedStartVar: string | undefined
      if (needsElapsed) {
        elapsedStartVar = makeTempVarName()
        const [vp] = stmtPath.insertBefore(
          t.variableDeclaration('var', [
            t.variableDeclarator(
              t.identifier(elapsedStartVar),
              t.callExpression(
                t.memberExpression(t.identifier('performance'), t.identifier('now')),
                [],
              ),
            ),
          ]),
        )
        vp?.skip()
      }

      if (apiCallTrace) {
        const dataObj = buildDataObject(apiCallTrace, calleeName(path.node.callee), (spec) =>
          buildArgCapture(spec, path.node.arguments),
        )
        const [newPath] = stmtPath.insertBefore(makeLogStatement(apiCallTrace.id, 'api_call', dataObj))
        newPath?.skip()
        hasInjection = true
      }

      if (!apiResponseTrace && !errorTrace) return

      if (apiResponseTrace && !errorTrace) {
        const dataObj = buildDataObject(apiResponseTrace, calleeName(path.node.callee), (spec) =>
          buildResponseCapture(spec, path, elapsedStartVar),
        )
        const [newPath] = stmtPath.insertAfter(makeLogStatement(apiResponseTrace.id, 'api_response', dataObj))
        newPath?.skip()
        hasInjection = true
        return
      }

      // error (with or without api_response): wrap in try/catch
      processedNodes.add(path.node)
      const tempVar = makeTempVarName()
      const replacementStmts: t.Statement[] = []

      replacementStmts.push(
        t.variableDeclaration('let', [
          t.variableDeclarator(t.identifier(tempVar)),
        ]),
      )

      const tryBlock = t.blockStatement([
        t.expressionStatement(
          t.assignmentExpression('=', t.identifier(tempVar), path.node),
        ),
      ])

      const errorDataObj = errorTrace
        ? buildDataObject(errorTrace, calleeName(path.node.callee), (spec) =>
            buildArgCapture(spec, path.node.arguments),
          )
        : t.objectExpression([])
      const catchBody = t.blockStatement([
        makeLogStatementWithError(errorTrace?.id ?? apiResponseTrace!.id, 'error', errorDataObj),
        t.throwStatement(t.identifier('e')),
      ])
      const catchClause = t.catchClause(t.identifier('e'), catchBody)

      replacementStmts.push(t.tryStatement(tryBlock, catchClause))

      if (apiResponseTrace) {
        const responseDataObj = buildDataObject(apiResponseTrace, calleeName(path.node.callee), () =>
          t.objectProperty(t.identifier('returnValue'), t.identifier(tempVar)),
        )
        replacementStmts.push(makeLogStatement(apiResponseTrace.id, 'api_response', responseDataObj))
      }

      // Re-bind original const/let/var
      const parentDecl = stmtPath.parentPath
      if (
        parentDecl &&
        parentDecl.isVariableDeclarator() &&
        t.isIdentifier(parentDecl.node.id)
      ) {
        const decl = parentDecl.parentPath
        const kind = decl && decl.isVariableDeclaration() ? decl.node.kind : 'const'
        replacementStmts.push(
          t.variableDeclaration(kind, [
            t.variableDeclarator(t.identifier(parentDecl.node.id.name), t.identifier(tempVar)),
          ]),
        )
      }

      stmtPath.replaceWithMultiple(replacementStmts)
      hasInjection = true
    },

    AssignmentExpression(path) {
      // Existing: simple assignment
      if (t.isIdentifier(path.node.left)) {
        const traces = findMatchingTraces('assignment', path.node.left.name, index, filePath)
        if (traces.length === 0) return
        const stmtPath = path.getStatementParent()
        if (!stmtPath) return

        for (const trace of traces) {
          if (trace.type !== 'state_change') continue
          const dataObj = buildDataObject(trace, null, (spec) => buildValueCapture(spec, path))
          const [newPath] = stmtPath.insertAfter(makeLogStatement(trace.id, 'state_change', dataObj))
          newPath?.skip()
          hasInjection = true
        }
        return
      }

      // NEW: member_assignment
      if (t.isMemberExpression(path.node.left)) {
        const fullPath = memberPath(path.node.left)
        if (!fullPath) return
        const traces = findMatchingTraces('member_assignment', fullPath, index, filePath)
        if (traces.length === 0) return
        const stmtPath = path.getStatementParent()
        if (!stmtPath) return

        for (const trace of traces) {
          if (trace.type !== 'state_change') continue
          const dataObj = buildDataObject(trace, null, (spec) => buildValueCapture(spec, path))
          const [newPath] = stmtPath.insertAfter(makeLogStatement(trace.id, 'state_change', dataObj))
          newPath?.skip()
          hasInjection = true
        }
      }
    },

    NewExpression(path) {
      if (processedNodes.has(path.node)) return
      const name = memberChainName(path.node.callee as t.Expression)
      if (!name) return
      const traces = findMatchingTraces('constructor_call', name, index, filePath)
      if (traces.length === 0) return
      const stmtPath = path.getStatementParent()
      if (!stmtPath) return

      const apiCallTrace = traces.find((tr) => tr.type === 'api_call')
      const apiResponseTrace = traces.find((tr) => tr.type === 'api_response')
      const errorTrace = traces.find((tr) => tr.type === 'error')

      if (apiCallTrace) {
        const dataObj = buildDataObject(apiCallTrace, name, (spec) =>
          buildArgCapture(spec, path.node.arguments),
        )
        const [newPath] = stmtPath.insertBefore(makeLogStatement(apiCallTrace.id, 'api_call', dataObj))
        newPath?.skip()
        hasInjection = true
      }

      if (!apiResponseTrace && !errorTrace) return

      if (apiResponseTrace && !errorTrace) {
        const dataObj = buildDataObject(apiResponseTrace, name, () =>
          t.objectProperty(t.identifier('returnValue'), t.identifier('undefined')),
        )
        const [newPath] = stmtPath.insertAfter(makeLogStatement(apiResponseTrace.id, 'api_response', dataObj))
        newPath?.skip()
        hasInjection = true
        return
      }

      // error (with or without api_response): wrap in try/catch
      processedNodes.add(path.node)
      const tempVar = makeTempVarName()
      const replacementStmts: t.Statement[] = []

      replacementStmts.push(
        t.variableDeclaration('let', [
          t.variableDeclarator(t.identifier(tempVar)),
        ]),
      )

      replacementStmts.push(
        t.tryStatement(
          t.blockStatement([
            t.expressionStatement(
              t.assignmentExpression('=', t.identifier(tempVar), path.node),
            ),
          ]),
          t.catchClause(
            t.identifier('e'),
            t.blockStatement([
              makeLogStatementWithError(
                errorTrace?.id ?? apiResponseTrace!.id,
                'error',
                errorTrace
                  ? buildDataObject(errorTrace, name, (spec) =>
                      buildArgCapture(spec, path.node.arguments),
                    )
                  : t.objectExpression([]),
              ),
              t.throwStatement(t.identifier('e')),
            ]),
          ),
        ),
      )

      if (apiResponseTrace) {
        replacementStmts.push(
          makeLogStatement(
            apiResponseTrace.id,
            'api_response',
            t.objectExpression([t.objectProperty(t.identifier('returnValue'), t.identifier(tempVar))]),
          ),
        )
      }

      const parentDecl = stmtPath.parentPath
      if (
        parentDecl &&
        parentDecl.isVariableDeclarator() &&
        t.isIdentifier(parentDecl.node.id)
      ) {
        const decl = parentDecl.parentPath
        const kind = decl && decl.isVariableDeclaration() ? decl.node.kind : 'const'
        replacementStmts.push(
          t.variableDeclaration(kind, [
            t.variableDeclarator(t.identifier(parentDecl.node.id.name), t.identifier(tempVar)),
          ]),
        )
      }

      stmtPath.replaceWithMultiple(replacementStmts)
      hasInjection = true
    },

    ReturnStatement(path) {
      if (!path.node.argument) return
      const funcName = enclosingFunctionName(path)
      if (!funcName) return
      const traces = findMatchingTraces('return_point', funcName, index, filePath)
      if (traces.length === 0) return

      for (const trace of traces) {
        if (trace.type !== 'state_change') continue
        const dataObj = buildDataObject(trace, null, (spec) => {
          if (spec === 'returnValue' || spec === 'value') {
            return t.objectProperty(t.identifier('returnValue'), t.cloneNode(path.node.argument!))
          }
          return null
        })
        const [newPath] = path.insertBefore(makeLogStatement(trace.id, 'state_change', dataObj))
        newPath?.skip()
        hasInjection = true
      }
    },

    ThrowStatement(path) {
      const funcName = enclosingFunctionName(path)
      if (!funcName) return
      const traces = findMatchingTraces('throw_point', funcName, index, filePath)
      if (traces.length === 0) return

      for (const trace of traces) {
        if (trace.type !== 'error') continue
        const dataObj = buildDataObject(trace, null, (spec) => {
          if (spec === 'value') {
            return t.objectProperty(t.identifier('value'), t.cloneNode(path.node.argument))
          }
          return null
        })
        const [newPath] = path.insertBefore(makeLogStatement(trace.id, 'error', dataObj))
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

// ── Lookup ────────────────────────────────────────────────────

function findMatchingTraces(
  kind: MatchKind,
  target: string,
  index: MatcherIndex,
  filePath?: string,
): Trace[] {
  const results: Trace[] = []

  const exactTraces = index.exact.get(matcherKey(kind, target))
  if (exactTraces) {
    for (const t of exactTraces) {
      if (matchesFileFilter(filePath, t.match.fileFilter)) {
        results.push(t)
      }
    }
  }

  for (const entry of index.patterns) {
    if (entry.kind !== kind) continue
    if (!entry.compiledRegex.test(target)) continue
    for (const t of entry.traces) {
      if (matchesFileFilter(filePath, t.match.fileFilter)) {
        results.push(t)
      }
    }
  }

  return results
}

// ── Name extraction ───────────────────────────────────────────

function calleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string | null {
  return memberChainName(callee as t.Expression)
}

/** Walk up from a ReturnStatement/ThrowStatement to find the enclosing named function. */
function enclosingFunctionName(
  path: NodePath<t.ReturnStatement | t.ThrowStatement>,
): string | null {
  let current: NodePath | null = path.parentPath
  while (current) {
    if (current.isFunctionDeclaration() && t.isIdentifier(current.node.id)) {
      return current.node.id.name
    }
    if (current.isFunctionExpression()) {
      if (t.isIdentifier(current.node.id)) return current.node.id.name
      const parent = current.parentPath
      if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
        return parent.node.id.name
      }
      if (parent?.isObjectProperty()) {
        if (t.isIdentifier(parent.node.key)) return parent.node.key.name
        if (t.isStringLiteral(parent.node.key)) return parent.node.key.value
      }
    }
    if (current.isArrowFunctionExpression()) {
      const parent = current.parentPath
      if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
        return parent.node.id.name
      }
      if (parent?.isObjectProperty()) {
        if (t.isIdentifier(parent.node.key)) return parent.node.key.name
        if (t.isStringLiteral(parent.node.key)) return parent.node.key.value
      }
    }
    if (current.isObjectMethod()) {
      if (t.isIdentifier(current.node.key)) return current.node.key.name
      if (t.isStringLiteral(current.node.key)) return current.node.key.value
    }
    if (current.isClassMethod()) {
      if (t.isIdentifier(current.node.key)) return current.node.key.name
    }
    // Don't cross function boundaries
    if (current.isFunction() || current.isArrowFunctionExpression()) break
    current = current.parentPath ?? null
  }
  return null
}

/** Walk a.b.c.d → "a.b.c.d" */
function memberChainName(node: t.Expression): string | null {
  const parts: string[] = []
  let current: t.Expression = node
  while (true) {
    if (t.isIdentifier(current)) {
      parts.unshift(current.name)
      break
    }
    if (t.isThisExpression(current)) {
      parts.unshift('this')
      break
    }
    if (t.isMemberExpression(current) && !current.computed && t.isIdentifier(current.property)) {
      parts.unshift(current.property.name)
      current = current.object as t.Expression
    } else {
      return null
    }
  }
  return parts.join('.')
}

/** Extract the full member path from a MemberExpression: a.b.c = v → "a.b.c" */
function memberPath(node: t.MemberExpression): string | null {
  return memberChainName(node)
}

// ── Data builders ─────────────────────────────────────────────

function buildDataObject(
  trace: Trace,
  callee: string | null,
  build: (spec: string) => t.ObjectProperty | null,
): t.Expression {
  const props = trace.capture
    .map((spec) => {
      if (spec === '$this') return buildThisCapture(callee)
      return build(spec)
    })
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

function buildResponseCapture(
  spec: string,
  callPath: NodePath<t.CallExpression>,
  elapsedStartVar?: string,
): t.ObjectProperty | null {
  if (spec === 'returnValue') {
    let p = callPath.parentPath
    if (p && p.isAwaitExpression()) p = p.parentPath
    if (p && p.isVariableDeclarator() && t.isIdentifier(p.node.id)) {
      return t.objectProperty(t.identifier('returnValue'), t.cloneNode(p.node.id))
    }
    return t.objectProperty(t.identifier('returnValue'), t.identifier('undefined'))
  }
  if (spec === '$elapsed_ms' && elapsedStartVar) {
    const elapsedVar = makeTempVarName()
    const binExp = t.binaryExpression(
      '-',
      t.callExpression(
        t.memberExpression(t.identifier('performance'), t.identifier('now')),
        [],
      ),
      t.identifier(elapsedStartVar),
    )
    return t.objectProperty(t.identifier('$elapsed_ms'), binExp)
  }
  return null
}

function buildValueCapture(
  spec: string,
  assignPath: NodePath<t.AssignmentExpression>,
): t.ObjectProperty | null {
  if (spec !== 'value') return null
  return t.objectProperty(t.identifier('value'), t.cloneNode(assignPath.node.right))
}

function buildThisCapture(callee: string | null): t.ObjectProperty | null {
  if (!callee) return t.objectProperty(t.identifier('$this'), t.identifier('undefined'))
  const dotIdx = callee.lastIndexOf('.')
  if (dotIdx === -1) return t.objectProperty(t.identifier('$this'), t.identifier('undefined'))
  return t.objectProperty(t.identifier('$this'), t.identifier(callee.slice(0, dotIdx)))
}

function objectKey(spec: string): t.Identifier | t.StringLiteral {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(spec)
    ? t.identifier(spec)
    : t.stringLiteral(spec)
}

// ── Statement builders ────────────────────────────────────────

function makeLogStatement(traceId: string, type: string, dataObj: t.Expression): t.ExpressionStatement {
  return t.expressionStatement(
    t.callExpression(t.identifier('__rt_log'), [
      t.stringLiteral(traceId),
      t.stringLiteral(type),
      dataObj,
    ]),
  )
}

function makeLogStatementWithError(
  traceId: string,
  type: string,
  dataObj: t.Expression,
): t.ExpressionStatement {
  return t.expressionStatement(
    t.callExpression(t.identifier('__rt_log'), [
      t.stringLiteral(traceId),
      t.stringLiteral(type),
      dataObj,
      t.objectExpression([
        t.objectProperty(
          t.identifier('message'),
          t.memberExpression(t.identifier('e'), t.identifier('message')),
        ),
        t.objectProperty(
          t.identifier('name'),
          t.memberExpression(t.identifier('e'), t.identifier('name')),
        ),
      ]),
    ]),
  )
}
