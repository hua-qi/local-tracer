import React from 'react'
import { createRoot } from 'react-dom/client'

let userAuth: { name: string } | null = null

async function fetchUserData(userId: number): Promise<{ name: string }> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ name: '子蒙-' + userId }), 50)
  })
}

function handleLogin() {
  fetchUserData(1).then((res) => {
    // @ts-expect-error intentional bug
    userAuth = { name: res.user.name }
    document.getElementById('out')!.textContent = 'login done: ' + JSON.stringify(userAuth)
  })
}

function App() {
  return (
    <div>
      <h1>Tracer Webpack Example</h1>
      <button id="login" onClick={handleLogin}>Login</button>
      <pre id="out">not logged in</pre>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(React.createElement(App))
