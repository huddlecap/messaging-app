import { useState } from 'react'

function Composer({ selectedUser, onSend }) {
  const [text, setText] = useState('')

  const canSend = selectedUser && text.trim().length > 0

  function handleSubmit(event) {
    event.preventDefault()
    if (!canSend) return

    onSend({ receiver_id: selectedUser.id, content: text.trim() })
    setText('')
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