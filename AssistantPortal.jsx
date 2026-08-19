import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import BentoWelcome from './BentoWelcome';
import ChatArea, { ToolActivityPanel, ChartBlock, FormattedMarkdownText, EmbeddedBase64Image, getCleanTextAndChart, API_BASE_URL } from './ChatArea';
import { useVoiceSession } from './useVoiceSession';
import OrbController from './orb/OrbController.js';
import './orb.css';

// API_BASE_URL now lives in ChatArea.jsx (top of the file) — edit it
// there and it applies here too.

// Web Speech occasionally joins short words or drops a letter, especially
// with Indian-English accents. Keep this deliberately conservative so ERP
// names, item codes and customer names are never "corrected" unexpectedly.
const normalizeTranscript = (value = '') => {
    const phraseFixes = [
        [/\bi\s*can\b/gi, 'I can'],
        [/\bi\s*cannot\b/gi, 'I cannot'],
        [/\bi\s*am\b/gi, 'I am'],
        [/\bi\s*will\b/gi, 'I will'],
        [/\bi\s*want\b/gi, 'I want'],
        [/\bhllo\b/gi, 'hello'],
        [/\bhelo\b/gi, 'hello'],
        [/\bplese\b/gi, 'please'],
        [/\bpleas\b/gi, 'please'],
        [/\bshowme\b/gi, 'show me'],
        [/\btellme\b/gi, 'tell me'],
    ];

    let text = String(value).replace(/\s+/g, ' ').trim();
    phraseFixes.forEach(([pattern, replacement]) => { text = text.replace(pattern, replacement); });
    text = text.replace(/\s+([,?.!])/g, '$1').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

// This assistant is English-first. Do not inherit a device/browser locale
// such as hi-IN because speech engines may then transliterate perfectly valid
// English words into another script. en-IN keeps Indian-English pronunciation
// support while still explicitly constraining recognition to English.
const SPEECH_RECOGNITION_LANGUAGE = 'en-IN';

const normalizeAssistantReply = (value = '') => {
    const typoFixes = [
        [/\bhllo\b/gi, 'Hello'],
        [/\bhelo\b/gi, 'Hello'],
        [/\bplese\b/gi, 'please'],
        [/\bpleas\b/gi, 'please'],
        [/\bican\b/gi, 'I can'],
        [/\bicannot\b/gi, 'I cannot'],
        [/\biam\b/gi, 'I am'],
        [/\biwill\b/gi, 'I will'],
        [/\biwant\b/gi, 'I want'],
        [/\bassistyou\b/gi, 'assist you'],
        [/\bshowme\b/gi, 'show me'],
        [/\btellme\b/gi, 'tell me'],
    ];

    // Never rewrite fenced JSON/chart/code payloads.
    return String(value).split(/(```[\s\S]*?```)/g).map((part) => {
        if (part.startsWith('```')) return part;
        let cleaned = part;
        typoFixes.forEach(([pattern, replacement]) => { cleaned = cleaned.replace(pattern, replacement); });
        return cleaned.replace(/[ \t]{2,}/g, ' ');
    }).join('').trim();
};

const getRecognizedText = (result) => {
    const alternatives = Array.from(result || []);
    if (!alternatives.length) return '';

    // Prefer a clean alternative when its confidence is close to the first
    // result. This makes maxAlternatives useful instead of blindly accepting
    // a high-confidence but visibly broken token such as "hllo" or "ican".
    const suspicious = /\b(?:hllo|helo|plese|pleas|ican|icannot|iam|iwill|iwant|showme|tellme)\b/i;
    const best = alternatives.reduce((winner, alternative) => {
        const confidence = Number.isFinite(alternative.confidence) ? alternative.confidence : 0;
        const score = confidence - (suspicious.test(alternative.transcript || '') ? 0.25 : 0);
        return !winner || score > winner.score ? { alternative, score } : winner;
    }, null)?.alternative;

    return normalizeTranscript(best?.transcript || alternatives[0]?.transcript || '');
};

// The API normally returns { reply: string }, but keeping this boundary
// defensive prevents accidental [object Object] or raw response JSON in chat.
const getReplyText = (payload) => {
    const reply = payload?.reply ?? payload?.message ?? payload;
    if (typeof reply === 'string') return normalizeAssistantReply(reply);
    if (reply && typeof reply === 'object') {
        return normalizeAssistantReply(reply.answer ?? reply.text ?? reply.content ?? '');
    }
    return '';
};

// Keep chart payloads out of the voice transcript just as ChatArea does.
// The extracted visualization is rendered separately in the pinned panel.
const VoiceReplyText = ({ text }) => {
    const { cleanText } = getCleanTextAndChart(removeVoiceImagePayload(text));
    return cleanText ? <FormattedMarkdownText text={cleanText} /> : null;
};

const getVoiceImagePayload = (value) => {
    const source = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return source.match(/data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+/i)?.[0] || null;
};

// Voice models sometimes emit `{data:image...}` or a split Markdown image,
// not only the canonical `![alt](data:image...)`. Never expose that payload.
const removeVoiceImagePayload = (value) => String(value || '')
    .replace(/!\[[^\]]*\]\s*[({]\s*data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+\s*[)}]?/gi, '')
    .replace(/[({]?\s*data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+\s*[)}]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const MicIcon = ({ isListening }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke={isListening ? "#ef4444" : "var(--text-color, #0f172a)"}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: 'block', transition: 'stroke 0.2s ease' }}
    >
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
        <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
);

const UploadIcon = ({ isUploading, count }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke={count > 0 || isUploading ? "var(--primary-color, #0284c7)" : "var(--text-muted, #64748b)"}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: 'block', transition: 'stroke 0.2s ease' }}
    >
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 1 1 5.66 5.66l-8.59 8.58a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
);

const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
    </svg>
);

// Small hero mark — a stylised spark/orbit glyph rendered in the active
// theme's primary color. No raster asset, no hardcoded brand palette.
const SparkMarkIcon = ({ size = 22 }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M12 3 L13.6 9.2 20 12 13.6 14.8 12 21 10.4 14.8 4 12 10.4 9.2 Z" fill="var(--primary-color, #6366f1)" />
        <circle cx="12" cy="12" r="10.25" stroke="color-mix(in srgb, var(--primary-color, #6366f1) 55%, transparent)" strokeWidth="1.1" strokeDasharray="1.5 4.5" strokeLinecap="round" />
    </svg>
);

const PaperPlaneIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
    </svg>
);

// Trigger icon for realtime voice mode — a soundwave glyph, visually
// distinct from the plain dictation mic.
const AssistantWaveIcon = ({ active }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15" height="15" viewBox="0 0 24 24" fill="none"
        stroke={active ? "var(--primary-color, #6366f1)" : "var(--text-color, #0f172a)"}
        strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"
        style={{ display: 'block', transition: 'stroke 0.2s ease' }}
    >
        <path d="M5 15V9" />
        <path d="M9 18V6" />
        <path d="M13 21V3" />
        <path d="M17 17V7" />
        <path d="M21 13v-2" />
    </svg>
);

const PhoneEndIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17.92V21a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 3h3.08a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11z" />
        <line x1="22" y1="2" x2="2" y2="22" />
    </svg>
);

// Five-bar equalizer used while the assistant is speaking a reply — a
// staggered height animation stands in for a real audio-amplitude trace
// (the Web Speech Synthesis API does not expose one).
const EqualizerBars = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '30px' }}>
        {[0, 1, 2, 3, 4].map((i) => (
            <motion.span
                key={i}
                animate={{ height: ['22%', '95%', '40%', '75%', '22%'] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.11, ease: 'easeInOut' }}
                style={{ width: '3.5px', borderRadius: '3px', backgroundColor: '#ffffff', display: 'block' }}
            />
        ))}
    </div>
);

// Ambient particle field for Live Voice Mode — a lightweight canvas
// "neural network" drift that speeds up and glows brighter with mic
// level / speaking activity. Colors are read from the active theme's
// --primary-color at runtime (via a hidden color-probe element) so it
// re-themes automatically with every theme switch, and it never blocks
// pointer events on the orb/buttons above it.
const VoiceParticles = ({ status, micLevel }) => {
    const canvasRef = useRef(null);
    const probeRef = useRef(null);
    const statusRef = useRef(status);
    const levelRef = useRef(micLevel);

    useEffect(() => { statusRef.current = status; }, [status]);
    useEffect(() => { levelRef.current = micLevel; }, [micLevel]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const probe = probeRef.current;
        if (!canvas || !probe) return undefined;
        const ctx = canvas.getContext('2d');
        let width = 0, height = 0, dpr = 1, raf = null, alive = true;

        const resize = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            dpr = window.devicePixelRatio || 1;
            width = rect.width;
            height = rect.height;
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener('resize', resize);

        const particles = Array.from({ length: 44 }, () => ({
            x: Math.random(),
            y: Math.random(),
            r: 0.6 + Math.random() * 1.5,
            vx: (Math.random() - 0.5) * 0.00055,
            vy: (Math.random() - 0.5) * 0.00055,
            phase: Math.random() * Math.PI * 2,
            baseOpacity: 0.15 + Math.random() * 0.3,
        }));

        const tick = () => {
            if (!alive) return;
            const computed = getComputedStyle(probe).color;
            const rgb = /^rgba?\(/.test(computed) ? computed.replace(/rgba?\(|\)/g, '') : '99, 102, 241';
            const st = statusRef.current;
            const level = levelRef.current || 0;
            const activity = st === 'listening' ? 0.4 + level * 0.9
                : st === 'speaking' ? 0.85
                    : st === 'thinking' ? 0.55
                        : st === 'connecting' ? 0.3
                            : 0.15;

            ctx.clearRect(0, 0, width, height);

            particles.forEach((p) => {
                p.phase += 0.012 + activity * 0.02;
                p.x += p.vx * (1 + activity * 3);
                p.y += p.vy * (1 + activity * 3);
                if (p.x < 0) p.x += 1; if (p.x > 1) p.x -= 1;
                if (p.y < 0) p.y += 1; if (p.y > 1) p.y -= 1;
                const px = p.x * width;
                const py = p.y * height + Math.sin(p.phase) * 3 * activity;
                const opacity = Math.min(1, p.baseOpacity * (0.6 + activity * 0.9));
                ctx.beginPath();
                ctx.arc(px, py, p.r * (1 + activity * 0.5), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${rgb}, ${opacity})`;
                ctx.fill();
            });

            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const a = particles[i], b = particles[j];
                    const dx = (a.x - b.x) * width, dy = (a.y - b.y) * height;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = 68;
                    if (dist < maxDist) {
                        ctx.beginPath();
                        ctx.moveTo(a.x * width, a.y * height);
                        ctx.lineTo(b.x * width, b.y * height);
                        ctx.strokeStyle = `rgba(${rgb}, ${(1 - dist / maxDist) * 0.09 * (0.4 + activity)})`;
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }

            raf = requestAnimationFrame(tick);
        };
        tick();

        return () => {
            alive = false;
            window.removeEventListener('resize', resize);
            if (raf) cancelAnimationFrame(raf);
        };
    }, []);

    return (
        <>
            <span ref={probeRef} aria-hidden="true" style={{ color: 'var(--primary-color, #6366f1)', position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} />
            <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
        </>
    );
};

// Pulls out any Markdown pipe-table block(s) — `| col | col |` rows — from
// a reply's text so Live Voice Mode's popped-up card can show a table the
// same way ChatArea's chat bubbles do (via FormattedMarkdownText, which is
// what actually knows how to turn those rows into an HTML <table> —
// ChartBlock/getCleanTextAndChart only ever handles pie/line/bar chart
// JSON, never Markdown tables). Returns one Markdown snippet per table
// found, ready to hand straight to <FormattedMarkdownText text={...} />.
function extractMarkdownTables(text) {
    if (!text) return [];
    const lines = String(text).split('\n');
    const tables = [];
    let current = null;
    lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            current = current || [];
            current.push(line);
        } else if (current) {
            tables.push(current.join('\n'));
            current = null;
        }
    });
    if (current) tables.push(current.join('\n'));
    return tables;
}

const FileTypeIcon = ({ fileName }) => {
    const isPdf = /\.pdf$/i.test(fileName || '');
    return (
        <div style={{
            width: '18px', height: '18px', borderRadius: '5px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 22%, transparent)',
        }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color, #6366f1)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                {isPdf
                    ? <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>
                    : <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>}
            </svg>
        </div>
    );
};

// Theme-adaptive premium styling. Every color here is derived from the
// active theme's own CSS variables (--primary-color, --text-color,
// --card-bg, --border-color, --control-bg) via color-mix(), so switching
// theme mode (blue / brown / orange / sky / peach / purple / dark / light)
// restyles this entire shell automatically — nothing is hardcoded to one
// palette, and nothing here uses backdrop-filter / translucent panels.
const MAGNA_PREMIUM_STYLES = `
.magna-shell input::placeholder,
.magna-shell textarea::placeholder { color: var(--text-muted, #94a3b8); opacity: 0.85; }
.magna-shell .magna-input-shell { transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease; }
.magna-shell .magna-input-shell:focus-within {
    border-color: color-mix(in srgb, var(--primary-color, #6366f1) 55%, var(--border-color, #cbd5e1)) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color, #6366f1) 14%, transparent), 0 14px 34px -12px rgba(0, 0, 0, 0.14);
}
.magna-shell .magna-icon-btn { transition: background-color .15s ease, transform .15s ease; }
.magna-shell .magna-icon-btn:hover { background-color: color-mix(in srgb, var(--text-color, #0f172a) 8%, transparent); }
.magna-shell .magna-close-btn { transition: background-color .15s ease, color .15s ease; }
.magna-shell .magna-close-btn:hover { background-color: color-mix(in srgb, #ef4444 12%, transparent); color: #ef4444; }
.magna-shell .magna-mark-ring {
    background: conic-gradient(from 0deg, color-mix(in srgb, var(--primary-color, #6366f1) 95%, transparent), transparent 40%, color-mix(in srgb, var(--primary-color, #6366f1) 95%, transparent) 100%);
    animation: magna-spin 5s linear infinite;
}
.magna-shell .magna-history-item:hover { background-color: color-mix(in srgb, var(--text-color, #0f172a) 5%, transparent) !important; }
.magna-shell .magna-send-btn {
    background: linear-gradient(135deg, var(--primary-color, #6366f1), color-mix(in srgb, var(--primary-color, #6366f1) 60%, black));
    transition: box-shadow .18s ease, transform .12s ease, filter .18s ease;
}
.magna-shell .magna-send-btn:hover:not(:disabled) { filter: brightness(1.06); }
.magna-shell .magna-send-btn:active:not(:disabled) { transform: scale(0.97); }
.magna-shell .magna-hero-dotgrid {
    background-image: radial-gradient(color-mix(in srgb, var(--text-color, #0f172a) 14%, transparent) 1px, transparent 1px);
    background-size: 16px 16px;
    -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 40%, #000 0%, transparent 75%);
    mask-image: radial-gradient(ellipse 70% 70% at 50% 40%, #000 0%, transparent 75%);
}
.magna-shell .magna-scrim-dotgrid {
    background-image: radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1px);
    background-size: 26px 26px;
}
@keyframes magna-spin { to { transform: rotate(360deg); } }
@keyframes magna-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.magna-shell .magna-live-dot { animation: magna-dot-pulse 2s ease-in-out infinite; }
@keyframes magna-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.magna-shell .magna-shimmer-text {
    background: linear-gradient(90deg, var(--card-bg, #fff) 0%, color-mix(in srgb, var(--primary-color, #6366f1) 45%, var(--card-bg, #fff)) 50%, var(--card-bg, #fff) 100%);
    background-size: 200% 100%;
    -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
    animation: magna-shimmer 1.6s linear infinite;
}
.magna-shell .magna-orb-trigger:hover { background-color: color-mix(in srgb, var(--primary-color, #6366f1) 12%, transparent) !important; }
.magna-shell .magna-end-call-btn { transition: filter .15s ease, transform .12s ease; }
.magna-shell .magna-end-call-btn:hover { filter: brightness(1.08); }
.magna-shell .magna-voice-conversation {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-muted, #64748b) 28%, transparent) transparent;
}
.magna-shell .magna-voice-conversation::-webkit-scrollbar { width: 5px; }
.magna-shell .magna-voice-conversation::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--text-muted, #64748b) 28%, transparent);
    border-radius: 999px;
}
@media (max-width: 720px) {
    .magna-shell .magna-voice-stage { padding: 54px 14px 92px !important; }
    .magna-shell .magna-voice-conversation { width: 100% !important; height: 48vh !important; max-height: 48vh !important; }
    .magna-shell .magna-voice-orb-wrap { width: 112px !important; height: 112px !important; }
    .magna-shell .magna-voice-orb { width: 78px !important; height: 78px !important; }
}
`;

export default function AssistantPortal({ isOpen, onClose }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [chatHistory, setChatHistory] = useState([
        {
            id: '1',
            title: 'Database Cluster Optimization',
            messages: [
                { sender: 'user', text: 'Analyze the query performance metrics.' },
                { sender: 'bot', text: 'Telemetry streams connected. Database index configuration optimized successfully.' }
            ]
        }
    ]);
    const [currentChatId, setCurrentChatId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    // Multi-File Management State
    const [selectedFiles, setSelectedFiles] = useState([]);
    const fileInputRef = useRef(null);
    const messageInputRef = useRef(null);

    // ---- Live Voice Mode (realtime seamless voice conversation) ----
    const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false);
    const [voiceStatus, setVoiceStatus] = useState('idle'); // idle | connecting | listening | thinking | speaking | error
    const [voiceConnected, setVoiceConnected] = useState(false);
    const [micPermission, setMicPermission] = useState('prompt'); // prompt | granted | denied
    const [voiceError, setVoiceError] = useState('');
    const [voiceEvents, setVoiceEvents] = useState([]);
    const [liveTranscript, setLiveTranscript] = useState('');
    const [lastReplyText, setLastReplyText] = useState('');
    const [voiceDisplayMessages, setVoiceDisplayMessages] = useState([]);
    const [micLevel, setMicLevel] = useState(0); // 0–1, real mic amplitude while listening
    const [voiceTools, setVoiceTools] = useState([]); // tool_call/tool_result trace for the current voice turn
    const [pinnedChart, setPinnedChart] = useState(null); // { chartData, tables } — popped-up chart and/or table, stays until a new one is created or the user closes it

    const voiceModeOpenRef = useRef(false);
    const voiceSocketRef = useRef(null);
    const voiceSessionIdRef = useRef(null);
    const voiceStatusRef = useRef('idle');
    const streamingReplyRef = useRef('');
    const voiceChatIdRef = useRef(null);
    const voiceConversationEndRef = useRef(null);
    const orbRef = useRef(null);
    const speechRecognitionRef = useRef(null);
    // Web Speech TTS: queue of utterances waiting to be spoken
    const ttsQueueRef = useRef([]);
    const ttsSpeakingRef = useRef(false);
    const ttsInterruptedRef = useRef(false);

    const activeChat = chatHistory.find(c => c.id === currentChatId);
    const activeMessages = activeChat ? activeChat.messages : messages;

    const resizeMessageInput = (element) => {
        if (!element) return;
        element.style.height = 'auto';
        element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
        element.style.overflowY = element.scrollHeight > 140 ? 'auto' : 'hidden';
    };

    const handleMessageKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
            event.preventDefault();
            handleSend();
        }
    };

    useEffect(() => {
        resizeMessageInput(messageInputRef.current);
    }, [input, currentChatId]);

    // WebRTC Direct-to-OpenAI voice session hook
    // Handles: token lifecycle, SDP exchange, tool interception → backend execution
    const { status: webRtcStatus, transcript: webRtcTranscript, start: startVoice, stop: stopVoice } = useVoiceSession({
        sessionId: currentChatId || 'default',
        userId: null,
        apiBase: API_BASE_URL,
        onMessage: (text) => {
            // When AI finishes a voice response, show it in chat
            if (text && currentChatId) {
                appendMessage(currentChatId, { sender: 'bot', text, tools: [] });
            }
        },
        onError: (msg, err) => {
            console.error('[Voice]', msg, err);
            alert(`Voice error: ${msg}`);
            setIsListening(false);
        },
    });

    const handleVoiceInput = () => {
        if (webRtcStatus === 'active' || webRtcStatus === 'connecting' || webRtcStatus === 'tool_calling') {
            stopVoice();
            setIsListening(false);
        } else {
            setIsListening(true);
            startVoice();
        }
    };

    const appendMessage = (chatId, message) => {
        setChatHistory((prev) => {
            const idx = prev.findIndex((c) => c.id === chatId);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], messages: [...next[idx].messages, message] };
            return next;
        });
    };

    // Mutates the trailing bot placeholder in place — used while a
    // /api/chat/stream turn is landing token/tool_call/tool_result events,
    // so the bubble fills in live instead of popping in once at the end.
    const updateLastBotMessage = (chatId, updater) => {
        setChatHistory((prev) => {
            const idx = prev.findIndex((c) => c.id === chatId);
            if (idx === -1) return prev;
            const msgs = prev[idx].messages;
            const lastIdx = msgs.length - 1;
            if (lastIdx < 0 || msgs[lastIdx].sender !== 'bot') return prev;
            const nextMsgs = [...msgs];
            nextMsgs[lastIdx] = updater(nextMsgs[lastIdx]);
            const next = [...prev];
            next[idx] = { ...next[idx], messages: nextMsgs };
            return next;
        });
    };

    // Streams a turn from /api/chat/stream (SSE: token / tool_call /
    // tool_result / done / error — same event shape magma_voice.py's
    // _ws_receiver renders for the CLI) and grows a single bot bubble live,
    // showing each tool the agent reaches for exactly as it's called.
    const streamAssistantTurn = async (chatId, userPrompt) => {
        appendMessage(chatId, { sender: 'bot', text: '', tools: [], streaming: true, streamed: true });

        const controller = new AbortController();
        let inactivityTimer;
        let completed = false;
        const resetInactivityTimer = () => {
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => controller.abort('The assistant stream timed out.'), 120000);
        };
        resetInactivityTimer();

        try {
            const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userPrompt, session_id: chatId }),
                signal: controller.signal,
            });

            if (!response.ok || !response.body) {
                throw new Error(`Agent responded with status ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            streamLoop: while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                resetInactivityTimer();
                buffer += decoder.decode(value, { stream: true });

                const parts = buffer.split(/\r?\n\r?\n/);
                buffer = parts.pop() || '';

                for (const part of parts) {
                    const line = part.trim();
                    if (!line.startsWith('data:')) continue;
                    const payload = line.slice(5).trim();
                    if (!payload) continue;
                    if (payload === '[DONE]') {
                        completed = true;
                        break streamLoop;
                    }

                    let event;
                    try { event = JSON.parse(payload); } catch { continue; }

                    if (event.type === 'token') {
                        updateLastBotMessage(chatId, (msg) => ({ ...msg, text: (msg.text || '') + (event.text || '') }));
                    } else if (event.type === 'tool_call') {
                        updateLastBotMessage(chatId, (msg) => ({
                            ...msg,
                            tools: [...(msg.tools || []), { name: event.name, args: event.args || {}, status: 'running', result: null }],
                        }));
                    } else if (event.type === 'tool_result') {
                        updateLastBotMessage(chatId, (msg) => {
                            const tools = [...(msg.tools || [])];
                            for (let i = tools.length - 1; i >= 0; i--) {
                                if (tools[i].name === event.name && tools[i].status === 'running') {
                                    tools[i] = { ...tools[i], status: 'done', result: event.result };
                                    break;
                                }
                            }
                            return { ...msg, tools };
                        });
                    } else if (event.type === 'done') {
                        updateLastBotMessage(chatId, (msg) => ({
                            ...msg,
                            text: msg.text || (event.text ?? event.content ?? ''),
                            streaming: false,
                        }));
                        completed = true;
                        break streamLoop;
                    } else if (event.type === 'error') {
                        updateLastBotMessage(chatId, (msg) => ({
                            ...msg,
                            text: msg.text || `❌ ${event.message || 'The assistant reported an error.'}`,
                            streaming: false,
                        }));
                        completed = true;
                        break streamLoop;
                    }
                }
            }

            if (completed) await reader.cancel().catch(() => { });
            updateLastBotMessage(chatId, (msg) => ({ ...msg, streaming: false }));
        } catch (err) {
            console.error('Streaming Execution Error:', err);
            updateLastBotMessage(chatId, (msg) => ({
                ...msg,
                text: msg.text || (err?.name === 'AbortError'
                    ? '❌ The assistant took too long to respond. You can send another query now.'
                    : '❌ Request processing encountered an issue. Please verify backend state.'),
                streaming: false,
            }));
        } finally {
            clearTimeout(inactivityTimer);
        }
    };

    const handleFileSelect = (event) => {
        const newFiles = Array.from(event.target.files || []);
        if (newFiles.length === 0) return;

        setSelectedFiles(prev => [...prev, ...newFiles]);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleRemoveFile = (indexToRemove) => {
        setSelectedFiles(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const handleSend = async (textToSend) => {
        const userPrompt = textToSend || input;
        const attachedFiles = [...selectedFiles];

        if ((!userPrompt.trim() && attachedFiles.length === 0) || isSending) return;

        let activeId = currentChatId;

        if (!activeId) {
            activeId = Date.now().toString();
            const sessionTitle = attachedFiles.length > 0
                ? `Documents (${attachedFiles.length}): ${attachedFiles[0].name}`
                : userPrompt.substring(0, 30) + (userPrompt.length > 30 ? '...' : '');

            const newChatSession = { id: activeId, title: sessionTitle, messages: [] };
            setChatHistory((prev) => [newChatSession, ...prev]);
            setCurrentChatId(activeId);
        }

        setInput('');
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setIsSending(true);

        try {
            if (attachedFiles.length > 0) {
                const filesListText = attachedFiles.map(f => `• 📄 **${f.name}**`).join('\n');
                const fileMsgText = userPrompt.trim()
                    ? `📎 **Attached Files (${attachedFiles.length})**:\n${filesListText}\n\n💬 ${userPrompt}`
                    : `📎 **Uploading Documents (${attachedFiles.length})**:\n${filesListText}`;

                appendMessage(activeId, { sender: 'user', text: fileMsgText });
                setIsUploading(true);

                for (let i = 0; i < attachedFiles.length; i++) {
                    const file = attachedFiles[i];
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('session_id', activeId);

                    const res = await fetch(`${API_BASE_URL}/api/upload-document`, {
                        method: 'POST',
                        body: formData,
                    });

                    if (!res.ok) throw new Error(`Document processing failed for ${file.name}`);

                    const ocrResult = await res.json();

                    appendMessage(activeId, {
                        sender: 'bot',
                        text: `✅ **Document ready (${i + 1}/${attachedFiles.length})**: ${file.name}\n\n${ocrResult.message || 'Its content is available for questions and requested DocType actions.'}`
                    });
                }

                // Uploading is ingestion only. Send the user's real prompt once
                // after every file is in the same session; never manufacture a
                // Purchase Order instruction from an attachment.
                if (userPrompt.trim()) {
                    await streamAssistantTurn(activeId, userPrompt);
                }
            } else {
                appendMessage(activeId, { sender: 'user', text: userPrompt });
                await streamAssistantTurn(activeId, userPrompt);
            }
        } catch (err) {
            console.error('Execution Error:', err);
            appendMessage(activeId, {
                sender: 'bot',
                text: "❌ Request processing encountered an issue. Please verify backend state.",
            });
        } finally {
            setIsUploading(false);
            setIsSending(false);
        }
    };

    // ---- Web Speech TTS helpers ----

    // Pick the best available en-IN or en-GB voice from speechSynthesis.
    // Falls back to any English voice, then the browser default.
    const pickTtsVoice = () => {
        const voices = window.speechSynthesis?.getVoices() || [];
        return (
            voices.find(v => v.lang === 'en-IN') ||
            voices.find(v => v.lang === 'en-GB') ||
            voices.find(v => v.lang.startsWith('en')) ||
            null
        );
    };

    // Drain the TTS sentence queue — called after each utterance ends.
    const drainTtsQueue = () => {
        if (ttsInterruptedRef.current) { ttsQueueRef.current = []; ttsSpeakingRef.current = false; return; }
        if (ttsQueueRef.current.length === 0) {
            ttsSpeakingRef.current = false;
            // All speech done — return orb to listening state
            if (voiceModeOpenRef.current) setVoiceStatus('listening');
            return;
        }
        const text = ttsQueueRef.current.shift();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-IN';
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        const voice = pickTtsVoice();
        if (voice) utterance.voice = voice;
        utterance.onstart = () => {
            setVoiceStatus('speaking');
            console.log('[MAGMA VOICE] TTS speaking:', text.slice(0, 80));
        };
        utterance.onend = () => { drainTtsQueue(); };
        utterance.onerror = (e) => {
            console.error('[MAGMA VOICE] TTS error:', e.error);
            drainTtsQueue();
        };
        ttsSpeakingRef.current = true;
        window.speechSynthesis.speak(utterance);
    };

    // Queue a sentence for low-latency streaming speech.
    const speakSentence = (text) => {
        const clean = (text || '').trim();
        if (!clean) return;
        ttsInterruptedRef.current = false;
        ttsQueueRef.current.push(clean);
        if (!ttsSpeakingRef.current) drainTtsQueue();
    };

    // ---- Mic level analyser (kept for the orb animation) ----

    const addVoiceEvent = (type, detail = '') => {
        setVoiceEvents((events) => [...events.slice(-5), { type, detail: String(detail || '') }]);
    };

    const createVoiceChat = () => {
        if (voiceChatIdRef.current) return voiceChatIdRef.current;
        const id = currentChatId || `voice-${Date.now()}`;
        if (!currentChatId) {
            setChatHistory((prev) => [{ id, title: 'Live voice session', messages: [] }, ...prev]);
            setCurrentChatId(id);
        }
        voiceChatIdRef.current = id;
        return id;
    };


    // Stops whatever the assistant is currently saying — used on manual tap,
    // a server-sent 'interrupted' event, client-side barge-in detection, and
    // every "this session is going away" exit path below (closing the
    // portal, switching chats, unmounting). Closing the AudioContext outright
    // (rather than just clearing a queue) guarantees every already-scheduled
    const interruptSpeech = () => {
        console.log('[MAGMA VOICE] interruptSpeech');
        ttsInterruptedRef.current = true;
        ttsSpeakingRef.current = false;
        ttsQueueRef.current = [];
        window.speechSynthesis?.cancel();
        streamingReplyRef.current = '';
        if (voiceModeOpenRef.current && voiceSocketRef.current?.readyState === WebSocket.OPEN) {
            setVoiceStatus('listening');
        }
    };

    const stopMicAnalyser = () => {
        setMicLevel(0);
    };

    // ----------------------------------------------------------------
    // Pure Web Speech API Voice Implementation
    // No getUserMedia is used, as it conflicts with SpeechRecognition on some OS.
    // Barge-in is triggered instantly by STT interim results.
    // ----------------------------------------------------------------

    const handleVoiceEvent = (event) => {
        const type = event.type;
        const text = event.text ?? event.transcript ?? event.token ?? event.delta ?? event.message ?? event.response ?? '';
        if (type === 'token') {
            console.debug(`[MAGMA VOICE] event:token (+${text.length} chars)`);
        } else {
            console.log(`[MAGMA VOICE] event:${type}`, event);
        }
        addVoiceEvent(type, text || event.name || event.tool_name || '');

        if (type === 'partial_transcript') {
            setLiveTranscript(text);
            setVoiceStatus('listening');
            
            // Barge-in: STT heard you speak while TTS is playing!
            if (ttsSpeakingRef.current) {
                console.log('[MAGMA VOICE] Barge-in via STT interim!');
                interruptSpeech();
                voiceSocketRef.current?.send(JSON.stringify({ type: 'interrupt' }));
            }

        } else if (type === 'final_transcript') {
            setLiveTranscript(text);
            if (text) {
                const chatId = createVoiceChat();
                appendMessage(chatId, { sender: 'user', text, voiceOrigin: true });
                appendMessage(chatId, { sender: 'bot', text: '', tools: [], streaming: true, streamed: true });
            }
            setVoiceTools([]);
            setVoiceStatus('thinking');
            streamingReplyRef.current = '';

        } else if (type === 'token') {
            streamingReplyRef.current += text;
            setLastReplyText(streamingReplyRef.current);
            setVoiceStatus('speaking');
            if (voiceChatIdRef.current) {
                updateLastBotMessage(voiceChatIdRef.current, (msg) => ({ ...msg, text: streamingReplyRef.current }));
            }

        } else if (type === 'voice_sentence') {
            // Server sent a clean, speech-ready sentence — speak it now
            speakSentence(text);

        } else if (type === 'tool_call') {
            const toolObj = { name: event.name || event.tool_name, args: event.args || {}, status: 'running', result: null };
            setVoiceTools((prev) => [...prev, toolObj]);
            setVoiceStatus('thinking');
            if (voiceChatIdRef.current) {
                updateLastBotMessage(voiceChatIdRef.current, (msg) => ({
                    ...msg,
                    tools: [...(msg.tools || []), toolObj]
                }));
            }

        } else if (type === 'tool_result') {
            setVoiceTools((prev) => {
                const next = [...prev];
                for (let i = next.length - 1; i >= 0; i--) {
                    if (next[i].name === (event.name || event.tool_name) && next[i].status === 'running') {
                        next[i] = { ...next[i], status: 'done', result: event.result };
                        break;
                    }
                }
                return next;
            });
            setVoiceStatus('thinking');
            if (voiceChatIdRef.current) {
                updateLastBotMessage(voiceChatIdRef.current, (msg) => {
                    const tools = [...(msg.tools || [])];
                    for (let i = tools.length - 1; i >= 0; i--) {
                        if (tools[i].name === (event.name || event.tool_name) && tools[i].status === 'running') {
                            tools[i] = { ...tools[i], status: 'done', result: event.result };
                            break;
                        }
                    }
                    return { ...msg, tools };
                });
            }

        } else if (type === 'interrupted') {
            interruptSpeech();
            if (voiceChatIdRef.current) {
                updateLastBotMessage(voiceChatIdRef.current, (msg) => ({
                    ...msg,
                    streaming: false,
                    text: msg.text ? msg.text : '[Turn cancelled]'
                }));
            }

        } else if (type === 'done') {
            const reply = streamingReplyRef.current;
            setLastReplyText(reply);
            const { cleanText, chartData } = getCleanTextAndChart(reply);
            const tables = extractMarkdownTables(cleanText);
            if (chartData || tables.length) setPinnedChart({ chartData, tables });
            streamingReplyRef.current = '';
            // Status will be set to 'listening' when the TTS queue drains
            if (voiceChatIdRef.current) {
                updateLastBotMessage(voiceChatIdRef.current, (msg) => ({ ...msg, streaming: false }));
            }

        } else if (type === 'error') {
            setVoiceError(text || data.message || 'The voice server reported an error.');
            setVoiceStatus('error');
        }
    };

    const connectVoice = async () => {
        if (voiceModeOpenRef.current && voiceConnected) return;

        // ----------------------------------------------------------------
        // 1. Start SpeechRecognition IMMEDIATELY synchronously.
        // If we await anything before this, the browser will lose the "user gesture"
        // and silently block the microphone permission prompt for STT!
        // ----------------------------------------------------------------
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            if (speechRecognitionRef.current) {
                try { speechRecognitionRef.current.stop(); } catch(e){}
            }
            
            const recognition = new SpeechRecognition();
            recognition.lang = SPEECH_RECOGNITION_LANGUAGE;
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.maxAlternatives = 3;

            recognition.onresult = (event) => {
                let interim = '';
                let final = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                if (interim) {
                    const cleanInterim = interim.trim();
                    if (cleanInterim) {
                        handleVoiceEvent({ type: 'partial_transcript', text: interim });
                        // Barge-in Heuristic: Ignore tiny breathing artifacts < 3 characters
                        if (ttsSpeakingRef.current && cleanInterim.length > 2) {
                            console.log('[MAGMA VOICE] Barge-in via STT interim!', cleanInterim);
                            interruptSpeech();
                            voiceSocketRef.current?.send(JSON.stringify({ type: 'interrupt' }));
                        }
                    }
                }
                if (final) {
                    const cleanText = getRecognizedText([{ transcript: final, confidence: 1 }]);
                    
                    // Final STT Heuristic: Ignore pure punctuation/noise artifacts (breathing/fans)
                    const isNoiseArtifact = !cleanText || cleanText.trim().length <= 1 || /^[^a-zA-Z0-9]+$/.test(cleanText.trim());
                    if (isNoiseArtifact) {
                        console.log('[MAGMA VOICE] Ignored noise/breathing artifact:', final);
                        return;
                    }
                    
                    if (!voiceSocketRef.current || voiceSocketRef.current.readyState !== WebSocket.OPEN) {
                        console.warn('[MAGMA VOICE] Dropping transcript because WebSocket is not open yet.');
                        return;
                    }
                    console.log('[MAGMA VOICE] STT final transcript:', cleanText);

                    // 1. Cancel the OLD bot message locally if we are barging in
                    if (voiceStatusRef.current === 'speaking' || voiceStatusRef.current === 'thinking') {
                        interruptSpeech();
                        if (voiceChatIdRef.current) {
                            updateLastBotMessage(voiceChatIdRef.current, (msg) => ({
                                ...msg,
                                streaming: false,
                                text: msg.text ? msg.text : '[Turn cancelled]'
                            }));
                        }
                    }

                    // 2. handleVoiceEvent adds the NEW user text + NEW bot placeholder to the UI
                    handleVoiceEvent({ type: 'final_transcript', text: cleanText });
                    
                    // 3. Send the transcript to the server (which cleanly cancels the server's old task automatically)
                    voiceSocketRef.current.send(JSON.stringify({ type: 'user_speech', text: cleanText }));
                }
            };

            recognition.onaudiostart = () => setMicLevel(0.4);
            recognition.onsoundstart = () => setMicLevel(0.7);
            recognition.onspeechstart = () => setMicLevel(1.0);
            recognition.onspeechend = () => setMicLevel(0.4);
            recognition.onsoundend = () => setMicLevel(0.1);
            recognition.onaudioend = () => setMicLevel(0);

            recognition.onerror = (e) => {
                console.warn('[MAGMA VOICE] SpeechRecognition error:', e.error);
                if (e.error !== 'no-speech' && e.error !== 'aborted') {
                    setVoiceError('Speech recognition error: ' + e.error);
                }
            };

            recognition.onend = () => {
                if (voiceModeOpenRef.current && speechRecognitionRef.current) {
                    try { speechRecognitionRef.current.start(); } catch(e) { console.warn('[MAGMA VOICE] restart failed:', e); }
                }
            };

            speechRecognitionRef.current = recognition;
            try {
                recognition.start();
                setMicPermission('granted');
            } catch(e) {
                console.warn('[MAGMA VOICE] Synchronous STT start failed:', e);
            }
        } else {
            setVoiceError('Dictation is not supported in this browser.');
        }

        // ----------------------------------------------------------------
        // 2. Preload voices (async)
        // ----------------------------------------------------------------
        if (window.speechSynthesis && window.speechSynthesis.getVoices().length === 0) {
            await new Promise(resolve => {
                window.speechSynthesis.onvoiceschanged = resolve;
                setTimeout(resolve, 1000); 
            });
        }

        const sessionId = voiceSessionIdRef.current || (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        voiceSessionIdRef.current = sessionId;
        createVoiceChat();

        const voiceParams = new URLSearchParams({ session_id: sessionId });
        const hostUrl = API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://') || `ws://${window.location.host || 'localhost:8050'}`;
        const socket = new WebSocket(`${hostUrl}/ws/voice?${voiceParams.toString()}`);
        voiceSocketRef.current = socket;
        
        socket.onopen = () => {
            console.log('[MAGMA VOICE] WebSocket OPEN:', socket.url);
            setVoiceConnected(true);
            setVoiceStatus('listening');
            addVoiceEvent('connected', sessionId);
            if (speechRecognitionRef.current) {
                try { speechRecognitionRef.current.start(); } catch(e) { console.warn('[MAGMA VOICE] SpeechRecognition.start() failed:', e); }
            }
        };

        socket.onmessage = (message) => {
            // No binary frames expected — server sends only JSON text events now
            if (typeof message.data !== 'string') {
                console.warn('[MAGMA VOICE] Unexpected binary frame ignored, size:', message.data?.byteLength);
                return;
            }
            try {
                const parsed = JSON.parse(message.data);
                handleVoiceEvent(parsed);
            } catch (error) {
                console.error('[MAGMA VOICE] JSON parse ERROR:', message.data, error);
                addVoiceEvent('error', 'Invalid JSON event');
            }
        };

        socket.onerror = (err) => {
            console.error('[MAGMA VOICE] WebSocket ERROR:', err);
            setVoiceError('Could not connect to the voice service.');
            setVoiceStatus('error');
        };

        socket.onclose = (evt) => {
            console.log(`[MAGMA VOICE] WebSocket CLOSED: code=${evt.code} reason="${evt.reason}" wasClean=${evt.wasClean}`);
            setVoiceConnected(false);
            if (voiceSocketRef.current === socket) voiceSocketRef.current = null;
            if (voiceModeOpenRef.current) setVoiceStatus('idle');
            addVoiceEvent('disconnected');
        };
    };

    const disconnectVoice = () => {
        stopMicAnalyser();
        if (speechRecognitionRef.current) {
            try { speechRecognitionRef.current.stop(); } catch(e){}
            speechRecognitionRef.current = null;
        }
        ttsInterruptedRef.current = true;
        ttsQueueRef.current = [];
        ttsSpeakingRef.current = false;
        window.speechSynthesis?.cancel();
        
        // Clean up any hanging thinking state before disconnecting
        if (voiceChatIdRef.current) {
            updateLastBotMessage(voiceChatIdRef.current, (msg) => ({
                ...msg,
                streaming: false,
                text: msg.text ? msg.text : '[Turn cancelled]'
            }));
        }
        
        const socket = voiceSocketRef.current;
        voiceSocketRef.current = null;
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'User disconnected');
        setVoiceConnected(false);
        setVoiceStatus('idle');
    };
const openVoiceMode = () => {
        if (voiceModeOpenRef.current) return;
        voiceModeOpenRef.current = true;
        setIsVoiceModeOpen(true);
        setLastReplyText('');
        setLiveTranscript('');
        setVoiceDisplayMessages(activeMessages.map((message) => ({ ...message })));
        setVoiceEvents([]);
        setVoiceTools([]);
        setPinnedChart(null);
        // This is called directly from the assistant-button click, so browser
        // microphone and AudioContext permission prompts are gesture-safe.
        connectVoice();
    };

    const closeVoiceMode = () => {
        voiceModeOpenRef.current = false;
        setIsVoiceModeOpen(false);
        setVoiceStatus('idle');
        setLiveTranscript('');
        setVoiceTools([]);
        setPinnedChart(null);
        disconnectVoice();
        voiceChatIdRef.current = null;
    };

    const handleOrbTap = () => {
        if (voiceStatus === 'speaking') {
            interruptSpeech();
            addVoiceEvent('interrupted', 'manual');
        } else if (!voiceConnected) {
            connectVoice();
        }
    };

    useEffect(() => {
        voiceStatusRef.current = voiceStatus;
    }, [voiceStatus]);

    useEffect(() => {
        if (isVoiceModeOpen) {
            setTimeout(() => {
                if (!orbRef.current && document.getElementById('orb-canvas')) {
                    orbRef.current = new OrbController();
                    orbRef.current.setState(voiceStatusRef.current || 'idle');
                }
            }, 100);
        } else {
            if (orbRef.current) {
                orbRef.current.destroy();
                orbRef.current = null;
            }
        }
    }, [isVoiceModeOpen]);

    useEffect(() => {
        if (orbRef.current) {
            orbRef.current.setState(voiceStatus);
        }
    }, [voiceStatus]);


    // Keep the newest spoken/streamed line visible without moving the orb or
    // controls. This also follows token-by-token assistant replies.
    useEffect(() => {
        if (!isVoiceModeOpen) return;
        voiceConversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [isVoiceModeOpen, voiceDisplayMessages.length, liveTranscript, lastReplyText]);

    useEffect(() => {
        if (!isOpen && voiceModeOpenRef.current) closeVoiceMode();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Switching chats (new chat, picking a different session) should never
    // leave the assistant talking over the thread you just left.
    useEffect(() => {
        if (voiceModeOpenRef.current) {
            interruptSpeech();
            addVoiceEvent('interrupted', 'switched chat');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentChatId]);

    useEffect(() => {
        return () => { if (voiceModeOpenRef.current) closeVoiceMode(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!isOpen) return null;

    const activeSessionLabel = activeChat ? activeChat.title : 'New session';

    const voiceStatusLabel = {
        idle: 'Tap Connect to start',
        connecting: 'Connecting…',
        listening: 'Listening…',
        thinking: 'Thinking…',
        speaking: 'Speaking…',
        error: 'Voice connection error',
    }[voiceStatus];

    // Animated File Badges Component
    const RenderFileBadges = () => {
        if (selectedFiles.length === 0) return null;
        return (
            <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '6px',
                padding: '6px 8px', marginBottom: '4px',
                maxHeight: '80px', overflowY: 'auto'
            }}>
                {selectedFiles.map((file, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: [0.85, 1, 0.85], scale: [0.99, 1.01, 0.99] }}
                        transition={{
                            duration: 1.8,
                            repeat: Infinity,
                            ease: 'easeInOut'
                        }}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '7px',
                            padding: '4px 10px 4px 5px', borderRadius: '9px',
                            backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 10%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--primary-color, #6366f1) 32%, transparent)',
                            boxShadow: '0 0 10px color-mix(in srgb, var(--primary-color, #6366f1) 16%, transparent)',
                            color: 'var(--text-color, #0f172a)', fontSize: '11.5px',
                            fontWeight: '600'
                        }}
                    >
                        <FileTypeIcon fileName={file.name} />
                        <span>{file.name.length > 22 ? file.name.substring(0, 20) + '...' : file.name}</span>
                        <button
                            onClick={() => handleRemoveFile(idx)}
                            style={{
                                border: 'none', background: 'none', cursor: 'pointer',
                                color: '#ef4444', padding: '0 2px', fontSize: '12px',
                                fontWeight: '700', lineHeight: 1
                            }}
                            title="Remove file"
                        >
                            ✕
                        </button>
                    </motion.div>
                ))}
            </div>
        );
    };

    // Reusable trigger button for Live Voice Mode — sits next to Mic.
    const VoiceModeTrigger = ({ size = 28 }) => (
        <motion.button
            className="magna-icon-btn magna-orb-trigger"
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            onClick={openVoiceMode}
            style={{
                background: 'transparent', border: 'none', borderRadius: '8px',
                width: `${size}px`, height: `${size}px`, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
            }}
            title="Live voice conversation"
        >
            <AssistantWaveIcon />
        </motion.button>
    );

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="magna-shell"
                style={{
                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000000, overflow: 'hidden',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
                    background: 'radial-gradient(ellipse at center, rgba(15, 23, 42, 0.55) 0%, rgba(8, 11, 21, 0.82) 100%)'
                }}
            >
                <style>{MAGNA_PREMIUM_STYLES}</style>

                {/* Decorative dot-grid on the scrim — solid, sharp, no blur */}
                <div className="magna-scrim-dotgrid" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }} />

                <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept="image/*,application/pdf"
                    multiple
                    onChange={handleFileSelect}
                />

                {/* Main Panel */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 15 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 28, mass: 0.8 }}
                    style={{
                        width: '94vw', height: '90vh',
                        backgroundColor: 'var(--card-bg, #ffffff)',
                        border: '1px solid var(--border-color, rgba(148, 163, 184, 0.15))',
                        borderRadius: '26px',
                        boxShadow: '0 50px 90px -22px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.07), 0 0 0 1px color-mix(in srgb, var(--primary-color, #6366f1) 8%, transparent)',
                        display: 'flex', overflow: 'hidden', zIndex: 1
                    }}
                >
                    <Sidebar
                        chatHistory={chatHistory}
                        currentChatId={currentChatId}
                        onSelectChat={setCurrentChatId}
                        onNewChat={() => { setCurrentChatId(null); setMessages([]); setInput(''); setSelectedFiles([]); }}
                        isCollapsed={isCollapsed}
                        setIsCollapsed={setIsCollapsed}
                    />

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--card-bg, #ffffff)' }}>
                        {/* Header */}
                        <div style={{
                            height: '66px', position: 'relative',
                            borderBottom: '1px solid var(--border-color, rgba(148, 163, 184, 0.15))',
                            padding: '0 20px 0 24px', display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: 'var(--card-bg, #ffffff)'
                        }}>
                            {/* subtle brand seam under the header */}
                            <div style={{
                                position: 'absolute', left: 0, right: 0, bottom: '-1px', height: '1px',
                                background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--primary-color, #6366f1) 45%, transparent) 50%, transparent)'
                            }} />

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div className="magna-mark-ring" style={{ width: '30px', height: '30px', borderRadius: '50%', padding: '2px', flexShrink: 0 }}>
                                    <div style={{
                                        width: '100%', height: '100%', borderRadius: '50%',
                                        backgroundColor: 'var(--card-bg, #ffffff)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}>
                                        <SparkMarkIcon />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', lineHeight: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                        <span style={{ fontSize: '13.5px', fontWeight: '750', color: 'var(--text-color, #0f172a)', letterSpacing: '-0.2px' }}>
                                            Magna Assistant
                                        </span>
                                        <span style={{
                                            fontSize: '8.5px', fontWeight: '750', letterSpacing: '0.04em',
                                            padding: '1.5px 6px', borderRadius: '5px',
                                            color: 'var(--primary-color, #6366f1)',
                                            backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 14%, transparent)'
                                        }}>
                                            AI
                                        </span>
                                    </div>
                                    <span style={{
                                        fontSize: '9px', fontWeight: '600', letterSpacing: '0.09em', textTransform: 'uppercase',
                                        color: 'var(--text-muted, #64748b)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
                                    }}>
                                        Autonomous Agent
                                    </span>
                                </div>
                            </div>

                            {/* Center: current session breadcrumb */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '5px 13px', borderRadius: '999px',
                                border: '1px solid var(--border-color, rgba(148, 163, 184, 0.18))',
                                maxWidth: '320px'
                            }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted, #64748b)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                                <span style={{
                                    fontSize: '11px', fontWeight: '600', color: 'var(--text-muted, #64748b)',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                }}>
                                    {activeSessionLabel}
                                </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '5px 11px', borderRadius: '999px',
                                    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.2))',
                                    backgroundColor: 'color-mix(in srgb, #22c55e 8%, transparent)'
                                }}>
                                    <span className="magna-live-dot" style={{
                                        width: '6px', height: '6px', borderRadius: '50%',
                                        backgroundColor: '#22c55e', boxShadow: '0 0 6px #22c55e'
                                    }} />
                                    <span style={{ fontSize: '10.5px', fontWeight: '650', color: 'var(--text-color, #0f172a)' }}>
                                        Online
                                    </span>
                                </div>
                                <motion.button
                                    className="magna-close-btn"
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={onClose}
                                    style={{
                                        border: 'none', background: 'transparent', color: 'var(--text-muted, #64748b)',
                                        width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                >
                                    <CloseIcon />
                                </motion.button>
                            </div>
                        </div>

                        {/* Interactive Workspace Area */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--card-bg, #ffffff)', position: 'relative' }}>
                            <AnimatePresence mode="wait">
                                {activeMessages.length === 0 ? (
                                    <motion.div
                                        key="welcome"
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -8 }}
                                        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '32px 24px', overflowY: 'auto', position: 'relative' }}
                                    >
                                        {/* decorative dot-grid behind hero copy */}
                                        <div className="magna-hero-dotgrid" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '340px', pointerEvents: 'none', zIndex: 0 }} />

                                        <div style={{ textAlign: 'center', marginBottom: '28px', position: 'relative', zIndex: 1 }}>
                                            <div style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '7px',
                                                marginBottom: '18px', padding: '5px 13px', borderRadius: '999px',
                                                border: '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
                                                backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 7%, transparent)'
                                            }}>
                                                <span className="magna-live-dot" style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--primary-color, #6366f1)' }} />
                                                <span style={{
                                                    fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase',
                                                    color: 'var(--primary-color, #6366f1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
                                                }}>
                                                    Magna Autonomous Agent
                                                </span>
                                            </div>

                                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
                                                <SparkMarkIcon />
                                            </div>

                                            <h1 style={{
                                                fontSize: '36px', fontWeight: '850', margin: '0 0 10px 0',
                                                letterSpacing: '-1.3px', lineHeight: '1.15',
                                                color: 'var(--text-color, #0f172a)'
                                            }}>
                                                Design with <span style={{ color: 'var(--primary-color, #6366f1)' }}>absolute intelligence.</span>
                                            </h1>
                                            <p style={{ fontSize: '13.5px', color: 'var(--text-muted, #64748b)', margin: 0, fontWeight: '450' }}>
                                                Execute runtime tasks, configure workflows or stream active database modules.
                                            </p>
                                        </div>

                                        {/* Seamless Input Bar */}
                                        <div className="magna-input-shell" style={{
                                            width: '100%', maxWidth: '640px',
                                            borderRadius: '18px', padding: '9px 12px',
                                            display: 'flex', flexDirection: 'column',
                                            marginBottom: '10px', position: 'relative', zIndex: 1,
                                            backgroundColor: 'var(--control-bg, var(--card-bg, #f8fafc))',
                                            border: '1px solid var(--border-color, rgba(148, 163, 184, 0.2))',
                                            boxShadow: '0 16px 36px -14px rgba(0, 0, 0, 0.1)',
                                            boxSizing: 'border-box'
                                        }}>
                                            <RenderFileBadges />

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                                                <motion.button
                                                    className="magna-icon-btn"
                                                    whileHover={{ scale: 1.06 }}
                                                    whileTap={{ scale: 0.94 }}
                                                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                                                    disabled={isUploading}
                                                    style={{
                                                        background: 'transparent', border: 'none', borderRadius: '8px',
                                                        width: '28px', height: '28px', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexShrink: 0
                                                    }}
                                                    title="Upload PO Documents (PDF / Images)"
                                                >
                                                    <UploadIcon isUploading={isUploading} count={selectedFiles.length} />
                                                </motion.button>

                                                <textarea
                                                    ref={messageInputRef}
                                                    rows={1}
                                                    placeholder={selectedFiles.length > 0 ? `Add prompt for ${selectedFiles.length} file(s) or press Execute...` : "Ask Magna or attach PO documents..."}
                                                    value={input}
                                                    onChange={(e) => {
                                                        setInput(e.target.value);
                                                        resizeMessageInput(e.target);
                                                    }}
                                                    onKeyDown={handleMessageKeyDown}
                                                    style={{
                                                        flex: 1, background: 'none', border: 'none', outline: 'none',
                                                        minWidth: 0, minHeight: '28px', maxHeight: '140px', padding: '4px 0',
                                                        resize: 'none', overflowY: 'hidden', boxSizing: 'border-box',
                                                        fontFamily: 'inherit', fontSize: '13.5px', lineHeight: '20px',
                                                        color: 'var(--text-color, #0f172a)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'
                                                    }}
                                                />

                                                <div style={{ width: '1px', height: '18px', backgroundColor: 'var(--border-color, rgba(148, 163, 184, 0.3))', flexShrink: 0 }} />

                                                <motion.button
                                                    className="magna-icon-btn"
                                                    whileHover={{ scale: 1.06 }}
                                                    whileTap={{ scale: 0.94 }}
                                                    onClick={handleVoiceInput}
                                                    style={{
                                                        background: isListening ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                                                        border: isListening ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid transparent',
                                                        borderRadius: '8px', width: '28px', height: '28px', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexShrink: 0
                                                    }}
                                                    title="Speak via Voice"
                                                >
                                                    <MicIcon isListening={isListening} />
                                                </motion.button>

                                                <VoiceModeTrigger />

                                                <motion.button
                                                    className="magna-send-btn"
                                                    whileHover={{ scale: 1.02 }}
                                                    whileTap={{ scale: 0.98 }}
                                                    onClick={() => handleSend()}
                                                    disabled={isSending}
                                                    style={{
                                                        border: 'none',
                                                        color: '#ffffff',
                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                        padding: '8px 17px', borderRadius: '11px', fontSize: '12px',
                                                        fontWeight: '650', cursor: isSending ? 'default' : 'pointer',
                                                        opacity: isSending ? 0.75 : 1,
                                                        boxShadow: '0 6px 16px -5px color-mix(in srgb, var(--primary-color, #6366f1) 55%, transparent)'
                                                    }}
                                                >
                                                    {isSending
                                                        ? <span className="magna-shimmer-text">Executing…</span>
                                                        : <>Execute <PaperPlaneIcon /></>}
                                                </motion.button>
                                            </div>
                                        </div>

                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            marginBottom: '32px', fontSize: '11px', color: 'var(--text-muted, #94a3b8)',
                                            position: 'relative', zIndex: 1
                                        }}>
                                            <kbd style={{
                                                padding: '2px 6px', borderRadius: '5px',
                                                border: '1px solid var(--border-color, #e2e8f0)',
                                                fontSize: '10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                                color: 'var(--text-muted, #94a3b8)'
                                            }}>Enter</kbd>
                                            <span>to execute</span>
                                            <span style={{ margin: '0 4px', opacity: 0.4 }}>·</span>
                                            <span>{chatHistory.length} active session{chatHistory.length === 1 ? '' : 's'}</span>
                                        </div>

                                        <div style={{ width: '100%', position: 'relative', zIndex: 1 }}>
                                            <BentoWelcome onCardClick={handleSend} />
                                        </div>

                                        <div style={{
                                            marginTop: '30px', fontSize: '10.5px', fontWeight: '600',
                                            letterSpacing: '0.03em', color: 'var(--text-muted, #94a3b8)',
                                            opacity: 0.7, position: 'relative', zIndex: 1
                                        }}>
                                            Powered by MagnaERP
                                        </div>
                                    </motion.div>
                                ) : (
                                    <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                        {/* isThinking is intentionally left unset here: ChatArea auto-detects
                                            the waiting state from the last message, and once the streaming
                                            bot placeholder lands (see streamAssistantTurn) that bubble shows
                                            its own live thinking-dots/tool-activity state instead. */}
                                        <ChatArea messages={activeMessages} onSuggestionClick={handleSend} />

                                        {/* Active Chat Input Bar */}
                                        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color, rgba(148, 163, 184, 0.15))' }}>
                                            <div className="magna-input-shell" style={{
                                                maxWidth: '750px', margin: '0 auto',
                                                borderRadius: '15px', padding: '7px 10px',
                                                display: 'flex', flexDirection: 'column',
                                                backgroundColor: 'var(--control-bg, var(--card-bg, #f8fafc))',
                                                border: '1px solid var(--border-color, rgba(148, 163, 184, 0.2))',
                                                boxShadow: '0 6px 22px rgba(0, 0, 0, 0.06)'
                                            }}>
                                                <RenderFileBadges />

                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                                                    <motion.button
                                                        className="magna-icon-btn"
                                                        whileHover={{ scale: 1.06 }}
                                                        whileTap={{ scale: 0.94 }}
                                                        onClick={() => fileInputRef.current && fileInputRef.current.click()}
                                                        disabled={isUploading}
                                                        style={{
                                                            background: 'transparent', border: 'none', borderRadius: '8px',
                                                            width: '28px', height: '28px', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            flexShrink: 0
                                                        }}
                                                        title="Upload PO Documents (PDF / Images)"
                                                    >
                                                        <UploadIcon isUploading={isUploading} count={selectedFiles.length} />
                                                    </motion.button>

                                                    <textarea
                                                        ref={messageInputRef}
                                                        rows={1}
                                                        placeholder={selectedFiles.length > 0 ? `Add instructions for attached ${selectedFiles.length} file(s)...` : "Reply or upload document..."}
                                                        value={input}
                                                        onChange={(e) => {
                                                            setInput(e.target.value);
                                                            resizeMessageInput(e.target);
                                                        }}
                                                        onKeyDown={handleMessageKeyDown}
                                                        style={{
                                                            flex: 1, background: 'none', border: 'none', outline: 'none',
                                                            minWidth: 0, minHeight: '28px', maxHeight: '140px', padding: '4px 0',
                                                            resize: 'none', overflowY: 'hidden', boxSizing: 'border-box',
                                                            fontFamily: 'inherit', fontSize: '13px', lineHeight: '20px',
                                                            color: 'var(--text-color, #0f172a)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'
                                                        }}
                                                    />

                                                    <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color, rgba(148, 163, 184, 0.3))', flexShrink: 0 }} />

                                                    <motion.button
                                                        className="magna-icon-btn"
                                                        whileHover={{ scale: 1.06 }}
                                                        whileTap={{ scale: 0.94 }}
                                                        onClick={handleVoiceInput}
                                                        style={{
                                                            background: isListening ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                                                            border: isListening ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid transparent',
                                                            borderRadius: '8px', width: '28px', height: '28px', cursor: 'pointer',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            flexShrink: 0
                                                        }}
                                                        title="Speak via Voice"
                                                    >
                                                        <MicIcon isListening={isListening} />
                                                    </motion.button>

                                                    <VoiceModeTrigger />

                                                    <motion.button
                                                        className="magna-send-btn"
                                                        whileHover={{ scale: 1.03 }}
                                                        whileTap={{ scale: 0.97 }}
                                                        onClick={() => handleSend()}
                                                        disabled={isSending}
                                                        style={{
                                                            border: 'none',
                                                            color: '#ffffff',
                                                            display: 'flex', alignItems: 'center', gap: '6px',
                                                            padding: '7px 16px', borderRadius: '9px', fontSize: '11.5px',
                                                            fontWeight: '650', cursor: isSending ? 'default' : 'pointer',
                                                            opacity: isSending ? 0.75 : 1,
                                                            boxShadow: '0 5px 14px -5px color-mix(in srgb, var(--primary-color, #6366f1) 55%, transparent)'
                                                        }}
                                                    >
                                                        {isSending
                                                            ? <span className="magna-shimmer-text">…</span>
                                                            : <>Send <PaperPlaneIcon /></>}
                                                    </motion.button>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Live Voice Mode — realtime seamless voice conversation overlay */}
                    <AnimatePresence>
                        {isVoiceModeOpen && (
                            <motion.div
                                className="magna-voice-stage"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                style={{
                                    position: 'absolute', inset: 0, zIndex: 20,
                                    backgroundColor: 'var(--card-bg, #ffffff)',
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'flex-start',
                                    padding: '64px 24px 104px', overflow: 'hidden'
                                }}
                            >
                                <div className="magna-hero-dotgrid" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
                                <VoiceParticles status={voiceStatus} micLevel={micLevel} />

                                <motion.button
                                    className="magna-close-btn"
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={closeVoiceMode}
                                    style={{
                                        position: 'absolute', top: '22px', right: '22px', zIndex: 2,
                                        border: 'none', background: 'transparent', color: 'var(--text-muted, #64748b)',
                                        width: '34px', height: '34px', borderRadius: '50%', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                >
                                    <CloseIcon />
                                </motion.button>

                                {/* Top-right tool trace — what the AI is/was using this turn */}
                                <AnimatePresence>
                                    {voiceTools.length > 0 && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -6 }}
                                            style={{
                                                position: 'absolute', top: '64px', right: '22px', zIndex: 2,
                                                width: '250px', maxHeight: '46vh', overflowY: 'auto',
                                                padding: '10px 11px', borderRadius: '14px',
                                                border: '1px solid color-mix(in srgb, var(--border-color, rgba(148, 163, 184, 0.4)) 50%, transparent)',
                                                background: 'color-mix(in srgb, var(--card-bg, #ffffff) 65%, transparent)',
                                                backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                                                boxShadow: '0 16px 36px -12px rgba(0, 0, 0, 0.35)'
                                            }}
                                        >
                                            <ToolActivityPanel tools={voiceTools} />
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                {/* Persistent text transcript. Final turns stay in the
                                    active chat; the current user/AI line streams live. */}
                                <div
                                    className="magna-voice-conversation"
                                    aria-live="polite"
                                    aria-label="Live voice conversation"
                                    style={{
                                        width: 'min(800px, calc(100% - 48px))', height: '55vh', maxHeight: '55vh',
                                        overflowY: 'auto', padding: '10px 12px 18px', zIndex: 1,
                                        display: 'flex', flexDirection: 'column', gap: '18px',
                                        maskImage: 'linear-gradient(to bottom, transparent 0, black 18px, black 100%)'
                                    }}
                                >
                                    {voiceDisplayMessages.map((message, index) => (
                                        <div
                                            key={`${message.sender}-${index}`}
                                            style={{
                                                alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
                                                maxWidth: message.sender === 'user' ? '78%' : '88%',
                                                padding: message.sender === 'user' ? '10px 16px' : '2px 4px',
                                                borderRadius: message.sender === 'user' ? '22px' : '0',
                                                backgroundColor: message.sender === 'user'
                                                    ? 'color-mix(in srgb, var(--text-muted, #64748b) 10%, var(--card-bg, #fff))'
                                                    : 'transparent',
                                                color: 'var(--text-color, #0f172a)', fontSize: '14px',
                                                lineHeight: 1.65, textAlign: 'left'
                                            }}
                                        >
                                            {message.sender === 'bot'
                                                ? <VoiceReplyText text={message.text || ''} />
                                                : message.text}
                                        </div>
                                    ))}

                                    {liveTranscript && voiceDisplayMessages[voiceDisplayMessages.length - 1]?.text !== liveTranscript && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                                            style={{
                                                alignSelf: 'flex-end', maxWidth: '78%', padding: '10px 16px',
                                                borderRadius: '22px', fontSize: '14px', lineHeight: 1.55,
                                                color: 'var(--text-color, #0f172a)',
                                                backgroundColor: 'color-mix(in srgb, var(--text-muted, #64748b) 10%, var(--card-bg, #fff))'
                                            }}
                                        >
                                            {liveTranscript}
                                        </motion.div>
                                    )}

                                    {lastReplyText && voiceDisplayMessages[voiceDisplayMessages.length - 1]?.text !== lastReplyText && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                                            style={{
                                                alignSelf: 'flex-start', maxWidth: '88%', padding: '2px 4px',
                                                color: 'var(--text-color, #0f172a)', fontSize: '14px',
                                                lineHeight: 1.65, textAlign: 'left'
                                            }}
                                        >
                                            <VoiceReplyText text={lastReplyText} />
                                        </motion.div>
                                    )}
                                    {!voiceDisplayMessages.length && !liveTranscript && !lastReplyText && (
                                        <div style={{ color: 'var(--text-muted, #64748b)', fontSize: '13px', textAlign: 'center' }}>
                                            Start speaking. Your words and the assistant's response will appear here.
                                        </div>
                                    )}
                                    <div ref={voiceConversationEndRef} />
                                </div>

                                {/* Popped-up chart/table — appears on the left */}
                                <AnimatePresence>
                                    {pinnedChart && (
                                        <motion.div
                                            initial={{ opacity: 0, x: -16, scale: 0.97 }}
                                            animate={{ opacity: 1, x: 0, scale: 1 }}
                                            exit={{ opacity: 0, x: -16, scale: 0.97 }}
                                            style={{
                                                position: 'absolute', top: '104px', bottom: '108px', left: '22px',
                                                zIndex: 2, width: 'min(360px, calc(100% - 44px))',
                                                overflowY: 'auto', textAlign: 'left',
                                                padding: '18px 20px', borderRadius: '18px',
                                                border: '1px solid color-mix(in srgb, var(--border-color, rgba(148, 163, 184, 0.4)) 50%, transparent)',
                                                background: 'color-mix(in srgb, var(--card-bg, #ffffff) 65%, transparent)',
                                                backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                                                boxShadow: '0 26px 60px -16px rgba(0, 0, 0, 0.4)'
                                            }}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setPinnedChart(null)}
                                                title="Close"
                                                style={{
                                                    position: 'absolute', top: '10px', right: '10px',
                                                    border: 'none', background: 'transparent', color: 'var(--text-muted, #64748b)',
                                                    width: '26px', height: '26px', borderRadius: '50%', cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                }}
                                            >
                                                <CloseIcon />
                                            </button>
                                            {pinnedChart.chartData && <ChartBlock chartData={pinnedChart.chartData} />}
                                            {pinnedChart.imageSrc && (
                                                <figure style={{ margin: 0 }}>
                                                    <EmbeddedBase64Image source={pinnedChart.imageSrc} alt="Generated visualization" />
                                                </figure>
                                            )}
                                            {(pinnedChart.tables || []).map((tableMd, i) => (
                                                <div key={i} style={{ marginTop: i === 0 && !pinnedChart.chartData ? 0 : '14px' }}>
                                                    <FormattedMarkdownText text={tableMd} />
                                                </div>
                                            ))}
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <div style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                                    background: 'color-mix(in srgb, var(--card-bg, #ffffff) 65%, transparent)',
                                    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                                    border: '1px solid color-mix(in srgb, var(--border-color, rgba(148, 163, 184, 0.4)) 50%, transparent)',
                                    borderRadius: '40px', padding: '24px 32px 32px',
                                    boxShadow: '0 24px 48px -12px rgba(0,0,0,0.1)',
                                    zIndex: 10, marginTop: 'auto', marginBottom: 'auto'
                                }}>
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '7px',
                                        margin: '0 0 16px', padding: '5px 13px', borderRadius: '999px',
                                        border: '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
                                        backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 7%, transparent)',
                                        position: 'relative', zIndex: 1
                                    }}>
                                        <span className="magna-live-dot" style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--primary-color, #6366f1)' }} />
                                        <span style={{
                                            fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase',
                                            color: 'var(--primary-color, #6366f1)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
                                        }}>
                                            Live Voice Mode
                                        </span>
                                    </div>

                                    {/* Orb */}
                                    <div className="magna-voice-orb-wrap" style={{
                                        position: 'relative', width: '140px', height: '140px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        marginBottom: '16px', zIndex: 1, flexShrink: 0,
                                        transform: 'scale(1.3)'
                                    }}>
                                        <div id="orb-container" onClick={handleOrbTap} style={{ cursor: 'pointer', zIndex: 5 }}>
                                            <canvas id="orb-canvas"></canvas>
                                        </div>
                                    </div>

                                    <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-color, #0f172a)', marginBottom: '24px', position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        {voiceStatusLabel}
                                        <AnimatePresence>
                                            {voiceStatus === 'speaking' && (
                                                <motion.button
                                                    key="interrupt-pill"
                                                    initial={{ opacity: 0, scale: 0.9 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    whileHover={{ scale: 1.05 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={() => { interruptSpeech(); addVoiceEvent('interrupted', 'manual'); }}
                                                    title="Stop the assistant and start talking"
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '5px',
                                                        border: '1px solid color-mix(in srgb, var(--primary-color, #6366f1) 30%, transparent)',
                                                        borderRadius: '999px', cursor: 'pointer', padding: '3px 11px 3px 9px',
                                                        fontSize: '10px', fontWeight: '700', letterSpacing: '0.03em',
                                                        color: 'var(--primary-color, #6366f1)',
                                                        backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 10%, transparent)'
                                                    }}
                                                >
                                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
                                                    Interrupt
                                                </motion.button>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    {voiceStatus === 'error' && (
                                        <div style={{
                                            minHeight: '20px', maxWidth: '440px', textAlign: 'center', padding: '0 28px',
                                            fontSize: '13px', color: '#ef4444', lineHeight: 1.5,
                                            position: 'relative', zIndex: 1, marginBottom: '16px'
                                        }}>
                                            {voiceError}
                                        </div>
                                    )}

                                    <div className="magna-voice-controls" style={{
                                        position: 'relative', display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', gap: '16px', zIndex: 3, flexShrink: 0
                                    }}>

                                        <motion.button
                                            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                                            onClick={voiceConnected ? disconnectVoice : connectVoice}
                                            style={{
                                                border: '1px solid color-mix(in srgb, ' + (voiceConnected ? '#f59e0b' : 'var(--primary-color, #6366f1)') + ' 20%, transparent)',
                                                borderRadius: '999px', cursor: 'pointer', padding: '12px 24px',
                                                fontSize: '13px', fontWeight: '700',
                                                color: voiceConnected ? '#f59e0b' : 'var(--primary-color, #6366f1)',
                                                backgroundColor: 'color-mix(in srgb, ' + (voiceConnected ? '#f59e0b' : 'var(--primary-color, #6366f1)') + ' 10%, transparent)',
                                                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                                            }}
                                        >
                                            {voiceConnected ? 'Disconnect' : 'Connect'}
                                        </motion.button>
                                        <motion.button
                                            className="magna-end-call-btn"
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={closeVoiceMode}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                border: '1px solid color-mix(in srgb, #ef4444 20%, transparent)',
                                                borderRadius: '999px', cursor: 'pointer',
                                                padding: '12px 24px', fontSize: '13px', fontWeight: '650',
                                                color: '#ef4444', backgroundColor: 'color-mix(in srgb, #ef4444 10%, transparent)',
                                                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                                            }}
                                        >
                                            <PhoneEndIcon /> Close
                                        </motion.button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
