/**
 * AudioCapture — Industry-level Voice Activity Detection
 *
 * IMPROVEMENTS v4:
 *  1. HYSTERESIS: requires SPEECH_CONFIRM_FRAMES consecutive above-threshold
 *     frames before declaring speech started (eliminates single-frame noise spikes).
 *  2. LIVE NOISE FLOOR: recalibrates every 5s during confirmed silence by
 *     blending recent silence frames into the noise floor (10% blend rate).
 *     Floor is FROZEN during active speech so voice doesn't contaminate baseline.
 *  3. VOICEPRINT HOOK: after utterance is collected, runs optional MFCC
 *     speaker verification before calling onSpeechEnd.
 *
 * Conversational flow:
 *   start() → mic opens and STAYS open for the entire session
 *   Speech detected (N consecutive frames) → onSpeechStart()
 *   1200ms of silence after speech → onSpeechEnd(base64PCM) [mic stays open]
 *   stop()  → fully closes mic [called only by stop button]
 */

class AudioCapture {
    constructor(onSpeechStart, onSpeechEnd, onAudioLevel, voiceprintOptions) {
        this.onSpeechStart = onSpeechStart;
        this.onSpeechEnd   = onSpeechEnd;   // Called with base64 PCM
        this.onAudioLevel  = onAudioLevel;

        // Voiceprint options: { enabled, embedding, threshold }
        this._voiceprint = voiceprintOptions || { enabled: false };

        this.isListening = false;
        this.isStarting  = false;

        // Web Audio nodes
        this.audioCtx   = null;
        this.stream     = null;
        this.source     = null;
        this.workletNode = null;   // AudioWorkletNode (preferred)
        this.processor  = null;   // ScriptProcessorNode (fallback only)

        // ── Adaptive VAD state ─────────────────────────────────────────────
        this.speaking         = false;
        this.silenceTimer     = null;
        this.audioBuffer      = [];       // Recorded frames
        this.preRollBuffer    = [];       // Circular pre-roll (captures before threshold)
        this.PRE_ROLL_FRAMES  = 5;        // ~100ms at 4096 buffer / 16kHz

        // ── Hysteresis counters ────────────────────────────────────────────
        // Require N consecutive high-energy frames before declaring speech.
        // This kills false triggers from single-frame spikes (keyboard, AC, etc.)
        this.SPEECH_CONFIRM_FRAMES  = 3;  // ~75ms at 4096/16kHz chunks
        this._speechCandidateFrames = 0;  // Consecutive above-threshold frames seen

        // ── Adaptive noise floor ───────────────────────────────────────────
        this.noiseFloor       = 0.02;     // Conservative starting estimate
        this.noiseCalibrated  = false;
        this.calibrationFrames = [];
        this.CALIBRATION_MS   = 800;      // Initial calibration window (increased from 600ms)

        // Live recalibration (during confirmed silence, not during speech)
        this._silenceFrames   = [];       // Recent silence RMS values
        this._silenceFrameMax = 30;       // Keep last 30 silence frames
        this._lastRecalibTime = 0;        // Timestamp of last recalibration
        this._RECALIB_INTERVAL = 5000;    // Recalibrate floor every 5s of silence

        // Dynamic threshold = noiseFloor * multiplier
        this.NOISE_MULTIPLIER       = 5.0;  // Raised: more aggressive noise rejection
        this.MIN_SPEECH_DURATION_MS = 600;  // Increased: filters short noise bursts
        this.SILENCE_DURATION_MS    = 700;  // Natural pause before finalizing utterance

        this.speechStartTime = 0;
        this._isSending = false;       // Debounce: block new utterance while processing
        this._SEND_DEBOUNCE_MS = 800;
    }

    async start() {
        if (this.isListening || this.isStarting) return;
        this.isStarting = true;

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation:  true,
                    noiseSuppression:  true,
                    autoGainControl:   true,
                    channelCount:      1,
                }
            });

            // 16kHz is required by Sarvam STT
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            this.source   = this.audioCtx.createMediaStreamSource(this.stream);

            // Start noise calibration timer
            this.noiseCalibrated   = false;
            this.calibrationFrames = [];
            this._silenceFrames    = [];
            this._lastRecalibTime  = Date.now();
            this.calibrationTimeout = setTimeout(() => this._finalizeCalibration(), this.CALIBRATION_MS);

            // Prefer AudioWorklet (non-deprecated, runs off main thread)
            if (this.audioCtx.audioWorklet) {
                try {
                    await this.audioCtx.audioWorklet.addModule('/js/audio/vad-processor.js');
                    this.workletNode = new AudioWorkletNode(this.audioCtx, 'vad-processor');
                    this.workletNode.port.onmessage = (e) => this._process(e.data);
                    this.source.connect(this.workletNode);
                    this.workletNode.connect(this.audioCtx.destination);
                    console.log('[VAD] Using AudioWorkletNode (modern)');
                } catch (workletErr) {
                    console.warn('[VAD] AudioWorklet failed, falling back to ScriptProcessor:', workletErr);
                    this._startScriptProcessor();
                }
            } else {
                console.warn('[VAD] AudioWorklet not supported, falling back to ScriptProcessor');
                this._startScriptProcessor();
            }

            this.isListening = true;
            this.isStarting  = false;
            console.log('[VAD] Microphone open, calibrating noise floor...');

        } catch (err) {
            this.isStarting = false;
            console.error('[VAD] Failed to start:', err);
            throw err;
        }
    }

    /** Fallback for browsers without AudioWorklet support */
    _startScriptProcessor() {
        this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = (e) => this._process(e.inputBuffer.getChannelData(0));
        this.source.connect(this.processor);
        this.processor.connect(this.audioCtx.destination);
    }

    _finalizeCalibration() {
        if (this.calibrationFrames.length > 0) {
            const avg = this.calibrationFrames.reduce((a, b) => a + b, 0) / this.calibrationFrames.length;
            this.noiseFloor = Math.max(avg, 0.003); // Never let it go below 0.003
        }
        this.noiseCalibrated = true;
        this._lastRecalibTime = Date.now();
        const threshold = this.noiseFloor * this.NOISE_MULTIPLIER;
        console.log(`[VAD] Calibrated. Noise floor=${this.noiseFloor.toFixed(5)}, threshold=${threshold.toFixed(5)}`);
    }

    /**
     * Live recalibration: gently blend recent silence frames into noise floor.
     * Called only during confirmed silence, never during speech.
     */
    _tryRecalibrateNoise(rms) {
        if (this.speaking || !this.noiseCalibrated) return;

        // Collect silence frames (ring buffer)
        this._silenceFrames.push(rms);
        if (this._silenceFrames.length > this._silenceFrameMax) {
            this._silenceFrames.shift();
        }

        // Recalibrate every 5s
        const now = Date.now();
        if (now - this._lastRecalibTime >= this._RECALIB_INTERVAL && this._silenceFrames.length >= 10) {
            const avg = this._silenceFrames.reduce((a, b) => a + b, 0) / this._silenceFrames.length;
            // 10% blend towards new floor — prevents sudden jumps
            const newFloor = Math.max(this.noiseFloor * 0.9 + avg * 0.1, 0.003);
            if (Math.abs(newFloor - this.noiseFloor) > 0.0005) {
                this.noiseFloor = newFloor;
                console.log(`[VAD] Live recalibrate: floor=${this.noiseFloor.toFixed(5)}, threshold=${(this.noiseFloor * this.NOISE_MULTIPLIER).toFixed(5)}`);
            }
            this._lastRecalibTime = now;
            this._silenceFrames = [];
        }
    }

    /**
     * Process a chunk of audio samples. Called from either the AudioWorklet
     * message handler or the ScriptProcessor callback.
     * @param {Float32Array} input
     */
    _process(input) {
        if (!this.isListening) return;

        // ── RMS energy calculation ──────────────────────────────────────────
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);

        // Normalize level 0→1 for orb animation
        const level = Math.min(rms * 15, 1.0);
        if (this.onAudioLevel) this.onAudioLevel(level);

        // ── Calibration phase: collect ambient noise samples ───────────────
        if (!this.noiseCalibrated) {
            this.calibrationFrames.push(rms);
            return; // Don't do VAD until calibrated
        }

        const threshold = this.noiseFloor * this.NOISE_MULTIPLIER;

        // ── Maintain pre-roll circular buffer ─────────────────────────────
        if (!this.speaking) {
            this.preRollBuffer.push(new Float32Array(input));
            if (this.preRollBuffer.length > this.PRE_ROLL_FRAMES) {
                this.preRollBuffer.shift();
            }
        }

        // ── Voice Activity Detection with HYSTERESIS ───────────────────────
        if (rms > threshold) {
            // Above threshold frame
            if (!this.speaking && !this._isSending) {
                // Increment candidate counter — require N consecutive frames
                this._speechCandidateFrames++;

                if (this._speechCandidateFrames >= this.SPEECH_CONFIRM_FRAMES) {
                    
                    // Start with pre-roll frames so we don't clip the beginning
                    this.audioBuffer = [...this.preRollBuffer, new Float32Array(input)];
                    this.preRollBuffer = [];

                    // ── STANDARD VAD ──
                    this.speaking        = true;
                    this.speechStartTime = Date.now();
                    this._speechCandidateFrames = 0;
                    if (this.onSpeechStart) this.onSpeechStart();
                    console.log('[VAD] Speech started');
                } else {
                    // Candidate: still collecting frames, store them in pre-roll
                    this.audioBuffer = [];
                }
            } else if (this.speaking) {
                // Cancel any pending silence timeout — user is still speaking
                if (this.silenceTimer) {
                    clearTimeout(this.silenceTimer);
                    this.silenceTimer = null;
                }
                this.audioBuffer.push(new Float32Array(input));
                
                // --- HARD CUTOFF: Prevent perpetual listening ---
                if (this.speaking && (Date.now() - this.speechStartTime > 15000)) {
                    console.warn('[VAD] Maximum speech duration reached (15s). Forcing cutoff.');
                    this.speaking = false;
                    this._finalizeUtterance();
                }
            }

        } else {
            // ── SILENCE ──
            // Reset candidate counter — hysteresis requires consecutive frames
            if (!this.speaking) {
                this._speechCandidateFrames = 0;
                // Live noise floor update during confirmed silence
                this._tryRecalibrateNoise(rms);
            }

            if (this.speaking) {
                this.audioBuffer.push(new Float32Array(input));

                if (!this.silenceTimer) {
                    this.silenceTimer = setTimeout(() => {
                        this.silenceTimer = null;
                        this.speaking     = false;
                        this._finalizeUtterance();
                    }, this.SILENCE_DURATION_MS);
                }
            }
        }
    }

    async _finalizeUtterance() {
        const speechDuration = Date.now() - this.speechStartTime;

        if (speechDuration < this.MIN_SPEECH_DURATION_MS) {
            console.log(`[VAD] Utterance too short (${speechDuration}ms) — discarding.`);
            this.audioBuffer = [];
            return;
        }

        // Merge all frames
        let totalLength = 0;
        for (const buf of this.audioBuffer) totalLength += buf.length;

        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const buf of this.audioBuffer) {
            merged.set(buf, offset);
            offset += buf.length;
        }
        this.audioBuffer = [];

        // --- Trim trailing silence to prevent STT hallucinations ---
        const silenceSamples = Math.floor(this.SILENCE_DURATION_MS * (this.audioCtx.sampleRate / 1000));
        const trimAmount = Math.max(0, silenceSamples - (this.audioCtx.sampleRate / 10)); // ~100ms
        const targetLength = Math.max(Math.floor(this.MIN_SPEECH_DURATION_MS * (this.audioCtx.sampleRate / 1000)), totalLength - trimAmount);
        let trimmed = merged.slice(0, targetLength);

        // --- Resample to 16kHz if necessary (Fix for Mac/Safari ignoring sampleRate constraint) ---
        if (this.audioCtx.sampleRate !== 16000) {
            try {
                const targetRate = 16000;
                const length = Math.floor(trimmed.length * targetRate / this.audioCtx.sampleRate);
                const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, length, targetRate);
                const buffer = offlineCtx.createBuffer(1, trimmed.length, this.audioCtx.sampleRate);
                buffer.copyToChannel(trimmed, 0);
                
                const source = offlineCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(offlineCtx.destination);
                source.start();
                
                const renderedBuffer = await offlineCtx.startRendering();
                trimmed = renderedBuffer.getChannelData(0);
                console.log(`[VAD] Resampled from ${this.audioCtx.sampleRate}Hz to 16000Hz`);
            } catch (err) {
                console.error('[VAD] Resampling failed:', err);
            }
        }

        const pcm16  = this._floatTo16BitPCM(trimmed);
        const base64 = this._arrayBufferToBase64(pcm16.buffer);

        console.log(`[VAD] Utterance finalized: ${speechDuration}ms`);

        // Short debounce guard to prevent double-send
        this._isSending = true;
        setTimeout(() => { this._isSending = false; }, this._SEND_DEBOUNCE_MS);

        // Voiceprint verification has been fully migrated to the Python backend.

        // ✅ Mic stays open — do NOT call stop()
        if (this.onSpeechEnd) this.onSpeechEnd(base64);
    }

    /**
     * Update voiceprint options at runtime (called after enrollment).
     * @param {{ enabled: boolean, embedding: number[]|null, threshold: number }} opts
     */
    setVoiceprintOptions(opts) {
        this._voiceprint = opts;
    }

    /**
     * Fully close the microphone.
     * Call only when the user explicitly ends the session.
     */
    stop() {
        if (!this.isListening && !this.isStarting) return;

        if (this.calibrationTimeout) { clearTimeout(this.calibrationTimeout); this.calibrationTimeout = null; }
        if (this.silenceTimer)       { clearTimeout(this.silenceTimer);       this.silenceTimer = null;       }

        if (this.workletNode) { this.workletNode.disconnect(); this.workletNode = null; }
        if (this.processor)   { this.processor.disconnect();  this.processor = null;  }
        if (this.source)      { this.source.disconnect();     this.source    = null;  }
        if (this.stream)      { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        if (this.audioCtx)    { this.audioCtx.close();        this.audioCtx  = null;  }

        this.speaking      = false;
        this.audioBuffer   = [];
        this.preRollBuffer = [];
        this._speechCandidateFrames = 0;
        this.isListening   = false;
        this.isStarting    = false;

        if (this.onAudioLevel) this.onAudioLevel(0);
        console.log('[VAD] Microphone closed.');
    }

    // ── PCM Utilities ────────────────────────────────────────────────────────
    _floatTo16BitPCM(float32Array) {
        const buf  = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buf);
        for (let i = 0, off = 0; i < float32Array.length; i++, off += 2) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Int16Array(buf);
    }

    _arrayBufferToBase64(buffer) {
        const bytes  = new Uint8Array(buffer);
        let   binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return window.btoa(binary);
    }
}
