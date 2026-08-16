// magna_ai_assistant/ChatArea.jsx
import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Same backend host AssistantPortal.jsx talks to. Duplicated locally
// (rather than imported) since ChatArea has no access to AssistantPortal's
// module-level constants.
// ============================================================
// BACKEND URL — change this one line for your setup.
// (ChatArea and AssistantPortal both import API_BASE_URL from here, so
// this is the only place it needs to be edited.)
//
// NOTE: "0.0.0.0" is a bind-all address the *server* listens on — it is
// not a host a browser can actually connect to, and fetches to it fail
// with "Failed to fetch". Use "localhost" if the backend runs on the
// same machine as the browser, or the server's real IP/hostname if not.
// ============================================================
const API_BASE_URL = 'http://localhost:8050';
// const API_BASE_URL = 'http://localhost:8005';   // e.g. backend on another machine on your LAN
// const API_BASE_URL = 'https://mmn2qbq4-8005.inc1.devtunnels.ms';  
// const API_BASE_URL = 'https://api.yourdomain.com'; // e.g. deployed backend

// Theme-adaptive categorical palette for chart series/slices. The first
// color always follows the active theme's primary color via color-mix();
// the rest are fixed accent hues used only to tell data series apart.
const CHART_PALETTE = [
    'var(--primary-color, #6366f1)',
    '#10b981',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#0ea5e9'
];

// ---------------------------------------------------------------------
// Text-to-speech — reads assistant replies out loud using the backend's
// OpenAI TTS voice (POST /api/tts, same `assistant.tts` instance that
// Live Voice Mode uses — see server.py / Voice/ws_voice.py), so read-aloud
// in the chat area sounds like the same voice as the realtime voice
// assistant instead of the browser's own built-in speech voice.
// ---------------------------------------------------------------------

const supportsAudioPlayback = typeof window !== 'undefined' && typeof window.Audio !== 'undefined';

// Strips Markdown syntax down to plain, speakable prose so the voice
// doesn't read out "asterisk asterisk", pipe characters, hashes, etc.
function stripMarkdownForSpeech(text) {
    if (!text) return '';
    return String(text)
        .replace(/```[\s\S]*?```/g, ' ')                 // fenced code / chart blocks
        .replace(/`([^`]+)`/g, '$1')                      // inline code
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')             // images
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // links -> link text
        .replace(/^\s*\|.*\|\s*$/gm, '')                  // table rows
        .replace(/^\s*#{1,6}\s*/gm, '')                   // headings
        .replace(/^\s*[-*]\s+/gm, '')                     // bullet markers
        .replace(/\*\*(.*?)\*\*/g, '$1')                  // bold
        .replace(/\*(.*?)\*/g, '$1')                      // italics
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// Calls the backend TTS endpoint and returns a playable data: URL. Reuses
// the same OpenAI voice (TTS_VOICE, e.g. "alloy") that Live Voice Mode
// speaks with, so both surfaces sound identical.
async function fetchSpeechAudio(text) {
    const response = await fetch(`${API_BASE_URL}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`TTS request failed with status ${response.status}`);
    const data = await response.json();
    if (!data.audio) throw new Error('No audio returned from TTS endpoint');
    return `data:audio/mpeg;base64,${data.audio}`;
}

function SpeakerOnIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
    );
}

function SpeakerOffIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
    );
}

function StopIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
    );
}

function EmbeddedBase64Image({ source, alt }) {
    const [objectUrl, setObjectUrl] = useState('');
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        let nextUrl = '';
        try {
            const match = String(source).match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
            if (!match) throw new Error('Unsupported image data');

            // Blob URLs avoid browser URL-length limits on large chart images.
            const binary = window.atob(match[2]);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            nextUrl = URL.createObjectURL(new Blob([bytes], { type: match[1].toLowerCase() }));
            setObjectUrl(nextUrl);
            setLoadError('');
        } catch (error) {
            setObjectUrl('');
            setLoadError('The generated chart image is invalid. Please generate it again.');
        }

        return () => {
            if (nextUrl) URL.revokeObjectURL(nextUrl);
        };
    }, [source]);

    if (loadError) {
        return <div style={{ padding: '10px', fontSize: '12px', color: '#dc2626' }}>{loadError}</div>;
    }
    if (!objectUrl) return null;

    return (
        <img
            src={objectUrl}
            alt={alt}
            onError={() => setLoadError('The generated chart image could not be decoded. Please generate it again.')}
            style={{ display: 'block', width: '100%', height: 'auto', maxHeight: '480px', objectFit: 'contain', borderRadius: '8px' }}
        />
    );
}

function FormattedMarkdownText({ text, isStreaming = false, onSuggestionClick }) {
    if (!text) return null;

    // Some chart tools put a newline between `![alt]` and `(data:image...)`.
    // Normalize that valid-enough variant before splitting the response into
    // line-oriented display blocks.
    let normalizedText = String(text).replace(
        /!\[([^\]]*)\]\s*\(\s*(data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+)\s*\)/gi,
        '![$1]($2)'
    );

    // SSE delivers a generated PNG over many token events. Until the closing
    // `)` arrives it is not a valid image, and exposing those partial Base64
    // tokens creates a huge horizontal line in the chat bubble.
    if (isStreaming) {
        const partialImageAt = normalizedText.search(/!\[[^\]]*\]\s*\(\s*data:image\/(?:png|jpe?g|webp|gif);base64,/i);
        if (partialImageAt !== -1) {
            normalizedText = `${normalizedText.slice(0, partialImageAt).trimEnd()}\n\n[[GENERATING_CHART]]`;
        }
    }

    // Helper to render inline formatting like **bold**
    const renderInline = (str) => {
        if (!str) return null;
        const parts = str.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
                return (
                    <strong key={i} style={{ fontWeight: '650', color: 'var(--text-color, #0f172a)' }}>
                        {part.slice(2, -2)}
                    </strong>
                );
            }
            return part;
        });
    };

    // Split text into blocks (tables vs paragraphs/headings/lists)
    const lines = normalizedText.split('\n');
    const blocks = [];
    let currentTable = null;

    lines.forEach((line) => {
        const trimmed = line.trim();

        // Detect Markdown Table row
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            if (!currentTable) currentTable = [];
            // Skip separator line |---|---|
            if (!trimmed.match(/^\|[\s\-:|]+\|$/)) {
                const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
                currentTable.push(cells);
            }
            return;
        } else if (currentTable) {
            blocks.push({ type: 'table', rows: currentTable });
            currentTable = null;
        }

        // Render chart tools that return a PNG/JPEG/WebP/GIF as a Markdown
        // data URI instead of exposing the (very long) Base64 payload.
        const imageMatch = trimmed.match(/^!\[([^\]]*)\]\((data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+)\)$/i);
        if (imageMatch) {
            blocks.push({ type: 'image', alt: imageMatch[1] || 'Generated chart', src: imageMatch[2] });
            return;
        }

        // Detect Headings
        if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
            const level = trimmed.startsWith('### ') ? 3 : trimmed.startsWith('## ') ? 2 : 1;
            const headingText = trimmed.replace(/^#+\s*/, '');
            blocks.push({ type: 'heading', level, text: headingText });
            return;
        }

        if (trimmed === '[[GENERATING_CHART]]') {
            blocks.push({ type: 'chart-loading' });
            return;
        }

        // Detect Action Pill — accumulate consecutive pills into one group block
        let stripped = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
        if (stripped.startsWith('[Action:') && stripped.endsWith(']')) {
            if (currentTable) { blocks.push({ type: 'table', rows: currentTable }); currentTable = null; }
            const actionText = stripped.slice(8, -1).trim();
            const last = blocks[blocks.length - 1];
            if (last && last.type === 'action_pills') {
                last.pills.push(actionText);
            } else {
                blocks.push({ type: 'action_pills', pills: [actionText] });
            }
            return;
        }

        // Detect Bullet Points
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            const bulletText = trimmed.substring(2);
            blocks.push({ type: 'bullet', text: bulletText });
            return;
        }

        // Standard Paragraph line
        if (trimmed.length > 0) {
            blocks.push({ type: 'p', text: trimmed });
        }
    });

    if (currentTable) {
        blocks.push({ type: 'table', rows: currentTable });
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {blocks.map((block, idx) => {
                if (block.type === 'action_pills') {
                    return (
                        <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '10px', alignItems: 'center' }}>
                            {block.pills.map((pill, pIdx) => (
                                <button
                                    key={pIdx}
                                    onClick={() => onSuggestionClick && onSuggestionClick(pill)}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        padding: '5px 13px',
                                        fontSize: '12px',
                                        fontWeight: '600',
                                        color: 'var(--primary-color, #6366f1)',
                                        backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 10%, transparent)',
                                        border: '1px solid color-mix(in srgb, var(--primary-color, #6366f1) 28%, transparent)',
                                        borderRadius: '16px',
                                        cursor: 'pointer',
                                        transition: 'background 0.18s ease, border-color 0.18s ease, transform 0.12s ease',
                                        outline: 'none',
                                        lineHeight: '1.4'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--primary-color, #6366f1) 20%, transparent)';
                                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--primary-color, #6366f1) 50%, transparent)';
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--primary-color, #6366f1) 10%, transparent)';
                                        e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--primary-color, #6366f1) 28%, transparent)';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                    }}
                                >
                                    <span style={{ fontSize: '10px', opacity: 0.7 }}>→</span>
                                    {pill}
                                </button>
                            ))}
                        </div>
                    );
                }
                if (block.type === 'heading') {
                    return (
                        <h4 key={idx} style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-color, #0f172a)', margin: '12px 0 4px 0' }}>
                            {renderInline(block.text)}
                        </h4>
                    );
                }
                if (block.type === 'bullet') {
                    return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginLeft: '4px', fontSize: '13px' }}>
                            <span style={{ color: 'var(--primary-color, #6366f1)', fontWeight: 'bold' }}>•</span>
                            <span>{renderInline(block.text)}</span>
                        </div>
                    );
                }
                if (block.type === 'table') {
                    const CELL_BORDER = '1px solid var(--border-color, #cbd5e1)';
                    const headers = block.rows[0] || [];
                    const dataRows = block.rows.slice(1);
                    return (
                        <div key={idx} style={{ overflowX: 'auto', margin: '10px 0' }}>
                            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px', backgroundColor: 'var(--control-bg, var(--card-bg, #f8fafc))', border: CELL_BORDER, borderRadius: '6px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: 'color-mix(in srgb, var(--text-color, #0f172a) 6%, transparent)' }}>
                                        {headers.map((h, hIdx) => (
                                            <th key={hIdx} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '700', color: 'var(--text-color, #0f172a)', border: CELL_BORDER }}>
                                                {renderInline(h)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {dataRows.map((r, rIdx) => (
                                        <tr key={rIdx}>
                                            {r.map((c, cIdx) => (
                                                <td key={cIdx} style={{ padding: '6px 10px', color: 'var(--text-color, #0f172a)', border: CELL_BORDER }}>
                                                    {renderInline(c)}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                }
                if (block.type === 'image') {
                    return (
                        <figure key={idx} style={{ margin: '8px 0 2px', width: '100%' }}>
                            <EmbeddedBase64Image source={block.src} alt={block.alt} />
                            {block.alt && (
                                <figcaption style={{ marginTop: '6px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted, #64748b)' }}>
                                    {block.alt}
                                </figcaption>
                            )}
                        </figure>
                    );
                }
                if (block.type === 'chart-loading') {
                    return <LiveThinkingDots key={idx} label="Rendering chart" />;
                }
                return (
                    <p key={idx} style={{ margin: '2px 0', fontSize: '13.5px', color: 'var(--text-color, #0f172a)', lineHeight: '1.5' }}>
                        {renderInline(block.text)}
                    </p>
                );
            })}
        </div>
    );
}

function StreamingText({ text, speed = 6, onComplete, onSuggestionClick }) {
    const [displayedText, setDisplayedText] = useState('');
    const containsEmbeddedImage = /data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(String(text || ''));
    useEffect(() => {
        // Base64 charts can contain tens of thousands of characters. Showing
        // them through the typewriter effect delays the closing Markdown `)`
        // for minutes, so render an embedded image response in one pass.
        if (containsEmbeddedImage) {
            setDisplayedText(text);
            if (onComplete) onComplete();
            return undefined;
        }
        let index = 0; setDisplayedText('');
        const interval = setInterval(() => {
            if (index < text.length) {
                // Capture the character before React schedules the update.
                // Otherwise the mutable index may advance first and drop a
                // letter from the displayed response.
                const nextCharacter = text.charAt(index);
                index++;
                setDisplayedText((prev) => prev + nextCharacter);
            } else {
                clearInterval(interval);
                if (onComplete) onComplete();
            }
        }, speed);
        return () => clearInterval(interval);
    }, [text, speed, containsEmbeddedImage]);

    return <FormattedMarkdownText text={displayedText} onSuggestionClick={onSuggestionClick} />;
}

function getCleanTextAndChart(text) {
    if (!text) return { cleanText: "", chartData: null };

    const sourceText = typeof text === 'string'
        ? text
        : String(text?.answer ?? text?.text ?? text?.content ?? '');

    let chartData = null;
    // Accept the documented ```chart block as well as the ```json block that
    // some model responses put below "Interactive Visual Spec".
    const chartRegex = /```(chart|json)\s*([\s\S]*?)\s*```/gi;
    let match;

    while ((match = chartRegex.exec(sourceText)) !== null) {
        try {
            const candidate = JSON.parse(match[2].trim());
            const looksLikeChart = candidate && typeof candidate === 'object' && (
                ['pie', 'line', 'bar'].includes(candidate.type) ||
                Array.isArray(candidate.series) ||
                Array.isArray(candidate.labels) ||
                Array.isArray(candidate.xAxis)
            );
            if (looksLikeChart) {
                // Legacy responses used { title, labels, values } without a
                // chart type. Convert that shape to the renderer's bar schema.
                chartData = !candidate.type && Array.isArray(candidate.labels) && Array.isArray(candidate.values)
                    ? {
                        type: 'bar',
                        title: candidate.title,
                        xAxis: candidate.labels,
                        series: [{ name: candidate.seriesName || 'Value', data: candidate.values }],
                    }
                    : candidate;
            }
        } catch (e) {
            // Ordinary/invalid JSON is left visible; only valid chart specs
            // are removed from the user-facing answer.
        }
    }

    let cleanText = sourceText;
    if (chartData) {
        cleanText = cleanText
            .replace(/```(?:chart|json)\s*[\s\S]*?\s*```/gi, '')
            .replace(/^\s*(?:#{1,6}\s*)?(?:interactive\s+)?visual\s+spec(?:ification)?\s*:?\s*$/gim, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    return { cleanText, chartData };
}

function getChartImageFromTools(tools = []) {
    for (let i = tools.length - 1; i >= 0; i--) {
        const tool = tools[i];
        if (!/chart|graph|visual/i.test(String(tool?.name || '')) || tool?.result == null) continue;

        const resultText = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result);
        const match = resultText.match(/data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+/i);
        if (match) return match[0];
    }
    return null;
}

function getChartDataFromTools(tools = []) {
    for (let i = tools.length - 1; i >= 0; i--) {
        const tool = tools[i];
        const name = String(tool?.name || '').toLowerCase();
        if (!/chart|graph|visual/.test(name)) continue;

        // Prefer a structured chart block returned by newer backend tools.
        if (typeof tool.result === 'string') {
            const parsedResult = getCleanTextAndChart(tool.result);
            if (parsedResult.chartData) return parsedResult.chartData;
        }

        // Older tools return a PNG, but their original numeric arguments are
        // still present on the tool_call event. Render those natively instead.
        const args = tool.args || {};
        if (/pie|donut/.test(name) && Array.isArray(args.labels) && Array.isArray(args.values)) {
            return { type: 'pie', title: args.title, labels: args.labels, values: args.values };
        }

        const type = /line/.test(name) ? 'line' : /bar/.test(name) ? 'bar' : null;
        const xAxis = args.x_axis_data || args.xAxis || args.labels;
        const values = args.series_data || args.values;
        if (type && Array.isArray(xAxis) && Array.isArray(values)) {
            return {
                type,
                title: args.title,
                xAxis,
                series: [{ name: args.series_name || args.seriesName || 'Value', data: values }],
            };
        }
    }
    return null;
}

function removeEmbeddedImagePayload(text) {
    if (!text) return '';
    // A model may truncate the generated Markdown image before its closing
    // parenthesis. Once the original tool image is available, discard that
    // copied payload instead of rendering duplicate/corrupt Base64 prose.
    return String(text)
        .replace(/!\[[^\]]*\]\s*\(\s*data:image\/(?:png|jpe?g|webp|gif);base64,[\s\S]*$/i, '')
        .trim();
}

// ---------------------------------------------------------------------
// Lightweight, dependency-free SVG charts.
//
// These replace the previous recharts-based renderer. recharts' internal
// <ResponsiveContainer> relies on React context/hooks that can break with
// an "Invalid hook call" / "Cannot read properties of null (reading
// 'useContext')" crash whenever more than one copy of React ends up on
// the page (a common outcome with Frappe custom-bundle setups). Plain SVG
// has no such dependency, so it can't hit that failure mode — and it
// keeps every color theme-adaptive via CHART_PALETTE / CSS variables.
// ---------------------------------------------------------------------

function ChartLegend({ items }) {
    return (
        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
            {items.map((item, i) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted, #64748b)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length], flexShrink: 0 }} />
                    {item}
                </div>
            ))}
        </div>
    );
}

function PieChartSVG({ data, size = 180 }) {
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1;
    const radius = size / 2;
    const innerRadius = radius * 0.55;
    let cumulative = 0;

    const slices = data.map((d, idx) => {
        const value = Number(d.value) || 0;
        const startAngle = (cumulative / total) * 2 * Math.PI;
        cumulative += value;
        const endAngle = (cumulative / total) * 2 * Math.PI;
        const large = endAngle - startAngle > Math.PI ? 1 : 0;

        const x1 = radius + radius * Math.sin(startAngle);
        const y1 = radius - radius * Math.cos(startAngle);
        const x2 = radius + radius * Math.sin(endAngle);
        const y2 = radius - radius * Math.cos(endAngle);
        const ix1 = radius + innerRadius * Math.sin(startAngle);
        const iy1 = radius - innerRadius * Math.cos(startAngle);
        const ix2 = radius + innerRadius * Math.sin(endAngle);
        const iy2 = radius - innerRadius * Math.cos(endAngle);

        const path = value <= 0 ? '' : `M ${ix1} ${iy1} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${large} 0 ${ix1} ${iy1} Z`;

        return {
            path,
            color: CHART_PALETTE[idx % CHART_PALETTE.length],
            name: d.name,
            value,
            pct: total ? ((value / total) * 100).toFixed(0) : 0
        };
    });

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {slices.map((s, idx) => s.path && (
                    <path key={idx} d={s.path} fill={s.color}>
                        <title>{`${s.name}: ${s.value} (${s.pct}%)`}</title>
                    </path>
                ))}
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {slices.map((s, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, color: 'var(--text-color, #0f172a)' }}>{s.name}</span>
                        <span style={{ color: 'var(--text-muted, #64748b)' }}>{s.pct}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BarChartSVG({ data, seriesKeys, width = 520, height = 210 }) {
    const padding = { top: 12, right: 12, bottom: 28, left: 12 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const maxVal = Math.max(1, ...data.flatMap(d => seriesKeys.map(k => Number(d[k]) || 0)));
    const groupWidth = innerW / Math.max(1, data.length);
    const barGap = 6;
    const barWidth = Math.max(4, (groupWidth - barGap * (seriesKeys.length + 1)) / seriesKeys.length);

    return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = padding.top + innerH * (1 - t);
                return <line key={i} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border-color, #e2e8f0)" strokeWidth="1" />;
            })}
            {data.map((d, gi) => {
                const groupX = padding.left + gi * groupWidth;
                return (
                    <g key={gi}>
                        {seriesKeys.map((k, si) => {
                            const val = Number(d[k]) || 0;
                            const barH = (val / maxVal) * innerH;
                            const x = groupX + barGap + si * (barWidth + barGap);
                            const y = padding.top + innerH - barH;
                            return (
                                <rect key={si} x={x} y={y} width={barWidth} height={Math.max(0, barH)} rx="3" fill={CHART_PALETTE[si % CHART_PALETTE.length]}>
                                    <title>{`${k}: ${val}`}</title>
                                </rect>
                            );
                        })}
                        <text x={groupX + groupWidth / 2} y={height - 8} textAnchor="middle" fontSize="9.5" fill="var(--text-muted, #64748b)">
                            {String(d.name).length > 10 ? String(d.name).slice(0, 9) + '…' : d.name}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

function LineChartSVG({ data, seriesKeys, width = 520, height = 210 }) {
    const padding = { top: 12, right: 16, bottom: 28, left: 12 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const maxVal = Math.max(1, ...data.flatMap(d => seriesKeys.map(k => Number(d[k]) || 0)));
    const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

    const pointsFor = (k) => data.map((d, i) => {
        const val = Number(d[k]) || 0;
        return {
            x: padding.left + i * stepX,
            y: padding.top + innerH - (val / maxVal) * innerH,
            val
        };
    });

    return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
            {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = padding.top + innerH * (1 - t);
                return <line key={i} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border-color, #e2e8f0)" strokeWidth="1" />;
            })}
            {seriesKeys.map((k, si) => {
                const pts = pointsFor(k);
                const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
                return (
                    <g key={si}>
                        <path d={d} fill="none" stroke={CHART_PALETTE[si % CHART_PALETTE.length]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        {pts.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r="3.2" fill={CHART_PALETTE[si % CHART_PALETTE.length]}>
                                <title>{`${k}: ${p.val}`}</title>
                            </circle>
                        ))}
                    </g>
                );
            })}
            {data.map((d, i) => (
                <text key={i} x={padding.left + i * stepX} y={height - 8} textAnchor="middle" fontSize="9.5" fill="var(--text-muted, #64748b)">
                    {String(d.name).length > 10 ? String(d.name).slice(0, 9) + '…' : d.name}
                </text>
            ))}
        </svg>
    );
}

function ChartBlock({ chartData }) {
    if (!chartData) return null;

    const isPie = chartData.type === 'pie';
    const pieData = isPie
        ? (chartData.labels || []).map((lbl, idx) => ({ name: lbl, value: (chartData.values || [])[idx] || 0 }))
        : null;
    const xyData = !isPie
        ? (chartData.xAxis || []).map((xVal, idx) => {
            const row = { name: xVal };
            (chartData.series || []).forEach(s => { row[s.name] = (s.data || [])[idx]; });
            return row;
        })
        : null;
    const seriesKeys = (chartData.series || []).map(s => s.name);

    return (
        <div style={{
            marginTop: '16px',
            padding: '16px 14px 12px 14px',
            backgroundColor: 'var(--control-bg, var(--card-bg, #f8fafc))',
            borderRadius: '12px',
            border: '1px solid var(--border-color, #e2e8f0)'
        }}>
            {chartData.title && (
                <h4 style={{ fontSize: '13px', color: 'var(--text-color, #0f172a)', fontWeight: '700', margin: '0 0 14px 0', textAlign: 'center' }}>
                    {chartData.title}
                </h4>
            )}

            {isPie && pieData && <PieChartSVG data={pieData} />}

            {chartData.type === 'line' && xyData && (
                <>
                    <LineChartSVG data={xyData} seriesKeys={seriesKeys} />
                    <ChartLegend items={seriesKeys} />
                </>
            )}

            {chartData.type === 'bar' && xyData && (
                <>
                    <BarChartSVG data={xyData} seriesKeys={seriesKeys} />
                    <ChartLegend items={seriesKeys} />
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------
// Tool-call visibility — renders the same kind of "used a tool" trace
// ChatGPT/Claude show while an agent is working, sourced straight from
// the backend's token/tool_call/tool_result event stream (see
// magma_voice.py's _ws_receiver for the reference event shape). Shared
// between ChatArea's message bubbles and AssistantPortal's Live Voice
// Mode overlay so both surfaces render tool activity identically.
// ---------------------------------------------------------------------

function humanizeToolName(name = '') {
    const cleaned = String(name || '').replace(/^_+/, '').replace(/[_\-.]+/g, ' ').trim();
    if (!cleaned) return 'Tool';
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function ToolIcon({ name = '', size = 13 }) {
    const n = String(name || '').toLowerCase();
    const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };

    if (/search|find|lookup|query|rag/.test(n)) return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
    if (/chart|report|analytic|graph|dashboard/.test(n)) return <svg {...common}><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg>;
    if (/mail|email|notify|send/.test(n)) return <svg {...common}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>;
    if (/calendar|schedule|event|meeting/.test(n)) return <svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>;
    if (/lead|customer|contact|crm|person|company|employee/.test(n)) return <svg {...common}><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="7" r="4" /></svg>;
    if (/doc|file|pdf|upload|attach/.test(n)) return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>;
    if (/web|url|browse|http|internet/.test(n)) return <svg {...common}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" /></svg>;
    if (/db|database|record|erp|order|invoice|stock|inventory|item|purchase/.test(n)) return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" /></svg>;
    return <svg {...common}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" /></svg>;
}

function ToolStatusIndicator({ status }) {
    if (status === 'running') {
        return (
            <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 0.85, repeat: Infinity, ease: 'linear' }}
                style={{
                    width: '11px', height: '11px', borderRadius: '50%', flexShrink: 0, display: 'inline-block',
                    border: '2px solid color-mix(in srgb, var(--primary-color, #6366f1) 22%, transparent)',
                    borderTopColor: 'var(--primary-color, #6366f1)'
                }}
            />
        );
    }
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}

function ToolCallChip({ tool }) {
    const [expanded, setExpanded] = useState(false);
    const hasArgs = tool.args && typeof tool.args === 'object' && Object.keys(tool.args).length > 0;
    const resultPreview = tool.result != null
        ? (typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result))
        : '';
    const hasDetail = hasArgs || !!resultPreview;

    return (
        <div style={{
            border: '1px solid var(--border-color, rgba(148, 163, 184, 0.18))',
            borderRadius: '10px',
            backgroundColor: 'var(--control-bg, var(--card-bg, #f8fafc))',
            overflow: 'hidden'
        }}>
            <button
                type="button"
                onClick={() => hasDetail && setExpanded((v) => !v)}
                style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '7px 10px', background: 'transparent', border: 'none',
                    cursor: hasDetail ? 'pointer' : 'default', textAlign: 'left'
                }}
            >
                <span style={{
                    width: '20px', height: '20px', borderRadius: '6px', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--primary-color, #6366f1)',
                    backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 12%, transparent)'
                }}>
                    <ToolIcon name={tool.name} />
                </span>
                <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-color, #0f172a)', flex: 1 }}>
                    {tool.status === 'running' ? `Using ${humanizeToolName(tool.name)}…` : `Used ${humanizeToolName(tool.name)}`}
                </span>
                <ToolStatusIndicator status={tool.status} />
                {hasDetail && (
                    <motion.span animate={{ rotate: expanded ? 180 : 0 }} style={{ display: 'flex', color: 'var(--text-muted, #64748b)', flexShrink: 0 }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </motion.span>
                )}
            </button>
            <AnimatePresence initial={false}>
                {expanded && hasDetail && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{
                            padding: '0 10px 10px 38px', fontSize: '11px',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            color: 'var(--text-muted, #64748b)', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                        }}>
                            {hasArgs && (
                                <div style={{ marginBottom: resultPreview ? '6px' : 0 }}>{JSON.stringify(tool.args)}</div>
                            )}
                            {resultPreview && (
                                <div style={{ color: 'var(--text-color, #0f172a)' }}>
                                    → {resultPreview.length > 400 ? `${resultPreview.slice(0, 400)}…` : resultPreview}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function ToolActivityPanel({ tools = [] }) {
    if (!tools.length) return null;
    const allDone = tools.every((t) => t.status === 'done');
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px', width: '100%' }}>
            <div style={{
                fontSize: '9.5px', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--text-muted, #64748b)', padding: '0 2px'
            }}>
                {allDone ? `Used ${tools.length} tool${tools.length > 1 ? 's' : ''}` : 'Working…'}
            </div>
            {tools.map((tool, i) => <ToolCallChip key={`${tool.name}-${i}`} tool={tool} />)}
        </div>
    );
}

function LiveThinkingDots({ label = 'Magna AI is thinking' }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-color, #0f172a)' }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {[0, 1, 2].map((dot) => (
                    <motion.span
                        key={dot}
                        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: dot * 0.2 }}
                        style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: 'var(--primary-color, #6366f1)', display: 'inline-block' }}
                    />
                ))}
            </div>
        </div>
    );
}

export { ToolIcon, ToolStatusIndicator, ToolCallChip, ToolActivityPanel, LiveThinkingDots, humanizeToolName, FormattedMarkdownText, EmbeddedBase64Image, ChartBlock, getCleanTextAndChart, API_BASE_URL };

// AI Thinking Indicator
function ThinkingIndicator() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: '82%', gap: '6px' }}>
                {/* Thinking Sender Meta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }}>
                    <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        backgroundColor: 'var(--primary-color, #6366f1)', boxShadow: '0 0 8px var(--primary-color, #6366f1)'
                    }} />
                    <span style={{ fontSize: '11.5px', fontWeight: '650', color: 'var(--text-muted, #64748b)', letterSpacing: '-0.1px' }}>
                        Magna System Agent
                    </span>
                    <span style={{
                        fontSize: '9.5px', padding: '1px 6px', borderRadius: '50px',
                        backgroundColor: 'color-mix(in srgb, var(--primary-color, #6366f1) 12%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--primary-color, #6366f1) 22%, transparent)',
                        color: 'var(--primary-color, #6366f1)', fontWeight: '600'
                    }}>
                        Thinking...
                    </span>
                </div>

                {/* Thinking Card — solid, theme-adaptive, no blur */}
                <div style={{
                    padding: '12px 18px',
                    borderRadius: '18px 18px 18px 4px',
                    backgroundColor: 'var(--control-bg, var(--card-bg, #f8fafc))',
                    border: '1px solid var(--border-color, rgba(148, 163, 184, 0.15))',
                    boxShadow: '0 8px 24px -6px rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                }}>
                    <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-color, #0f172a)' }}>
                        Magna AI is thinking
                    </span>

                    {/* Pulsing Dots Animation */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {[0, 1, 2].map((dot) => (
                            <motion.span
                                key={dot}
                                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: dot * 0.2 }}
                                style={{
                                    width: '5px',
                                    height: '5px',
                                    borderRadius: '50%',
                                    backgroundColor: 'var(--primary-color, #6366f1)',
                                    display: 'inline-block'
                                }}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

export default function ChatArea({ messages = [], isThinking, onSuggestionClick }) {
    const scrollBottomRef = useRef(null);

    // Auto-detect thinking state: If last message in list was sent by 'user' OR explicitly passed via isThinking
    const lastMsg = messages[messages.length - 1];
    const showThinking = isThinking !== undefined ? isThinking : (lastMsg && lastMsg.sender === 'user');

    useEffect(() => {
        scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, showThinking]);

    // ---- Text-to-speech: which message (by index) is currently playing
    // or loading, plus an "auto read new replies" toggle. Playback uses
    // the backend's OpenAI TTS voice (see fetchSpeechAudio above) rather
    // than the browser's own speech voice, so it matches Live Voice Mode. ----
    const [speakingIndex, setSpeakingIndex] = useState(null);
    const [loadingSpeechIndex, setLoadingSpeechIndex] = useState(null);
    const [autoSpeak, setAutoSpeak] = useState(false);
    const autoSpokenRef = useRef(new Set());
    const currentAudioRef = useRef(null);
    const speechRequestIdRef = useRef(0);

    const stopSpeaking = () => {
        speechRequestIdRef.current += 1; // invalidates any in-flight fetch/playback
        if (currentAudioRef.current) {
            currentAudioRef.current.pause();
            currentAudioRef.current.currentTime = 0;
            currentAudioRef.current = null;
        }
        setSpeakingIndex(null);
        setLoadingSpeechIndex(null);
    };

    const speakMessage = async (index, rawText) => {
        if (!supportsAudioPlayback) return;
        const plainText = stripMarkdownForSpeech(rawText);
        if (!plainText) return;

        stopSpeaking();
        const requestId = speechRequestIdRef.current;
        setLoadingSpeechIndex(index);

        try {
            const audioSrc = await fetchSpeechAudio(plainText);
            if (requestId !== speechRequestIdRef.current) return; // superseded/stopped while loading

            const audio = new Audio(audioSrc);
            currentAudioRef.current = audio;
            audio.onended = () => {
                if (currentAudioRef.current === audio) currentAudioRef.current = null;
                setSpeakingIndex((current) => (current === index ? null : current));
            };
            audio.onerror = () => {
                if (currentAudioRef.current === audio) currentAudioRef.current = null;
                setSpeakingIndex((current) => (current === index ? null : current));
                console.error('Text-to-speech playback failed for the received audio.');
                alert('Could not play the reply audio (the audio data from the server looked invalid). Check the browser console/network tab for details.');
            };
            setLoadingSpeechIndex(null);
            setSpeakingIndex(index);
            audio.play().catch((playErr) => {
                setSpeakingIndex((current) => (current === index ? null : current));
                console.error('Audio playback was blocked or failed:', playErr);
                alert(`Could not play the reply audio: ${playErr.message || playErr}`);
            });
        } catch (err) {
            console.error('Text-to-speech failed:', err);
            if (requestId === speechRequestIdRef.current) setLoadingSpeechIndex(null);
            alert(`Could not read this reply aloud: ${err.message}. Check that the backend server is running the latest server.py (with the /api/tts route) and is reachable at ${API_BASE_URL}.`);
        }
    };

    const toggleSpeak = (index, rawText) => {
        if (speakingIndex === index || loadingSpeechIndex === index) {
            stopSpeaking();
        } else {
            speakMessage(index, rawText);
        }
    };

    // Stop any in-progress speech when the component unmounts (e.g. the
    // user switches to a different chat) so it doesn't keep talking.
    useEffect(() => {
        return () => stopSpeaking();
    }, []);

    // When auto-read is on, speak each assistant reply once it finishes
    // streaming in. Messages that came from Live Voice Mode (voiceOrigin)
    // are skipped here — the realtime voice socket already spoke them out
    // loud once; auto-reading them again here would play the reply twice.
    useEffect(() => {
        if (!autoSpeak || !supportsAudioPlayback) return;
        const index = messages.length - 1;
        const msg = messages[index];
        if (!msg || msg.sender === 'user' || msg.streaming || msg.voiceOrigin) return;
        const { cleanText } = getCleanTextAndChart(msg.text);
        if (!cleanText || autoSpokenRef.current.has(index)) return;
        autoSpokenRef.current.add(index);
        speakMessage(index, cleanText);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, autoSpeak]);

    return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', backgroundColor: 'transparent' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', width: '100%', margin: '0 auto' }}>
                {supportsAudioPlayback && (
                    <div style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none' }}>
                        <button
                            onClick={() => { if (autoSpeak) stopSpeaking(); setAutoSpeak((v) => !v); }}
                            title={autoSpeak ? 'Turn off auto read-aloud' : 'Automatically read new replies aloud'}
                            style={{
                                pointerEvents: 'auto',
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '6px 12px', borderRadius: '50px',
                                backgroundColor: autoSpeak ? 'var(--primary-color, #6366f1)' : 'var(--control-bg, var(--card-bg, #f8fafc))',
                                border: `1px solid ${autoSpeak ? 'var(--primary-color, #6366f1)' : 'var(--border-color, rgba(148, 163, 184, 0.25))'}`,
                                color: autoSpeak ? '#fff' : 'var(--text-muted, #64748b)',
                                fontSize: '11.5px', fontWeight: 600, cursor: 'pointer',
                                boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.08)'
                            }}
                        >
                            {autoSpeak ? <SpeakerOnIcon size={13} /> : <SpeakerOffIcon size={13} />}
                            {autoSpeak ? 'Reading aloud' : 'Read aloud'}
                        </button>
                    </div>
                )}
                <AnimatePresence initial={false}>
                    {messages.map((msg, index) => {
                        const isUser = msg.sender === 'user';
                        const isLast = index === messages.length - 1;
                        const parsedResponse = getCleanTextAndChart(msg.text);
                        const chartData = parsedResponse.chartData || getChartDataFromTools(msg.tools);
                        const toolChartImage = getChartImageFromTools(msg.tools);
                        const cleanText = toolChartImage || chartData
                            ? removeEmbeddedImagePayload(parsedResponse.cleanText)
                            : parsedResponse.cleanText;

                        return (
                            <motion.div
                                key={index}
                                layout
                                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                                style={{
                                    display: 'flex',
                                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                                    width: '100%'
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: isUser ? 'flex-end' : 'flex-start',
                                    maxWidth: '82%',
                                    gap: '6px'
                                }}>
                                    {/* Sender Meta Info */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 4px' }}>
                                        {!isUser && (
                                            <span style={{
                                                width: '6px', height: '6px', borderRadius: '50%',
                                                backgroundColor: 'var(--primary-color, #6366f1)', boxShadow: '0 0 8px var(--primary-color, #6366f1)'
                                            }} />
                                        )}
                                        <span style={{ fontSize: '11.5px', fontWeight: '650', color: 'var(--text-muted, #64748b)', letterSpacing: '-0.1px' }}>
                                            {isUser ? 'Workspace Executive' : 'Magna System Agent'}
                                        </span>
                                        <span style={{
                                            fontSize: '9.5px', padding: '1px 6px', borderRadius: '50px',
                                            backgroundColor: isUser
                                                ? 'var(--border-color, rgba(148, 163, 184, 0.15))'
                                                : 'color-mix(in srgb, var(--primary-color, #6366f1) 12%, transparent)',
                                            border: isUser
                                                ? '1px solid var(--border-color, rgba(148, 163, 184, 0.2))'
                                                : '1px solid color-mix(in srgb, var(--primary-color, #6366f1) 22%, transparent)',
                                            color: isUser ? 'var(--text-muted, #64748b)' : 'var(--primary-color, #6366f1)',
                                            fontWeight: '600'
                                        }}>
                                            {isUser ? 'Prompt' : 'Engine Response'}
                                        </span>
                                        {!isUser && supportsAudioPlayback && cleanText && (
                                            <button
                                                onClick={() => toggleSpeak(index, cleanText)}
                                                title={
                                                    speakingIndex === index ? 'Stop reading'
                                                        : loadingSpeechIndex === index ? 'Loading audio…'
                                                        : 'Read this reply aloud'
                                                }
                                                style={{
                                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                    width: '20px', height: '20px', borderRadius: '50%', padding: 0,
                                                    border: 'none', cursor: loadingSpeechIndex === index ? 'wait' : 'pointer',
                                                    opacity: loadingSpeechIndex === index ? 0.5 : 1,
                                                    backgroundColor: speakingIndex === index ? 'var(--primary-color, #6366f1)' : 'transparent',
                                                    color: speakingIndex === index ? '#fff' : 'var(--text-muted, #64748b)'
                                                }}
                                            >
                                                {speakingIndex === index ? <StopIcon size={11} /> : <SpeakerOnIcon size={12} />}
                                            </button>
                                        )}
                                    </div>

                                    {/* Message Bubble — solid, theme-adaptive, no blur */}
                                    <div style={{
                                        padding: '14px 18px',
                                        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                                        backgroundColor: isUser
                                            ? 'color-mix(in srgb, var(--primary-color, #6366f1) 10%, transparent)'
                                            : 'var(--control-bg, var(--card-bg, #f8fafc))',
                                        border: isUser
                                            ? '1px solid color-mix(in srgb, var(--primary-color, #6366f1) 25%, transparent)'
                                            : '1px solid var(--border-color, rgba(148, 163, 184, 0.15))',
                                        boxShadow: '0 4px 16px -2px rgba(0, 0, 0, 0.05)',
                                        textAlign: 'left',
                                        position: 'relative',
                                        width: chartData || toolChartImage ? '560px' : 'auto',
                                        maxWidth: '100%'
                                    }}>
                                        <div style={{
                                            fontSize: '13.5px',
                                            lineHeight: '1.6',
                                            color: 'var(--text-color, #0f172a)',
                                            letterSpacing: '-0.1px'
                                        }}>
                                            {!isUser && msg.tools && msg.tools.length > 0 && (
                                                <ToolActivityPanel tools={msg.tools} />
                                            )}
                                            {!isUser && msg.streaming && !cleanText && (!msg.tools || msg.tools.length === 0) ? (
                                                <LiveThinkingDots />
                                            ) : !isUser && isLast && !msg.streamed ? (
                                                <StreamingText text={cleanText} onSuggestionClick={onSuggestionClick} />
                                            ) : (
                                                <FormattedMarkdownText text={cleanText} isStreaming={!!msg.streaming} onSuggestionClick={onSuggestionClick} />
                                            )}
                                        </div>

                                        {toolChartImage && !chartData && !msg.streaming && (
                                            <figure style={{ margin: '10px 0 2px', width: '100%' }}>
                                                <EmbeddedBase64Image source={toolChartImage} alt="Generated chart" />
                                            </figure>
                                        )}

                                        <ChartBlock chartData={chartData} />
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}

                    {/* Show Thinking Card when AI is processing */}
                    {showThinking && <ThinkingIndicator key="thinking-state" />}
                </AnimatePresence>
                <div ref={scrollBottomRef} />
            </div>
        </div>
    );
}
