// Runtime helper source injected into every bundle that contains __rt_log calls.
// Exposed as a string so it can be prepended to the generated bundle verbatim.
export const RUNTIME_HELPER_SOURCE = `
var __TRACER_SESSION_ID__ = (function () {
  try {
    if (typeof window === 'undefined') return null
    if (window.__TRACER_SESSION_ID__) return window.__TRACER_SESSION_ID__
    var uuid = (function () {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0
        var v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    })()
    window.__TRACER_SESSION_ID__ = uuid
    return uuid
  } catch (e) {
    return null
  }
})()

if (typeof window !== 'undefined' && window.__TRACER_SEQ__ === undefined) {
  window.__TRACER_SEQ__ = 0
}

function __rt_log_parseFrame(line) {
  if (!line) return null
  // Skip "Error" line and tracer internal frames
  if (line.indexOf('__rt_log') !== -1) return null
  // V8: at functionName (file:line:col) or at file:line:col
  var v8Full = line.match(/^\\s*at\\s+(.+?)\\s+\\((.+?):(\\d+):(\\d+)\\)\\s*$/)
  if (v8Full) {
    return { 'function': v8Full[1], file: v8Full[2], line: parseInt(v8Full[3], 10), col: parseInt(v8Full[4], 10) }
  }
  var v8Anon = line.match(/^\\s*at\\s+(.+?):(\\d+):(\\d+)\\s*$/)
  if (v8Anon) {
    return { 'function': '', file: v8Anon[1], line: parseInt(v8Anon[2], 10), col: parseInt(v8Anon[3], 10) }
  }
  // Firefox: functionName@file:line:col or @file:line:col
  var ffMatch = line.match(/^\\s*(\\S*)@(.+?):(\\d+):(\\d+)\\s*$/)
  if (ffMatch) {
    return { 'function': ffMatch[1] || '', file: ffMatch[2], line: parseInt(ffMatch[3], 10), col: parseInt(ffMatch[4], 10) }
  }
  return null
}

function __rt_log_getStackFrames() {
  try {
    var err = new Error()
    var lines = (err.stack || '').split('\\n')
    var frames = []
    for (var i = 0; i < lines.length; i++) {
      var frame = __rt_log_parseFrame(lines[i])
      if (frame) frames.push(frame)
    }
    return frames
  } catch (e) {
    return []
  }
}

function __rt_log(eventId, type, data, errorInfo) {
  try {
    var seq = window.__TRACER_SEQ__ !== undefined ? window.__TRACER_SEQ__++ : 0
    var payload = {
      seq: seq,
      traceId: __TRACER_SESSION_ID__,
      eventId: eventId,
      type: type,
      timestamp: Date.now(),
      data: data,
      request: type === 'api_call' ? (data && data.request) || null : null,
      error: errorInfo || null,
      callStack: __rt_log_getStackFrames(),
      url: (typeof location !== 'undefined') ? location.href : null
    }
    fetch('/rt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {})
  } catch (e) {
    // swallow — must never break business logic
  }
}
`
