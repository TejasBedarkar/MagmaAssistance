import { useState } from 'react'
import VoiceAssistant from './components/VoiceAssistant.jsx'
import ChatLauncherButton from './components/ChatLauncherButton.jsx'
import './styles/App.css'

function App() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="app-shell">
      {isOpen ? (
        <VoiceAssistant onClose={() => setIsOpen(false)} />
      ) : (
        <ChatLauncherButton onClick={() => setIsOpen(true)} />
      )}
    </div>
  )
}

export default App
