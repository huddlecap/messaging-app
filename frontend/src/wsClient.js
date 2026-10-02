const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 15000
const REPLACED_CLOSE_CODE = 4001

function defaultUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

export function createSocketClient({
  url = defaultUrl(),
  checkSession,
  onMessage,
  onStatus,
  onReplaced,
} = {}) {
  let socket = null
  let retryTimer = null
  let attempt = 0
  let closedIntentionally = false

  function setStatus(status, detail) {
    if (onStatus) onStatus(status, detail)
  }

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function scheduleReconnect() {
    const delay = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS)
    attempt += 1
    setStatus('reconnecting', delay)
    retryTimer = setTimeout(() => {
      retryTimer = null
      open()
    }, delay)
  }

  function handleClose(ws, event) {
    if (socket !== ws) return
    socket = null

    if (closedIntentionally) {
      setStatus('closed')
      return
    }

    if (event.code === REPLACED_CLOSE_CODE) {
      clearRetry()
      setStatus('replaced', event.reason)
      if (onReplaced) onReplaced(event.reason)
      return
    }

    scheduleReconnect()
  }

  function open() {
    clearRetry()
    setStatus('connecting')

    const ws = new WebSocket(url)
    socket = ws

    ws.addEventListener('open', () => {
      if (socket !== ws) return
      attempt = 0
      setStatus('open')
    })

    ws.addEventListener('message', (event) => {
      if (socket !== ws) return
      let payload = null
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      if (onMessage) onMessage(payload)
    })

    ws.addEventListener('close', (event) => handleClose(ws, event))
  }

  async function connect() {
    closedIntentionally = false

    if (checkSession) {
      setStatus('checking')
      try {
        await checkSession()
      } catch (error) {
        setStatus('unauthorized', error.message)
        return
      }
    }

    open()
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(payload))
    return true
  }

  function close() {
    closedIntentionally = true
    clearRetry()
    if (socket) {
      socket.close(1000, 'client closed')
      socket = null
    }
    setStatus('closed')
  }

  function isOpen() {
    return Boolean(socket) && socket.readyState === WebSocket.OPEN
  }

  return { connect, send, close, isOpen }
}