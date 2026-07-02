import React from 'react'
import { createRoot } from 'react-dom/client'

// A fake API module. Tracer will inject __rt_log around fetchUserData and
// (via assignment matching) around writes to userAuth.
let userAuth: { name: string } | null = null

async function fetchUserData(userId: number): Promise<{ name: string }> {
  // Pretend to hit a backend. In real life this would be `fetch('/api/user/' + userId)`.
  return new Promise((resolve) => {
    setTimeout(() => resolve({ name: '子蒙-' + userId }), 50)
  })
}

function handleLogin() {
  // Bug: we access res.name.user — wrong shape. Tracer log will surface the
  // actual API response so the agent can see the mismatch.
  fetchUserData(1).then((res) => {
    // @ts-expect-error — intentional bug: res has no .user
    userAuth = { name: res.user.name }
    document.getElementById('out')!.textContent = 'login done: ' + JSON.stringify(userAuth)
  })
}

function App() {
  return (
    <div>
      <h1>Tracer Vite Example</h1>
      <button id="login" onClick={handleLogin}>Login</button>
      <pre id="out">not logged in</pre>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
