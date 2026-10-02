import { useState } from 'react'

function Composer({ selectedUser, socketState, onSend }) {
  const [text, setText] = useState('')

  const canSend =
    selectedUser &&
    socketState.status === 'open' &&
    text.trim().length > 0

  function handleSubmit(event) {
    event.preventDefault()
    if (!canSend) return

    const payload = {
      receiver_id: selectedUser.id,
      content: text.trim(),
      client_message_id: crypto.randomUUID(),
    }

    if (onSend(payload)) {
      setText('')
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <input
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          selectedUser ? `Message ${selectedUser.username}…` : 'Select a user first'
        }
        disabled={!selectedUser}
      />
      <button type="submit" disabled={!canSend}>
        Send
      </button>
    </form>
  )
}

export default Composer