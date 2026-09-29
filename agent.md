# AGENT.md — Pulse Metronome

This document serves as the primary technical specification and operational guide for AI coding agents and autonomous contributors working on **Pulse Metronome**.

---

## 🎯 1. Project Mission & Identity

**Pulse Metronome** is an ultra-loud, minimalist, zero-dependency metronome designed specifically for guitarists and live musicians.

### Core Philosophy
1. **Loud & Piercing**: The click must cut through loud electric guitar amplifiers and acoustic instruments. Transients must remain sharp, clear, and high-gain.
2. **Minimalist & Single-Viewport**: Distraction-free single-screen experience. No scrolling, no pop-ups, no advertising, and no clutter.
3. **Sample-Accurate Timing**: Uncompromising rhythmic accuracy powered by the native Web Audio API clock. Zero jitter, drift, or lag.
4. **Zero-Build & Lightweight**: Pure native web standards (HTML5, Vanilla CSS, Vanilla JavaScript, native Node.js). No bundling or heavy framework dependencies.

---

## 📁 2. Architecture & File Structure

```text
pulse-metronome/
├── backend/
│   └── server.js             # Native Node.js HTTP server with Range-request video streaming
├── frontend/
│   ├── css/
│   │   └── style.css         # Single-viewport responsive styling, CSS variables & animations
│   ├── js/
│   │   ├── app.js            # Main controller: BPM state, shortcuts, DOM bindings, tap tempo
│   │   ├── audio-engine.js   # Web Audio lookahead scheduler, synth click generator, volume booster
│   │   ├── pip-manager.js    # Picture-in-Picture (PiP) floating canvas beat tracker
│   │   └── water-cinemagraph.js # Video backdrop controller & canvas fallbacks
│   └── index.html            # Frontend entrypoint
├── media/
│   ├── background video.mp4  # Seamless ambient living backdrop
│   └── readme screenshot .png# Project documentation graphics
├── index.html                # Root entrypoint
├── package.json              # Project scripts & metadata
├── README.md                 # Public documentation
├── CONTRIBUTION.md           # Human contributor guidelines
└── agent.md                  # Autonomous agent instructions (this file)
```

---

## ⚙️ 3. Technical Stack & Conventions

| Layer | Technology | Guidelines |
|---|---|---|
| **Frontend Runtime** | Vanilla ES6+ JavaScript | Native browser APIs only. Do not add external script tags or frameworks (React/Vue/Angular). |
| **Styling** | Vanilla CSS3 | Modern CSS tokens (custom properties), Flexbox/Grid, zero Tailwind or CSS preprocessors. |
| **Audio Engine** | Web Audio API (`AudioContext`) | Accurate scheduling using `currentTime`. Lookahead scheduler with Web Worker/timer ticks. |
| **Backend** | Native Node.js `http` module | Zero npm dependencies. Handles static files, MIME types, and HTTP 206 Partial Content for video. |
| **Assets** | Native MP4, SVG, Web Fonts | Google Fonts (`Inter`, `JetBrains Mono`) for high-contrast typography. |

---

## 📜 4. Non-Negotiable Directives for Agents

When making modifications or adding features to this repository, agents MUST adhere to these rules:

### A. Timing Integrity (Absolute Priority)
- **NEVER** use naive `setInterval` or `setTimeout` to directly trigger audio clicks.
- **ALWAYS** use the Web Audio clock (`audioCtx.currentTime`) with a lookahead scheduler (`audio-engine.js`).
- Visual indicators (flashes, strobes, beat counters) should synchronize with the scheduled audio events or requestAnimationFrame loops.

### B. Sound & Acoustic Loudness
- Ensure click sounds maintain punchy envelopes (attack < 2ms, short punchy decay).
- Avoid clipping while maintaining aggressive gain staging and resonant filter peaks that cut through 1kHz–4kHz guitar frequencies.
- Supported sound presets:
  - **Sharp Click** (High-pitched dual-sine transient)
  - **Woodblock** (Resonant bandpass pop)
  - **Cowbell** (Harmonic dual square/triangle burst)
  - **Handclap** (Filtered white-noise burst)

### C. UI & Visual Constraints
- Keep the stage within a **single viewport** (`100vh` / `100dvh`).
- Never introduce vertical or horizontal page scrollbars on standard desktop or mobile viewports.
- The control sidebar ("cockpit") must remain cleanly toggleable via keyboard shortcut (`H`) and the menu button.

### D. Zero Build Pipeline
- Do **NOT** install bundlers (`webpack`, `vite`, `esbuild`, `rollup`) or CSS toolchains (`tailwind`, `sass`) unless explicitly requested by the user.
- All code must run immediately upon launching `node backend/server.js` or standard static web servers.

---

## 💻 5. Local Development Commands

```bash
# Start the local streaming server (Node.js)
npm start
# or
node backend/server.js
# Access: http://localhost:3000

# Alternative static server (Python)
python -m http.server 8000
# Access: http://localhost:8000
```

---

## ⌨️ 6. Key Controls Reference

| Key | Action |
|---|---|
| `Spacebar` | Start / Stop metronome |
| `H` | Toggle collapsible sidebar cockpit |
| `Arrow Up` / `Arrow Down` | Increment / Decrement BPM by 1 |
| `Shift` + `Arrow Up` / `Arrow Down` | Increment / Decrement BPM by 5 |
| `T` | Tap tempo input |

---

## 🚀 7. Agent Contribution & PR Protocol

1. **Verify Timing & Audio**:
   - Confirm Web Audio initializes after user interaction (handling browser autoplay policies).
   - Verify sample accuracy at extreme BPMs (30 BPM to 300 BPM).
2. **Verify Single Viewport**:
   - Test UI responsiveness on standard desktop (1920x1080, 1366x768) and mobile screens.
3. **Clean Git Hygiene**:
   - Write clear, concise commit messages following standard conventional commits (e.g., `feat: ...`, `fix: ...`, `docs: ...`).
   - Push directly to feature branch or `main` as instructed.
