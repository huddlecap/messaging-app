import { useEffect, useRef, useState } from 'react'
import * as api from './api.js'
import AuthScreen from './components/AuthScreen.jsx'
import { createSocketClient } from './wsClient.js'
import UserPicker from './components/UserPicker.jsx'
import Conversation from './components/Conversation.jsx'
import Composer from './components/Composer.jsx'

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
  const [messages, setMessages] = useState([])
  const messageIdsRef = useRef(new Set())
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
      onMessage: (payload) => {
        if (payload && payload.id && payload.content) {
          const id = payload.id
          if (!messageIdsRef.current.has(id)) {
            messageIdsRef.current.add(id)
            setMessages((prev) => [...prev, payload])
          }
        }
      },
    })

    clientRef.current = client
    client.connect()

    return () => {
      client.close()
      clientRef.current = null
    }
  }, [user])

  useEffect(() => {
    if (!selectedUser) {
      messageIdsRef.current = new Set()
      return undefined
    }

    let cancelled = false
    messageIdsRef.current = new Set()

    api.history(selectedUser.id).then(
      (data) => {
        if (cancelled) return
        const msgs = data.messages || []
        messageIdsRef.current = new Set(msgs.map((m) => m.id))
        setMessages(msgs.reverse())
      },
      (err) => {
        if (!cancelled) console.error('Failed to load history:', err)
      },
    )

    return () => {
      cancelled = true
    }
  }, [selectedUser])

  function sendMessage(payload) {
    const client = clientRef.current
    if (!client) return false
    return client.send(payload)
  }

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
        <Conversation
          messages={messages}
          currentUser={user}
          otherUser={selectedUser}
        />
      )}
      {selectedUser && (
        <Composer
          selectedUser={selectedUser}
          socketState={socketState}
          onSend={sendMessage}
        />
      )}
    </main>
  )
}

export default App