import { useEffect, useMemo, useState } from 'react'
import '../styles/MessageBubble.css'

const WORD_REVEAL_INTERVAL_MS = 160

export default function MessageBubble({ sender, text, animate = false }) {
  const isAssistant = sender === 'assistant'
  const words = useMemo(() => text.split(' '), [text])
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : words.length)

  useEffect(() => {
    if (!animate) {
      setVisibleCount(words.length)
      return undefined
    }

    setVisibleCount(0)
    const timer = setInterval(() => {
      setVisibleCount((count) => {
        if (count >= words.length) {
          clearInterval(timer)
          return count
        }
        return count + 1
      })
    }, WORD_REVEAL_INTERVAL_MS)

    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate])

  const displayedText = words.slice(0, visibleCount).join(' ')

  return (
    <div className={`message-row ${isAssistant ? 'message-row--assistant' : 'message-row--user'}`}>
      {isAssistant && <div className="avatar avatar--assistant">AI</div>}
      <div className={`bubble ${isAssistant ? 'bubble--assistant' : 'bubble--user'}`}>{displayedText}</div>
      {!isAssistant && <div className="avatar avatar--user">You</div>}
    </div>
  )
}
