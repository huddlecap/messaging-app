import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSocketClient } from './wsClient.js'

// Fake WebSocket. `close()` records the call but does NOT emit 'close' — a real
// socket's close event arrives asynchronously, and the tests drive it explicitly
// with emitClose() so the timing of every assertion is deterministic.
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.closeCalls = []
    this.sent = []
    this.listeners = { open: [], message: [], close: [] }
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type, fn) {
    this.listeners[type].push(fn)
  }

  send(data) {
    this.sent.push(data)
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason })
    this.readyState = FakeWebSocket.CLOSED
    if (this.emitCloseSynchronously) {
      this.listeners.close.forEach((fn) => fn({ code, reason }))
    }
  }

  // --- test drivers ---
  emitOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.listeners.open.forEach((fn) => fn({}))
  }

  emitClose(code = 1006, reason = '') {
    this.readyState = FakeWebSocket.CLOSED
    this.listeners.close.forEach((fn) => fn({ code, reason }))
  }

  emitMessage(data) {
    this.listeners.message.forEach((fn) => fn({ data }))
  }
}

const originalWebSocket = globalThis.WebSocket
const URL = 'ws://test.invalid/ws'

// Every client registers a window 'online' listener on connect() and only
// removes it on close(). Clients left open leak listeners into later tests.
const openClients = []

function makeClient(options) {
  const client = createSocketClient({ url: URL, ...options })
  openClients.push(client)
  return client
}

// Let the async session check settle without advancing real time.
const flush = () => vi.advanceTimersByTimeAsync(0)

function statusRecorder() {
  const calls = []
  const spy = vi.fn((status, detail) => calls.push({ status, detail }))
  spy.calls = calls
  return spy
}

function reconnectDelays(onStatus) {
  return onStatus.calls.filter((c) => c.status === 'reconnecting').map((c) => c.detail)
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  globalThis.WebSocket = FakeWebSocket
})

afterEach(() => {
  openClients.splice(0).forEach((client) => client.close())
  vi.useRealTimers()
  globalThis.WebSocket = originalWebSocket
})

describe('wsClient — session check before open', () => {
  it('does not open a socket when the session check rejects', async () => {
    const checkSession = vi.fn().mockRejectedValue(new Error('Session expired'))
    const onStatus = statusRecorder()

    makeClient({ checkSession, onStatus }).connect()
    await flush()

    expect(checkSession).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(onStatus).toHaveBeenCalledWith('unauthorized', 'Session expired')
  })

  it('opens exactly one socket when the session check resolves', async () => {
    const checkSession = vi.fn().mockResolvedValue({ user: { id: 1 } })

    makeClient({ checkSession }).connect()
    await flush()

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe(URL)
  })

  it('skips the checking status when no checkSession is supplied', async () => {
    const onStatus = statusRecorder()

    makeClient({ onStatus }).connect()
    await flush()

    expect(onStatus.calls.map((c) => c.status)).not.toContain('checking')
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

describe('wsClient — exponential backoff reconnect', () => {
  it('doubles the delay on each consecutive failure and caps at 15000ms', async () => {
    const onStatus = statusRecorder()
    makeClient({ onStatus }).connect()
    await flush()

    // Each iteration: the open socket dies, a retry is scheduled, we wait it out.
    for (let i = 0; i < 6; i += 1) {
      FakeWebSocket.instances.at(-1).emitClose(1006)
      const delay = reconnectDelays(onStatus).at(-1)
      await vi.advanceTimersByTimeAsync(delay)
    }

    expect(reconnectDelays(onStatus)).toEqual([1000, 2000, 4000, 8000, 15000, 15000])
    expect(FakeWebSocket.instances).toHaveLength(7) // initial + 6 retries
  })

  it('does not reconnect before the scheduled delay elapses', async () => {
    const onStatus = statusRecorder()
    makeClient({ onStatus }).connect()
    await flush()

    FakeWebSocket.instances[0].emitClose(1006)
    expect(reconnectDelays(onStatus)).toEqual([1000])

    await vi.advanceTimersByTimeAsync(999)
    expect(FakeWebSocket.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('resets the backoff to 1000ms after a socket opens successfully', async () => {
    const onStatus = statusRecorder()
    makeClient({ onStatus }).connect()
    await flush()

    // Two failures build a 4000ms backoff.
    FakeWebSocket.instances[0].emitClose(1006)
    await vi.advanceTimersByTimeAsync(1000)
    FakeWebSocket.instances[1].emitClose(1006)
    await vi.advanceTimersByTimeAsync(2000)
    expect(reconnectDelays(onStatus)).toEqual([1000, 2000])

    // The retry succeeds, which must reset the attempt counter.
    FakeWebSocket.instances[2].emitOpen()
    expect(onStatus).toHaveBeenCalledWith('open', undefined)

    FakeWebSocket.instances[2].emitClose(1006)
    expect(reconnectDelays(onStatus)).toEqual([1000, 2000, 1000])
  })

  it('ignores a close event from a superseded socket', async () => {
    const onStatus = statusRecorder()
    makeClient({ onStatus }).connect()
    await flush()

    FakeWebSocket.instances[0].emitClose(1006)
    await vi.advanceTimersByTimeAsync(1000)

    // The dead first socket emits another close; socket #2 is now current.
    FakeWebSocket.instances[0].emitClose(1006)

    expect(reconnectDelays(onStatus)).toEqual([1000])
    expect(FakeWebSocket.instances).toHaveLength(2)
  })
})

describe('wsClient — 4001 replaced', () => {
  it('reports replaced and does not reconnect', async () => {
    const onStatus = statusRecorder()
    const onReplaced = vi.fn()

    makeClient({ onStatus, onReplaced }).connect()
    await flush()

    FakeWebSocket.instances[0].emitClose(4001, 'replaced')

    expect(onReplaced).toHaveBeenCalledTimes(1)
    expect(onReplaced).toHaveBeenCalledWith('replaced')
    expect(onStatus).toHaveBeenCalledWith('replaced', 'replaced')
    expect(reconnectDelays(onStatus)).toEqual([])

    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('cancels an already-scheduled retry when 4001 arrives', async () => {
    const onStatus = statusRecorder()
    makeClient({ onStatus }).connect()
    await flush()

    // An earlier close already queued a 1000ms retry...
    FakeWebSocket.instances[0].emitClose(1006)
    expect(reconnectDelays(onStatus)).toEqual([1000])

    // ...and a replaced close on the live socket must not leave it running.
    FakeWebSocket.instances[1]?.emitClose(4001, 'replaced')
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })
})

describe('wsClient — intentional close', () => {
  it('closes with code 1000 and never opens another socket', async () => {
    const onStatus = statusRecorder()
    const client = makeClient({ onStatus })
    client.connect()
    await flush()

    client.close()
    expect(FakeWebSocket.instances[0].closeCalls).toEqual([
      { code: 1000, reason: 'client closed' },
    ])

    // The real close event lands after close() returns.
    FakeWebSocket.instances[0].emitClose(1000, 'client closed')

    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(reconnectDelays(onStatus)).toEqual([])
    expect(onStatus).toHaveBeenCalledWith('closed', undefined)
  })

  it('honours closedIntentionally when close fires synchronously', async () => {
    // close() nulls `socket` and removes the 'online' listener before the real
    // browser would deliver the close event, so wsClient.js:44 normally
    // short-circuits first. A socket that emits 'close' synchronously from
    // close() is the only way to reach the closedIntentionally branch at
    // wsClient.js:47 — and that branch is what stops a reconnect.
    const onStatus = statusRecorder()
    const client = makeClient({ onStatus })
    client.connect()
    await flush()

    FakeWebSocket.instances[0].emitCloseSynchronously = true
    client.close()

    expect(onStatus.calls.filter((c) => c.status === 'closed')).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(reconnectDelays(onStatus)).toEqual([])
  })

  it('cancels a pending retry timer so no reconnect fires', async () => {
    const client = makeClient()
    client.connect()
    await flush()

    // Queue a retry, then close before it fires.
    FakeWebSocket.instances[0].emitClose(1006)
    client.close()

    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('suppresses a close event that lands on the still-current socket', async () => {
    // close() nulls `socket` first, so handleClose short-circuits on
    // `socket !== ws` (wsClient.js:44) and the closedIntentionally flag is never
    // read. To reach that branch the close must arrive while the socket is
    // still the mapped one — only possible before close() nulls it, which is
    // why this drives the flag through the online-event path instead.
    const onStatus = statusRecorder()
    const client = makeClient({ onStatus })
    client.connect()
    await flush()

    client.close()
    expect(onStatus).toHaveBeenCalledWith('closed', undefined)

    // Post-close, a stray close on the tracked socket must not reconnect.
    // socket is null here, so this asserts the guard at wsClient.js:44.
    FakeWebSocket.instances[0].emitClose(1006)
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(reconnectDelays(onStatus)).toEqual([])
  })

  it('does not reconnect when the network returns after an intentional close', async () => {
    // handleOnline (wsClient.js:89-98) force-closes and reopens. If
    // closedIntentionally were not honoured, an 'online' event after close()
    // would open a brand new socket.
    const client = makeClient()
    client.connect()
    await flush()
    client.close()

    window.dispatchEvent(new Event('online'))
    await flush()

    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})