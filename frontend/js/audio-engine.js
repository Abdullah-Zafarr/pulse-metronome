/**
 * Pulse High-Precision, Super-Loud Audio Engine
 * Supports 4/4, 2/4, 3/4, 5/4, 6/8 + Click, Woodblock, Cowbell, Clap
 * With Fletcher-Munson presence EQ and Tanh saturation for extreme guitar cut.
 */
class MetronomeAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.presenceFilter = null;
    this.saturator = null;
    this.compressor = null;

    // Metronome state
    this.bpm = 90;
    this.beatsPerBar = 4;
    this.noteValue = 4; // 4 = quarter-note pulse, 8 = eighth-note pulse (e.g. 6/8)
    this.volume = 3.0; // 300% default boost
    this.soundType = 'click'; // 'click' | 'woodblock' | 'cowbell' | 'clap'
    this.isAccentEnabled = false;

    this.isPlaying = false;
    this.currentBeatIndex = 0;
    this.nextNoteTime = 0.0;
    this.lastPlayedBeat = null;
    this.scheduledBeats = [];
    this.visualQueue = [];
    this.visualRafId = null;
    this.clapBuffer = null;

    this.timerId = null;
    this.timerWorker = null;
    this.lookahead = 15.0; // scheduler interval (ms)
    this.scheduleAheadTime = 0.10; // lookahead window (seconds)

    // Visual synchronization callback: (beatNumber, isAccent, audioTime, totalBeats, beatInfo)
    this.onBeat = null;

    this.setupWorker();
    this.setupVisibilityListener();
  }

  setupWorker() {
    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (timer) clearInterval(timer);
            self.postMessage('tick');
            timer = setInterval(() => self.postMessage('tick'), 15);
          } else if (e.data === 'stop') {
            if (timer) clearInterval(timer);
            timer = null;
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.timerWorker = new Worker(URL.createObjectURL(blob));
      this.timerWorker.onmessage = (e) => {
        if (e.data === 'tick') {
          this.scheduler();
          if (typeof document !== 'undefined' && document.hidden) {
            this.flushVisualQueue();
          }
        }
      };
    } catch (err) {
      this.timerWorker = null;
    }
  }

  setupVisibilityListener() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.scheduleAheadTime = 0.25;
          if (this.isPlaying) {
            this.scheduler();
          }
        } else {
          this.scheduleAheadTime = 0.10;
          if (this.isPlaying) {
            this.scheduler();
            this.startVisualLoop();
          }
        }
      });
    }
  }

  initAudioContext() {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        return this.audioCtx.resume();
      }
      return Promise.resolve();
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });

    // 1. Fletcher-Munson 3.5 kHz Presence Peaking Filter (Cuts through guitar sound)
    this.presenceFilter = this.audioCtx.createBiquadFilter();
    this.presenceFilter.type = 'peaking';
    this.presenceFilter.frequency.value = 3500;
    this.presenceFilter.Q.value = 1.6;
    this.presenceFilter.gain.value = 7.5;

    // 2. Tanh WaveShaper Saturation (Produces upper harmonics for maximum RMS loudness)
    this.saturator = this.audioCtx.createWaveShaper();
    this.saturator.curve = this.makeSaturationCurve(25);
    this.saturator.oversample = '4x';

    // 3. Peak Limiter / Brickwall Compressor
    this.compressor = this.audioCtx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-5.0, this.audioCtx.currentTime);
    this.compressor.knee.setValueAtTime(2.0, this.audioCtx.currentTime);
    this.compressor.ratio.setValueAtTime(16.0, this.audioCtx.currentTime);
    this.compressor.attack.setValueAtTime(0.001, this.audioCtx.currentTime);
    this.compressor.release.setValueAtTime(0.035, this.audioCtx.currentTime);

    // 4. Master Boost Gain
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.setValueAtTime(this.volume, this.audioCtx.currentTime);

    // Connect audio chain
    this.presenceFilter.connect(this.saturator);
    this.saturator.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.audioCtx.destination);

    // Pre-build deterministic clap noise buffer once (zero per-beat GC or random transient jitter)
    this.clapBuffer = this.createClapBuffer(this.audioCtx);

    // 5. Connect to MediaStreamDestination and HTML Audio Carrier for Chrome Tab-Switch Auto-PiP
    try {
      this.mediaStreamDest = this.audioCtx.createMediaStreamDestination();
      this.masterGain.connect(this.mediaStreamDest);
      let carrier = document.getElementById('pulse-audio-carrier');
      if (!carrier) {
        carrier = document.createElement('audio');
        carrier.id = 'pulse-audio-carrier';
        carrier.autoplay = true;
        carrier.volume = 0.01;
        document.body.appendChild(carrier);
      }
      carrier.srcObject = this.mediaStreamDest.stream;
      this.audioCarrier = carrier;
    } catch (e) {
      // Audio carrier is optional fallback
    }

    if (this.audioCtx.state === 'suspended') {
      return this.audioCtx.resume();
    }
    return Promise.resolve();
  }

  createClapBuffer(ctx) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Deterministic xorshift32 PRNG so every clap transient is 100% sample-identical
    let seed = 0x9E3779B9;
    const impulseSamples = Math.max(8, Math.floor(ctx.sampleRate * 0.0015));
    for (let i = 0; i < bufferSize; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const rand = ((seed >>> 0) / 4294967295) * 2 - 1;
      // Crisp deterministic initial transient burst followed by dense noise body
      if (i < impulseSamples) {
        const phase = (i / impulseSamples) * Math.PI * 4;
        data[i] = Math.sin(phase) * 0.65 + rand * 0.35;
      } else {
        data[i] = rand;
      }
    }
    return buffer;
  }

  makeSaturationCurve(amount = 25) {
    const n = 44100;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  getSecondsPerBeat() {
    return (60.0 / this.bpm) * (4 / this.noteValue);
  }

  setVolume(percent) {
    this.volume = percent / 100;
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.audioCtx.currentTime, 0.015);
    }
  }

  setBpm(newBpm) {
    const clamped = Math.max(30, Math.min(300, Number(newBpm) || 90));
    if (clamped === this.bpm) return;
    this.bpm = clamped;

    if (this.isPlaying && this.audioCtx) {
      this.rescheduleOnTempoChange();
      this.updateMediaSessionMetadata();
    }
  }

  setTimeSignature(sigOrBeats, noteValue = 4) {
    if (typeof sigOrBeats === 'string' && sigOrBeats.includes('/')) {
      const parts = sigOrBeats.split('/');
      this.beatsPerBar = parseInt(parts[0], 10) || 4;
      this.noteValue = parseInt(parts[1], 10) || 4;
    } else {
      this.beatsPerBar = parseInt(sigOrBeats, 10) || 4;
      this.noteValue = parseInt(noteValue, 10) || 4;
    }
    this.currentBeatIndex = 0;

    if (this.isPlaying && this.audioCtx) {
      this.rescheduleOnMeterChange();
      this.updateMediaSessionMetadata();
    }
  }

  setSoundType(sound) {
    if (this.soundType === sound) return;
    this.soundType = sound;
    if (this.isPlaying && this.audioCtx) {
      this.reschedulePendingBeatsInPlace();
    }
  }

  setAccentEnabled(enabled) {
    const boolVal = Boolean(enabled);
    if (this.isAccentEnabled === boolVal) return;
    this.isAccentEnabled = boolVal;
    if (this.isPlaying && this.audioCtx) {
      this.reschedulePendingBeatsInPlace();
    }
  }

  cancelBeatRecord(record) {
    if (!record || record.cancelled) return;
    record.cancelled = true;
    if (record.nodes) {
      const { sources, env } = record.nodes;
      if (sources) {
        for (let i = 0; i < sources.length; i++) {
          try {
            sources[i].onended = null;
            sources[i].stop();
          } catch (e) {}
          try {
            sources[i].disconnect();
          } catch (e) {}
        }
      }
      if (env) {
        try {
          env.disconnect();
        } catch (e) {}
      }
    }
  }

  clearScheduledBeats() {
    for (let i = 0; i < this.scheduledBeats.length; i++) {
      this.cancelBeatRecord(this.scheduledBeats[i]);
    }
    this.scheduledBeats = [];
    this.visualQueue = [];
  }

  pruneAndGetLastPlayedBeat(now) {
    const keep = [];
    for (let i = 0; i < this.scheduledBeats.length; i++) {
      const b = this.scheduledBeats[i];
      if (b.cancelled) continue;
      if (b.time <= now + 0.004) {
        this.lastPlayedBeat = { time: b.gridTime || b.time, beatIdx: b.beatIdx };
      }
      if (b.time >= now - 0.25) {
        keep.push(b);
      }
    }
    this.scheduledBeats = keep;
    return this.lastPlayedBeat;
  }

  rescheduleOnTempoChange() {
    if (!this.audioCtx || !this.isPlaying) return;
    const now = this.audioCtx.currentTime;
    const lastBeat = this.pruneAndGetLastPlayedBeat(now);

    // Cancel any future unplayed beats in the lookahead window
    const remaining = [];
    for (let i = 0; i < this.scheduledBeats.length; i++) {
      const b = this.scheduledBeats[i];
      if (b.time > now + 0.004) {
        this.cancelBeatRecord(b);
      } else {
        remaining.push(b);
      }
    }
    this.scheduledBeats = remaining;
    this.visualQueue = this.visualQueue.filter(v => !v.record.cancelled);

    if (lastBeat) {
      this.currentBeatIndex = (lastBeat.beatIdx + 1) % this.beatsPerBar;
      this.nextNoteTime = Math.max(now + 0.012, lastBeat.time + this.getSecondsPerBeat());
    } else {
      this.currentBeatIndex = 0;
      this.nextNoteTime = Math.max(now + 0.012, this.nextNoteTime);
    }

    this.scheduler();
  }

  rescheduleOnMeterChange() {
    if (!this.audioCtx || !this.isPlaying) return;
    const now = this.audioCtx.currentTime;
    const lastBeat = this.pruneAndGetLastPlayedBeat(now);

    const remaining = [];
    for (let i = 0; i < this.scheduledBeats.length; i++) {
      const b = this.scheduledBeats[i];
      if (b.time > now + 0.004) {
        this.cancelBeatRecord(b);
      } else {
        remaining.push(b);
      }
    }
    this.scheduledBeats = remaining;
    this.visualQueue = this.visualQueue.filter(v => !v.record.cancelled);

    this.currentBeatIndex = 0;
    if (lastBeat) {
      this.nextNoteTime = Math.max(now + 0.012, lastBeat.time + this.getSecondsPerBeat());
    } else {
      this.nextNoteTime = Math.max(now + 0.012, this.nextNoteTime);
    }

    this.scheduler();
  }

  reschedulePendingBeatsInPlace() {
    if (!this.audioCtx || !this.isPlaying) return;
    const now = this.audioCtx.currentTime;
    let earliestFuture = null;
    const remaining = [];

    for (let i = 0; i < this.scheduledBeats.length; i++) {
      const b = this.scheduledBeats[i];
      if (!b.cancelled && b.time > now + 0.004) {
        if (!earliestFuture || b.time < earliestFuture.time) {
          earliestFuture = { time: b.time, beatIdx: b.beatIdx };
        }
        this.cancelBeatRecord(b);
      } else if (!b.cancelled) {
        remaining.push(b);
      }
    }

    if (earliestFuture) {
      this.scheduledBeats = remaining;
      this.visualQueue = this.visualQueue.filter(v => !v.record.cancelled);
      this.nextNoteTime = earliestFuture.time;
      this.currentBeatIndex = earliestFuture.beatIdx;
      this.scheduler();
    }
  }

  updateMediaSessionMetadata() {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Pulse Metronome',
          artist: `${this.bpm} BPM`,
          album: `${this.beatsPerBar}/${this.noteValue} Time Signature`
        });
      } catch (e) {}
    }
  }

  start() {
    if (this.isPlaying) return;
    const resumePromise = this.initAudioContext();

    this.isPlaying = true;
    this.currentBeatIndex = 0;
    this.lastPlayedBeat = null;
    this.clearScheduledBeats();

    const beginPlayback = () => {
      if (!this.isPlaying || !this.audioCtx) return;
      this.currentBeatIndex = 0;
      this.lastPlayedBeat = null;
      this.nextNoteTime = this.audioCtx.currentTime + 0.03;

      // Schedule Beat 1 immediately before starting worker ticks
      this.scheduler();
      this.startVisualLoop();

      if (this.timerWorker) {
        this.timerWorker.postMessage('start');
      }
    };

    if (this.audioCtx.state === 'running') {
      beginPlayback();
    } else {
      resumePromise.then(beginPlayback).catch(beginPlayback);
    }

    if (this.audioCarrier) {
      this.audioCarrier.play().catch(() => {});
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
      this.updateMediaSessionMetadata();
    }
  }

  stop() {
    this.isPlaying = false;
    if (this.timerWorker) {
      this.timerWorker.postMessage('stop');
    }
    clearTimeout(this.timerId);
    this.timerId = null;

    this.stopVisualLoop();
    this.clearScheduledBeats();
    this.lastPlayedBeat = null;

    if (this.audioCarrier) {
      this.audioCarrier.pause();
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }

  startVisualLoop() {
    if (this.visualRafId) {
      cancelAnimationFrame(this.visualRafId);
      this.visualRafId = null;
    }
    const tickVisuals = () => {
      if (!this.isPlaying) {
        this.visualRafId = null;
        return;
      }
      this.flushVisualQueue();
      this.visualRafId = requestAnimationFrame(tickVisuals);
    };
    this.visualRafId = requestAnimationFrame(tickVisuals);
  }

  stopVisualLoop() {
    if (this.visualRafId) {
      cancelAnimationFrame(this.visualRafId);
      this.visualRafId = null;
    }
  }

  flushVisualQueue() {
    if (!this.audioCtx || !this.isPlaying || this.visualQueue.length === 0) return;
    // DynamicsCompressorNode introduces a 6ms internal lookahead delay;
    // firing visual updates when currentTime reaches (visualTime - 0.002) aligns VSync paint with acoustic output.
    const now = this.audioCtx.currentTime;
    while (this.visualQueue.length > 0 && this.visualQueue[0].visualTime <= now + 0.002) {
      const item = this.visualQueue.shift();
      if (item.record && !item.record.cancelled && this.onBeat) {
        this.onBeat(
          item.beatNumber,
          item.isAccent,
          item.audioTime,
          item.totalBeats,
          {
            accentLevel: item.accentLevel,
            isSecondaryAccent: item.accentLevel === 1,
            beatDurationMs: this.getSecondsPerBeat() * 1000,
            noteValue: this.noteValue
          }
        );
      }
    }
  }

  scheduler() {
    if (!this.isPlaying || !this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    this.pruneAndGetLastPlayedBeat(now);

    // If the clock fell significantly behind (e.g. OS sleep or prolonged freeze), resync cleanly
    if (this.nextNoteTime < now - 0.12) {
      this.nextNoteTime = now + 0.02;
    }

    while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      this.scheduleBeat(this.nextNoteTime, this.currentBeatIndex);
      this.advanceBeat();
    }

    if (!this.timerWorker) {
      clearTimeout(this.timerId);
      this.timerId = setTimeout(() => {
        this.scheduler();
        this.flushVisualQueue();
      }, this.lookahead);
    }
  }

  advanceBeat() {
    const secondsPerBeat = this.getSecondsPerBeat();
    this.nextNoteTime += secondsPerBeat;
    this.currentBeatIndex = (this.currentBeatIndex + 1) % this.beatsPerBar;
  }

  scheduleBeat(time, beatIdx) {
    const beatNumber = beatIdx + 1; // 1 to beatsPerBar
    const isCompoundSixEight = (this.beatsPerBar === 6 && this.noteValue === 8);

    // Accent level: 2 = Primary downbeat (Beat 1), 1 = Secondary compound pulse (Beat 4 in 6/8), 0 = Subdivision
    let accentLevel = 0;
    if (this.isAccentEnabled) {
      if (beatNumber === 1) {
        accentLevel = 2;
      } else if (isCompoundSixEight && beatNumber === 4) {
        accentLevel = 1;
      }
    }
    const isAccent = accentLevel === 2;

    // Guarantee safeAudioTime is at least 2ms in the future so the 1ms linear attack ramp is never clipped
    const safeAudioTime = Math.max(time, this.audioCtx.currentTime + 0.002);
    const nodes = this.synthesizeSound(safeAudioTime, accentLevel);

    const record = {
      time: safeAudioTime,
      gridTime: time,
      beatIdx,
      beatNumber,
      accentLevel,
      nodes,
      cancelled: false
    };
    this.scheduledBeats.push(record);

    // Compensate for 6ms DynamicsCompressorNode lookahead delay for visual synchronization
    const compressorLookaheadSec = 0.006;
    this.visualQueue.push({
      visualTime: safeAudioTime + compressorLookaheadSec,
      audioTime: safeAudioTime,
      beatNumber,
      isAccent,
      accentLevel,
      totalBeats: this.beatsPerBar,
      record
    });
  }

  synthesizeSound(time, accentLevel) {
    if (!this.audioCtx) return null;
    const ctx = this.audioCtx;

    switch (this.soundType) {
      case 'woodblock':
        return this.synthWoodblock(ctx, time, accentLevel);
      case 'cowbell':
        return this.synthCowbell(ctx, time, accentLevel);
      case 'clap':
        return this.synthClap(ctx, time, accentLevel);
      case 'click':
      default:
        return this.synthClick(ctx, time, accentLevel);
    }
  }

  /**
   * 1. Click (High-Penetration Boss DB-90 Style)
   */
  synthClick(ctx, time, accentLevel) {
    const isPrimary = accentLevel === 2;
    const isSecondary = accentLevel === 1;
    const freq = isPrimary ? 3800 : (isSecondary ? 3200 : 2700);
    const gainLevel = isPrimary ? 1.4 : (isSecondary ? 1.15 : 0.95);
    const duration = isPrimary ? 0.045 : (isSecondary ? 0.038 : 0.032);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const env = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, time);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 1.5, time);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.4, time);
    osc2.connect(osc2Gain);
    osc2Gain.connect(env);
    osc1.connect(env);

    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gainLevel, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    env.connect(this.presenceFilter);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration + 0.01);
    osc2.stop(time + duration + 0.01);

    return { sources: [osc1, osc2], env };
  }

  /**
   * 2. Woodblock (Tuned Resonant Hollow Block)
   */
  synthWoodblock(ctx, time, accentLevel) {
    const isPrimary = accentLevel === 2;
    const isSecondary = accentLevel === 1;
    const freq = isPrimary ? 2400 : (isSecondary ? 2100 : 1800);
    const gainVal = isPrimary ? 1.3 : (isSecondary ? 1.1 : 0.9);
    const dur = 0.04;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, time + dur);

    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gainVal, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(env);
    env.connect(this.presenceFilter);

    osc.start(time);
    osc.stop(time + dur + 0.01);

    return { sources: [osc], env };
  }

  /**
   * 3. Cowbell (Dense Detuned Metallic Clank)
   */
  synthCowbell(ctx, time, accentLevel) {
    const isPrimary = accentLevel === 2;
    const isSecondary = accentLevel === 1;
    const f1 = isPrimary ? 740 : (isSecondary ? 659 : 587);
    const f2 = isPrimary ? 1046 : (isSecondary ? 932 : 845);
    const bpFreq = isPrimary ? 950 : (isSecondary ? 875 : 800);
    const gainVal = isPrimary ? 1.2 : (isSecondary ? 1.0 : 0.85);
    const dur = isPrimary ? 0.065 : (isSecondary ? 0.058 : 0.05);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'square';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(f1, time);
    osc2.frequency.setValueAtTime(f2, time);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(bpFreq, time);
    bp.Q.value = 3.0;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gainVal, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc1.connect(bp);
    osc2.connect(bp);
    bp.connect(env);
    env.connect(this.presenceFilter);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + dur + 0.01);
    osc2.stop(time + dur + 0.01);

    return { sources: [osc1, osc2], env };
  }

  /**
   * 4. Clap (Deterministic Burst Noise Transient)
   */
  synthClap(ctx, time, accentLevel) {
    const isPrimary = accentLevel === 2;
    const isSecondary = accentLevel === 1;
    if (!this.clapBuffer) {
      this.clapBuffer = this.createClapBuffer(ctx);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = this.clapBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isPrimary ? 1400 : (isSecondary ? 1200 : 1000), time);
    filter.Q.value = 2.0;

    const env = ctx.createGain();
    const dur = 0.045;
    const gainVal = isPrimary ? 1.4 : (isSecondary ? 1.2 : 1.0);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(gainVal, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    noise.connect(filter);
    filter.connect(env);
    env.connect(this.presenceFilter);

    noise.start(time);
    noise.stop(time + dur + 0.01);

    return { sources: [noise], env };
  }
}

window.MetronomeAudioEngine = MetronomeAudioEngine;
