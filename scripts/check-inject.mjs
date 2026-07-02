import { inject } from '../dist/core/ast-injector.js'
import { validateConfig, buildMatcherIndex } from '../dist/core/config.js'

const idx = (traces) => buildMatcherIndex(validateConfig({ version: 1, traces }))
const opt = { prependHelper: false }

const tests = [
  ['T1 api_call before call', () => {
    const r = inject('async function fetchUserData(id) { const res = await fetchUserData(id); return res }', idx([{id:'fetchUserData',type:'api_call',match:{kind:'function_call',name:'fetchUserData'},capture:['arguments[0]']}]), opt)
    return r.hasInjection && r.code.includes('api_call') && r.code.includes('"arguments[0]": id')
  }],
  ['T2 api_response after call (returnValue: res)', () => {
    const r = inject('async function run() { const res = await api.get("/user"); return res }', idx([{id:'getUser',type:'api_response',match:{kind:'function_call',name:'api.get'},capture:['returnValue']}]), opt)
    return r.hasInjection && /returnValue: res\b/.test(r.code)
  }],
  ['T3 state_change after assignment (value: data)', () => {
    const r = inject('function apply(data) { userAuth = data }', idx([{id:'setUserAuth',type:'state_change',match:{kind:'assignment',name:'userAuth'},capture:['value']}]), opt)
    return r.hasInjection && /value: data\b/.test(r.code)
  }],
  ['T4 helper prepended', () => {
    const r = inject('fetchUserData(1)', idx([{id:'fetchUserData',type:'api_call',match:{kind:'function_call',name:'fetchUserData'},capture:['arguments[0]']}]))
    return r.code.includes('function __rt_log(eventId, type, data)') && r.code.includes('window.__TRACER_SESSION_ID__')
  }],
  ['T5 no match → unchanged', () => {
    const r = inject('fetchOther(1)', idx([{id:'fetchUserData',type:'api_call',match:{kind:'function_call',name:'fetchUserData'},capture:['arguments[0]']}]), opt)
    return !r.hasInjection && r.code === 'fetchOther(1)'
  }],
  ['T6 empty index → unchanged', () => {
    const r = inject('foo()', idx([]))
    return !r.hasInjection && r.code === 'foo()'
  }],
  ['T7 missing arg → undefined', () => {
    const r = inject('fetchUserData()', idx([{id:'fetchUserData',type:'api_call',match:{kind:'function_call',name:'fetchUserData'},capture:['arguments[0]']}]), opt)
    return /"arguments\[0\]": undefined/.test(r.code)
  }],
  ['T8 preserves original call', () => {
    const r = inject('const x = fetchUserData(42)', idx([{id:'fetchUserData',type:'api_call',match:{kind:'function_call',name:'fetchUserData'},capture:['arguments[0]']}]), opt)
    return /const x = fetchUserData\(42\)/.test(r.code)
  }],
  ['T9 TS source', () => {
    const r = inject('async function fetchUserData(id: number): Promise<User> { return await api.get("/user/" + id) }', idx([{id:'getUser',type:'api_response',match:{kind:'function_call',name:'api.get'},capture:['returnValue']}]), opt)
    return r.hasInjection
  }],
  ['T10 JSX source', () => {
    const r = inject('function Hello() { return <div onClick={() => handleClick("x")}>hi</div> }', idx([{id:'click',type:'api_call',match:{kind:'function_call',name:'handleClick'},capture:['arguments[0]']}]), opt)
    return r.hasInjection
  }],
  ['T11 unparseable input', () => {
    const r = inject('}}}}not valid js{{{{', idx([{id:'foo',type:'api_call',match:{kind:'function_call',name:'foo'},capture:[]}]), opt)
    return !r.hasInjection && r.code === '}}}}not valid js{{{{'
  }],
]

let pass = 0
let fail = 0
for (const [name, fn] of tests) {
  try {
    const ok = fn()
    if (ok) { pass++; console.log(`PASS ${name}`) }
    else { fail++; console.log(`FAIL ${name}`) }
  } catch (e) {
    fail++; console.log(`FAIL ${name} — exception: ${e.message}`)
  }
}
console.log(`\n${pass}/${pass+fail} passed`)
process.exit(fail > 0 ? 1 : 0)
