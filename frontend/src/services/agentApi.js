const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

/**
 * Sends a text message to the backend agent (server.py -> Main.py's
 * VoiceAssistant) and returns { reply, audio }, where `audio` is a
 * base64-encoded WAV string (or null if the backend couldn't produce one).
 */
export async function sendChatMessage(message) {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Agent request failed (${response.status})`)
  }

  const data = await response.json()
  return { reply: data.reply, audio: data.audio || null }
}
