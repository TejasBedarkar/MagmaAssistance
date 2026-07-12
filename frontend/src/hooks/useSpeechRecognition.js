import { useEffect, useRef, useState } from 'react'

export function useSpeechRecognition({ onResult } = {}) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const recognitionRef = useRef(null)

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setIsSupported(false)
      return
    }
    setIsSupported(true)

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      onResult?.(transcript)
    }
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    return () => recognition.stop()
  }, [onResult])

  const start = () => {
    if (!recognitionRef.current || isListening) return
    setIsListening(true)
    recognitionRef.current.start()
  }

  const stop = () => {
    if (!recognitionRef.current) return
    recognitionRef.current.stop()
    setIsListening(false)
  }

  const toggle = () => (isListening ? stop() : start())

  return { isListening, isSupported, start, stop, toggle }
}
