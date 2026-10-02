import { useEffect, useRef, useState } from 'react'
import * as api from './api.js'
import AuthScreen from './components/AuthScreen.jsx'
import { createSocketClient } from './wsClient.js'
import UserPicker from './components/UserPicker.jsx'

const STATUS_TEXT = {
  checking: 'Checking session…',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Disconnected',
  unauthorized: 'Session expired',
}

function App() {
  const [user, setUser] = useState(undefined)
  const [socketState, setSocketState] = useState({ status: 'idle' })
  const [replacedFor, setReplacedFor] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const clientRef = useRef(null)

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

  useEffect(() => {
    if (!user) return undefined

    const client = createSocketClient({
      checkSession: api.me,
      onStatus: (status, detail) => setSocketState({ status, detail }),
      onReplaced: () => setReplacedFor(user.id),
      onMessage: (payload) => console.log('ws message', payload),
    })

    clientRef.current = client
    client.connect()

    return () => {
      client.close()
      clientRef.current = null
    }
  }, [user])

  if (user === undefined) {
    return <main className="checking">Checking session…</main>
  }

  if (user === null) {
    return <AuthScreen onAuthenticated={setUser} />
  }

  if (replacedFor === user.id) {
    return (
      <main className="app">
        <h1>Signed in on another tab</h1>
        <p>This tab was disconnected because the same account connected elsewhere.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Take over this tab
        </button>
      </main>
    )
  }

  return (
    <main className="app">
      <h1>Signed in as {user.username}</h1>
      <p className="status">
        {socketState.status === 'reconnecting'
          ? `Reconnecting in ${Math.max(1, Math.round(socketState.detail / 1000))}s…`
          : STATUS_TEXT[socketState.status] || 'Not connected'}
      </p>
      <UserPicker onSelect={setSelectedUser} />
      {selectedUser && (
        <p className="status">Chatting with {selectedUser.username}</p>
      )}
    </main>
  )
}

export default App