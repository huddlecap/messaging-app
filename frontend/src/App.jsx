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
  const [logoutError, setLogoutError] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [messages, setMessages] = useState([])
  const [pending, setPending] = useState([])
  const messageIdsRef = useRef(new Set())
  const pendingRef = useRef([])
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
        if (!payload || !payload.id || !payload.content) return

        if (payload.client_message_id) {
          setPending((prev) => {
            const next = prev.filter(
              (m) => m.client_message_id !== payload.client_message_id,
            )
            pendingRef.current = next
            return next
          })
        }

        const id = payload.id
        if (!messageIdsRef.current.has(id)) {
          messageIdsRef.current.add(id)
          setMessages((prev) => [...prev, payload])
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
    if (socketState.status !== 'open') return

    const queued = pendingRef.current
    if (queued.length === 0) return

    const client = clientRef.current
    queued.forEach((entry) => {
      client?.send({
        receiver_id: entry.receiver_id,
        content: entry.content,
        client_message_id: entry.client_message_id,
      })
    })
  }, [socketState.status])

  useEffect(() => {
    if (pending.length === 0) return undefined

    const interval = setInterval(() => {
      const client = clientRef.current
      if (!client || !client.isOpen()) return

      pendingRef.current.forEach((entry) => {
        client.send({
          receiver_id: entry.receiver_id,
          content: entry.content,
          client_message_id: entry.client_message_id,
        })
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [pending.length])

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

  function sendMessage({ receiver_id, content }) {
    const entry = {
      client_message_id: crypto.randomUUID(),
      receiver_id,
      content,
    }

    pendingRef.current = [...pendingRef.current, entry]
    setPending((prev) => [...prev, entry])

    clientRef.current?.send(entry)
  }

  async function handleLogout() {
    setLogoutError(null)
    try {
      await api.logout()
      setUser(null)
    } catch (error) {
      console.error('Logout failed:', error)
      setLogoutError(error.message || 'Logout failed')
    }
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

  const visiblePending = selectedUser
    ? pending.filter((m) => m.receiver_id === selectedUser.id)
    : []

  return (
    <main className="app">
      <h1>Signed in as {user.username}</h1>
      <p className="status">
        {socketState.status === 'reconnecting'
          ? `Reconnecting in ${Math.max(1, Math.round(socketState.detail / 1000))}s…`
          : STATUS_TEXT[socketState.status] || 'Not connected'}
      </p>
      <button type="button" className="link logout" onClick={handleLogout}>
        Log out
      </button>
      {logoutError && <p className="error">{logoutError}</p>}
      <UserPicker onSelect={setSelectedUser} />
      {selectedUser && (
        <Conversation
          messages={messages}
          pending={visiblePending}
          currentUser={user}
          otherUser={selectedUser}
        />
      )}
      {selectedUser && (
        <Composer
          selectedUser={selectedUser}
          onSend={sendMessage}
        />
      )}
    </main>
  )
}

export default App