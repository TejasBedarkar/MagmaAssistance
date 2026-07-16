import { useState, useRef } from "react";
import {
  HiOutlineChatBubbleLeftRight,
  HiOutlineXMark,
  HiOutlinePaperAirplane,
  HiOutlineMicrophone,
  HiMicrophone,
} from "react-icons/hi2";
import axios from "axios";
import "../styles/portalChatbot.css";

// Small inline stop-square icon — kept local (no extra icon-pack
// dependency) since "stop" isn't a consistently-named icon across
// react-icons/hi2 versions.
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

/**
 * Global floating assistant launcher — fixed bottom-left, visible on every
 * authenticated page (mounted once in Layout). Connected to the local FastAPI
 * server on port 8050. Supports voice recording, spoken (TTS) replies, and
 * interrupting either a pending request or audio that's currently playing.
 */
export default function PortalChatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState([
    { from: "bot", text: "Hi! How can I help you today?" },
  ]);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);

  // Playback of the bot's spoken (TTS) reply.
  const ttsAudioRef = useRef(null);
  const ttsUrlRef = useRef(null);

  // Lets the interrupt button cancel an in-flight /query request.
  const abortControllerRef = useRef(null);

  const getTtsAudioEl = () => {
    if (!ttsAudioRef.current) {
      const audio = new Audio();
      audio.onended = () => {
        setIsSpeaking(false);
        if (ttsUrlRef.current) {
          URL.revokeObjectURL(ttsUrlRef.current);
          ttsUrlRef.current = null;
        }
      };
      audio.onerror = () => setIsSpeaking(false);
      ttsAudioRef.current = audio;
    }
    return ttsAudioRef.current;
  };

  const stopSpeaking = () => {
    const audio = ttsAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    setIsSpeaking(false);
  };

  // Decodes the base64 WAV the backend sends back and plays it. Stops
  // anything already playing first so replies never overlap.
  const playReplyAudio = (base64Audio) => {
    if (!base64Audio) return;
    stopSpeaking();

    try {
      const byteChars = atob(base64Audio);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      ttsUrlRef.current = url;

      const audio = getTtsAudioEl();
      audio.src = url;
      setIsSpeaking(true);
      audio.play().catch((err) => {
        console.error("Audio playback failed:", err);
        setIsSpeaking(false);
      });
    } catch (err) {
      console.error("Failed to decode reply audio:", err);
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Audio recording is not supported in this browser.");
      return;
    }
    // Barge-in: if the bot is mid-sentence, recording a new question cuts it off.
    stopSpeaking();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        await sendAudioMessage(audioBlob);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);

      // Stop all audio tracks to turn off the microphone light
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    }
  };

  // Cancels whatever's currently happening: an in-flight request, the bot
  // speaking, or an active recording — whichever applies.
  const interrupt = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopSpeaking();
    if (recording) {
      stopRecording();
    }
    setLoading(false);
  };

  const sendAudioMessage = async (audioBlob) => {
    stopSpeaking();
    setLoading(true);
    // Optimistic voice message placeholder
    setMessages((prev) => [...prev, { from: "user", text: "🎤 Sent voice query..." }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const formData = new FormData();
      // Whisper expects a file uploaded as "file"
      formData.append("file", audioBlob, "voice.webm");

      const response = await axios.post("http://127.0.0.1:8050/query", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        signal: controller.signal,
      });

      const userText = response.data?.query || "🎤 Voice query transcribed";
      const reply = response.data?.response || "I didn't receive a response from the server.";

      // Replace the placeholder voice note with real transcribed text
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1] = { from: "user", text: `🎤 ${userText}` };
        }
        return [...updated, { from: "bot", text: reply }];
      });

      playReplyAudio(response.data?.audio);
    } catch (error) {
      if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
        // User hit interrupt on purpose — no error bubble needed.
      } else {
        console.error("Voice upload error:", error);
        setMessages((prev) => [
          ...prev,
          { from: "bot", text: "Error: Could not transcribe or connect to backend." },
        ]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const send = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    stopSpeaking();
    setMessages((prev) => [...prev, { from: "user", text }]);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("query", text);

      const response = await axios.post("http://127.0.0.1:8050/query", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        signal: controller.signal,
      });

      const reply = response.data?.response || "I didn't receive a response from the server.";
      setMessages((prev) => [...prev, { from: "bot", text: reply }]);
      playReplyAudio(response.data?.audio);
    } catch (error) {
      if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
        // User hit interrupt on purpose — no error bubble needed.
      } else {
        console.error("Chat assistant error:", error);
        setMessages((prev) => [
          ...prev,
          { from: "bot", text: "Error: Could not connect to the assistant backend." },
        ]);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const showInterrupt = loading || isSpeaking || recording;
  const interruptLabel = recording ? "Stop recording" : loading ? "Stop" : "Stop speaking";

  return (
    <>
      {open ? (
        <div className="portal-chatbot__panel" role="dialog" aria-label="Assistant">
          <div className="portal-chatbot__header">
            <span className="portal-chatbot__title">
              <HiOutlineChatBubbleLeftRight aria-hidden="true" />
              Assistant
            </span>
            <button
              type="button"
              className="portal-chatbot__close"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              <HiOutlineXMark aria-hidden="true" />
            </button>
          </div>

          <div className="portal-chatbot__body">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`portal-chatbot__msg portal-chatbot__msg--${m.from}`}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div className="portal-chatbot__msg portal-chatbot__msg--bot">
                Thinking...
              </div>
            )}
            {!loading && isSpeaking && (
              <div className="portal-chatbot__msg portal-chatbot__msg--bot">
                🔊 Speaking...
              </div>
            )}
          </div>

          {showInterrupt && (
            <div className="portal-chatbot__status-bar">
              <button
                type="button"
                className="portal-chatbot__stop-btn"
                onClick={interrupt}
                aria-label={interruptLabel}
              >
                <StopIcon />
                {interruptLabel}
              </button>
            </div>
          )}

          <form className="portal-chatbot__input" onSubmit={send}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              aria-label="Message"
              disabled={loading || recording}
            />

            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              className={`portal-chatbot__mic-btn${recording ? " is-recording" : ""}`}
              aria-label={recording ? "Stop recording" : "Record voice"}
              disabled={loading}
            >
              {recording ? (
                <HiMicrophone aria-hidden="true" />
              ) : (
                <HiOutlineMicrophone aria-hidden="true" />
              )}
            </button>

            <button type="submit" aria-label="Send" disabled={loading || recording}>
              <HiOutlinePaperAirplane aria-hidden="true" />
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className={`portal-chatbot__launcher${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        aria-expanded={open}
      >
        {open ? (
          <HiOutlineXMark aria-hidden="true" />
        ) : (
          <HiOutlineChatBubbleLeftRight aria-hidden="true" />
        )}
      </button>
    </>
  );
}