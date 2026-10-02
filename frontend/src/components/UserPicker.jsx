import { useEffect, useState } from 'react'
import * as api from '../api.js'

function UserPicker({ onSelect }) {
  const [users, setUsers] = useState(undefined)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let cancelled = false

    api.listUsers().then(
      (data) => {
        if (!cancelled) setUsers(data.users)
      },
      (err) => {
        if (!cancelled) setError(err.message)
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  function handleClick(user) {
    setSelectedId(user.id)
    onSelect(user)
  }

  if (error) {
    return <p className="error">Failed to load users: {error}</p>
  }

  if (users === undefined) {
    return <p className="status">Loading users…</p>
  }

  if (users.length === 0) {
    return <p className="status">No other users yet.</p>
  }

  return (
    <section className="user-picker">
      <h2>Who do you want to chat with?</h2>
      <ul>
        {users.map((user) => (
          <li key={user.id}>
            <button
              type="button"
              className={selectedId === user.id ? 'selected' : ''}
              onClick={() => handleClick(user)}
            >
              {user.username}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default UserPicker