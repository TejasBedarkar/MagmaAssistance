import { useState, useRef, useEffect } from 'react'
import AssistantHeader from './AssistantHeader.jsx'
import MessageList from './MessageList.jsx'
import SuggestionChips from './SuggestionChips.jsx'
import InputBar from './InputBar.jsx'
import { pickChatFolder, saveChatToFolder } from '../services/chatFolderStorage.js'
import { sendChatMessage } from '../services/agentApi.js'
import '../styles/VoiceAssistant.css'

const INITIAL_MESSAGE = {
  id: 'welcome',
  sender: 'assistant',
  text:
    "Hi! I'm your ERP Voice Assistant. Ask me about inventory, orders, invoices, employees, or reports — you can type or use the mic.",
}

const SUGGESTIONS = [
  'Pending purchase orders',
  'Low stock items',
  'Monthly sales summary',
  'Outstanding invoices',
]

export default function VoiceAssistant({ onClose }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [folderHandle, setFolderHandle] = useState(null)
  const [isSending, setIsSending] = useState(false)
  const listEndRef = useRef(null)
  const audioRef = useRef(null)

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!folderHandle) return
    saveChatToFolder(folderHandle, messages).catch((error) => {
      console.error('Failed to save chat to folder:', error)
    })
  }, [messages, folderHandle])

  const sendMessage = async (text) => {
    const trimmed = text.trim()
    if (!trimmed || isSending) return

    const userMessage = { id: crypto.randomUUID(), sender: 'user', text: trimmed }
    setMessages((prev) => [...prev, userMessage])
    setIsSending(true)

    try {
      const { reply, audio } = await sendChatMessage(trimmed)
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), sender: 'assistant', text: reply, animate: true },
      ])

      if (audio && audioRef.current) {
        audioRef.current.src = `data:audio/wav;base64,${audio}`
        audioRef.current.play().catch((err) => {
          console.warn('Autoplay was blocked by the browser; audio needs a manual play:', err)
        })
      }
    } catch (error) {
      console.error('Agent request failed:', error)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender: 'assistant',
          text: "Couldn't reach the assistant backend. Make sure backend/server.py is running.",
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  const handleClear = () => {
    setMessages([INITIAL_MESSAGE])
  }

  const handleChooseFolder = async () => {
    try {
      const handle = await pickChatFolder()
      setFolderHandle(handle)
    } catch (error) {
      console.error('Failed to select chat folder:', error)
    }
  }

  return (
    <div className="assistant-card">
      <AssistantHeader
        isFolderConnected={Boolean(folderHandle)}
        onChooseFolder={handleChooseFolder}
        onClear={handleClear}
        onClose={onClose}
      />
      <MessageList messages={messages} listEndRef={listEndRef} />
      <SuggestionChips suggestions={SUGGESTIONS} onSelect={sendMessage} />
      <InputBar onSend={sendMessage} disabled={isSending} />
      <audio ref={audioRef} hidden />
    </div>
  )
}
