import { useEffect, useState } from 'react'
import * as api from './api.js'
import AuthScreen from './components/AuthScreen.jsx'

function App() {
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    api.setUnauthorizedHandler(() => setUser(null))
    return () => api.setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    let cancelled = false

    api.me().then(
      (data) => {
        if (!cancelled) setUser(data.user)
      },
      () => {
        if (!cancelled) setUser(null)
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  if (user === undefined) {
    return <main className="checking">Checking session…</main>
  }

  if (user === null) {
    return <AuthScreen onAuthenticated={setUser} />
  }

  return (
    <main className="app">
      <h1>Signed in as {user.username}</h1>
      <p>Conversation UI arrives in the next steps.</p>
    </main>
  )
}

export default App