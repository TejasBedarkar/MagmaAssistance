import MessageBubble from './MessageBubble.jsx'
import '../styles/MessageList.css'

export default function MessageList({ messages, listEndRef }) {
  return (
    <div className="message-list">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          sender={message.sender}
          text={message.text}
          animate={message.animate}
        />
      ))}
      <div ref={listEndRef} />
    </div>
  )
}
