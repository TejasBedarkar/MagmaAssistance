import { useCallback, useState } from 'react'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition.js'
import '../styles/InputBar.css'

export default function InputBar({ onSend, disabled = false }) {
  const [value, setValue] = useState('')

  const handleVoiceResult = useCallback((transcript) => {
    setValue(transcript)
  }, [])

  const { isListening, isSupported, toggle } = useSpeechRecognition({ onResult: handleVoiceResult })

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!value.trim() || disabled) return
    onSend(value)
    setValue('')
  }

  return (
    <form className="input-bar" onSubmit={handleSubmit}>
      <input
        type="text"
        className="input-bar__field"
        placeholder={disabled ? 'Waiting for assistant...' : 'Ask about orders, stock, invoices...'}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={disabled}
      />
      <button
        type="button"
        className={`input-bar__mic ${isListening ? 'input-bar__mic--active' : ''}`}
        onClick={toggle}
        disabled={!isSupported || disabled}
        title={isSupported ? 'Speak your question' : 'Voice input not supported in this browser'}
      >
        <MicGlyph />
      </button>
      <button type="submit" className="input-bar__send" title="Send" disabled={!value.trim() || disabled}>
        <SendGlyph />
      </button>
    </form>
  )
}

function MicGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  )
}

function SendGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M2 12l19-9-4 9 4 9-19-9z" />
    </svg>
  )
}
