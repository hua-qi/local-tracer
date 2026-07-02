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

function __rt_log_getShortStack() {
  try {
    var err = new Error()
    var stack = (err.stack || '').split('\\n').map(function (l) { return l.trim() })
    // Drop the first two frames: "Error" and __rt_log_getShortStack and __rt_log itself.
    var frames = stack.filter(function (l) { return l.length > 0 }).slice(3, 6)
    return frames
  } catch (e) {
    return []
  }
}

function __rt_log(eventId, type, data) {
  try {
    var payload = {
      traceId: __TRACER_SESSION_ID__,
      eventId: eventId,
      type: type,
      data: data,
      callStack: __rt_log_getShortStack(),
      url: (typeof location !== 'undefined') ? location.href : null,
      timestamp: Date.now()
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
