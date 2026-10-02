function Conversation({ messages, currentUser, otherUser }) {
  if (!otherUser) return null

  return (
    <section className="conversation">
      <h2>Chat with {otherUser.username}</h2>
      <div className="messages">
        {messages.length === 0 && <p className="status">No messages yet.</p>}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.sender_id === currentUser.id ? 'message sent' : 'message received'
            }
          >
            <p className="content">{msg.content}</p>
            <span className="time">{new Date(msg.created_at).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default Conversation