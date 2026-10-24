/**
 * Pulse Metronome - Document Picture-in-Picture Mini Player Manager
 * Provides a floating, always-on-top mini metronome in the bottom-right corner,
 * complete with live BPM controls, animated beat pills, and play/pause toggle.
 * Supports Google Meet-style automatic pop-out on tab switch.
 */
class PipManager {
  constructor(options = {}) {
    this.engine = options.engine;
    this.onSetBpm = options.onSetBpm || (() => {});
    this.onTogglePlay = options.onTogglePlay || (() => {});

    this.pipWindow = null;
    this.autoPipEnabled = true;
    this.autoOpened = false;

    // Mini window DOM refs
    this.pipBpmVal = null;
    this.pipPlayBtn = null;
    this.pipPlayText = null;
    this.pipPlayIcon = null;
    this.pipPauseIcon = null;
    this.pipBeatTracker = null;

    this.init();
  }

  isSupported() {
    return 'documentPictureInPicture' in window;
  }

  init() {
    if (!this.isSupported()) {
      console.warn('Document Picture-in-Picture is not supported in this browser.');
      return;
    }

    this.setupMediaSession();
    this.setupVisibilityListener();
  }

  setupMediaSession() {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('enterpictureinpicture', async () => {
          if (this.autoPipEnabled && this.engine && this.engine.isPlaying && !this.isOpen()) {
            try {
              await this.open();
              this.autoOpened = true;
            } catch (err) {
              console.warn('MediaSession enterpictureinpicture error:', err);
            }
          }
        });
      } catch (err) {
        // Not all browsers support enterpictureinpicture action
      }
    }
  }

  setupVisibilityListener() {
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        // User switched away to another tab
        if (this.autoPipEnabled && this.engine && this.engine.isPlaying && !this.isOpen()) {
          try {
            await this.open();
            this.autoOpened = true;
          } catch (err) {
            // Browser might rely on MediaSession enterpictureinpicture
            console.log('Auto-PiP on tab switch waiting for MediaSession or gesture:', err);
          }
        }
      } else {
        // User returned to Pulse tab
        if (this.autoOpened && this.isOpen()) {
          this.close();
          this.autoOpened = false;
        }
      }
    });

    const onUserActive = () => {
      this.lastUserActive = Date.now();
    };
    window.addEventListener('pointerdown', onUserActive, { passive: true });
    window.addEventListener('keydown', onUserActive, { passive: true });
  }

  isOpen() {
    return !!(this.pipWindow && !this.pipWindow.closed);
  }

  async toggle() {
    if (this.isOpen()) {
      this.close();
    } else {
      await this.open();
    }
  }

  close() {
    if (this.pipWindow) {
      try {
        this.pipWindow.close();
      } catch (e) {}
      this.pipWindow = null;
    }
    this.updatePipButtonsState(false);
  }

  async open() {
    if (!this.isSupported() || this.isOpen()) return;

    try {
      this.pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 320,
        height: 250,
      });

      this.injectStyles();
      this.renderContent();
      this.bindEvents();
      this.syncState();
      this.updatePipButtonsState(true);

      this.pipWindow.addEventListener('pagehide', () => {
        this.pipWindow = null;
        this.autoOpened = false;
        this.updatePipButtonsState(false);
      });
      return this.pipWindow;
    } catch (err) {
      this.pipWindow = null;
      this.updatePipButtonsState(false);
      throw err;
    }
  }

  injectStyles() {
    if (!this.pipWindow) return;

    this.pipWindow.document.head.innerHTML = `
      <meta charset="utf-8">
      <title>Pulse Mini</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=JetBrains+Mono:wght@700;800&display=swap" rel="stylesheet">
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          user-select: none;
          -webkit-user-select: none;
        }
        body {
          background: #090b10;
          color: #f0f2f8;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 12px 14px;
          overflow: hidden;
        }
        .pip-header {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .pip-brand {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 0.82rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #fff;
        }
        .pip-brand svg {
          color: #ff4136;
        }
        .pip-body {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          margin: 4px 0;
        }
        .pip-bpm-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
        }
        .pip-step-btn {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: #141722;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #e0e4ee;
          font-size: 1.35rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .pip-step-btn:hover {
          background: #202534;
          border-color: rgba(255, 255, 255, 0.25);
          color: #fff;
          transform: scale(1.06);
        }
        .pip-step-btn:active {
          transform: scale(0.95);
        }
        .pip-bpm-wrap {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }
        .pip-bpm-val {
          font-family: 'JetBrains Mono', monospace;
          font-size: 2.7rem;
          font-weight: 800;
          color: #fff;
          line-height: 1;
          letter-spacing: -0.02em;
        }
        .pip-bpm-lbl {
          font-size: 0.7rem;
          font-weight: 700;
          color: #7b8296;
          letter-spacing: 0.05em;
        }
        .pip-beat-tracker {
          display: flex;
          gap: 6px;
          width: 100%;
          justify-content: center;
        }
        .pip-beat-pill {
          flex: 1;
          max-width: 60px;
          height: 26px;
          border-radius: 6px;
          background: #141722;
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #6d7589;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.78rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.08s ease, background 0.08s ease, border-color 0.08s ease;
        }
        .pip-beat-pill.active {
          background: #ff4136;
          border-color: #ff4136;
          color: #fff;
          box-shadow: 0 0 16px rgba(255, 65, 54, 0.65);
          transform: scale(1.08);
        }
        .pip-beat-pill.accent-beat.active {
          background: #ff5447;
          border-color: #ff5447;
          box-shadow: 0 0 22px rgba(255, 65, 54, 0.9);
        }
        .pip-footer {
          display: flex;
          justify-content: center;
        }
        .pip-play-btn {
          width: 100%;
          height: 40px;
          border-radius: 8px;
          background: #141722;
          border: 1px solid rgba(255, 65, 54, 0.4);
          color: #fff;
          font-size: 0.85rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s ease;
          box-shadow: 0 0 12px rgba(255, 65, 54, 0.15);
        }
        .pip-play-btn:hover {
          background: #1c2130;
          border-color: #ff4136;
          box-shadow: 0 0 18px rgba(255, 65, 54, 0.35);
          transform: translateY(-1px);
        }
        .pip-play-btn.playing {
          background: #ff4136;
          border-color: #ff4136;
          color: #fff;
          box-shadow: 0 0 25px rgba(255, 65, 54, 0.5);
        }
        .pip-play-btn.playing:hover {
          background: #ff574d;
        }
      </style>
    `;
  }

  renderContent() {
    if (!this.pipWindow) return;

    this.pipWindow.document.body.innerHTML = `
      <div class="pip-header">
        <div class="pip-brand">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="4" y1="9" x2="4" y2="15"></line>
            <line x1="8" y1="5" x2="8" y2="19"></line>
            <line x1="12" y1="2" x2="12" y2="22"></line>
            <line x1="16" y1="6" x2="16" y2="18"></line>
            <line x1="20" y1="10" x2="20" y2="14"></line>
          </svg>
          <span>Pulse</span>
        </div>
      </div>

      <div class="pip-body">
        <div class="pip-bpm-row">
          <button class="pip-step-btn" id="pip-minus" title="Decrease BPM (-5)">−</button>
          <div class="pip-bpm-wrap">
            <span class="pip-bpm-val" id="pip-bpm-val">90</span>
            <span class="pip-bpm-lbl">BPM</span>
          </div>
          <button class="pip-step-btn" id="pip-plus" title="Increase BPM (+5)">+</button>
        </div>

        <div class="pip-beat-tracker" id="pip-beat-tracker">
          <!-- Filled dynamically -->
        </div>
      </div>

      <div class="pip-footer">
        <button class="pip-play-btn" id="pip-play-btn">
          <svg class="pip-icon-play" id="pip-icon-play" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <polygon points="7 4 19 12 7 20 7 4"></polygon>
          </svg>
          <svg class="pip-icon-pause" id="pip-icon-pause" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="display:none;">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
          <span id="pip-play-text">PLAY</span>
        </button>
      </div>
    `;

    // Cache elements
    const doc = this.pipWindow.document;
    this.pipBpmVal = doc.getElementById('pip-bpm-val');
    this.pipBeatTracker = doc.getElementById('pip-beat-tracker');
    this.pipPlayBtn = doc.getElementById('pip-play-btn');
    this.pipPlayText = doc.getElementById('pip-play-text');
    this.pipPlayIcon = doc.getElementById('pip-icon-play');
    this.pipPauseIcon = doc.getElementById('pip-icon-pause');

    this.renderBeatPills();
  }

  renderBeatPills() {
    if (!this.pipBeatTracker || !this.engine) return;

    const beats = this.engine.beatsPerBar || 4;
    this.pipBeatTracker.innerHTML = '';

    for (let i = 1; i <= beats; i++) {
      const pill = this.pipWindow.document.createElement('div');
      pill.className = `pip-beat-pill ${i === 1 && this.engine.isAccentEnabled ? 'accent-beat' : ''}`;
      pill.dataset.beat = i;
      pill.textContent = i;
      this.pipBeatTracker.appendChild(pill);
    }
  }

  bindEvents() {
    if (!this.pipWindow) return;

    const doc = this.pipWindow.document;
    const minusBtn = doc.getElementById('pip-minus');
    const plusBtn = doc.getElementById('pip-plus');

    minusBtn?.addEventListener('click', (e) => {
      const step = e.shiftKey ? 1 : 5;
      this.onSetBpm((this.engine ? this.engine.bpm : 90) - step);
    });

    plusBtn?.addEventListener('click', (e) => {
      const step = e.shiftKey ? 1 : 5;
      this.onSetBpm((this.engine ? this.engine.bpm : 90) + step);
    });

    this.pipPlayBtn?.addEventListener('click', () => {
      this.onTogglePlay();
    });
  }

  syncState() {
    if (!this.isOpen() || !this.engine) return;

    this.updateBpm(this.engine.bpm);
    this.updateTimeSignature(this.engine.beatsPerBar);
    this.updatePlayState(this.engine.isPlaying);
  }

  updateBpm(bpm) {
    if (this.pipBpmVal) {
      this.pipBpmVal.textContent = bpm;
    }
  }

  updateTimeSignature(beats) {
    this.renderBeatPills();
  }

  updatePlayState(isPlaying) {
    if (!this.pipPlayBtn) return;

    this.pipPlayBtn.classList.toggle('playing', isPlaying);
    if (isPlaying) {
      this.pipPlayIcon.style.display = 'none';
      this.pipPauseIcon.style.display = 'block';
      this.pipPlayText.textContent = 'PAUSE';
    } else {
      this.pipPlayIcon.style.display = 'block';
      this.pipPauseIcon.style.display = 'none';
      this.pipPlayText.textContent = 'PLAY';
      this.clearBeatHighlight();
    }
  }

  onBeat(beatNumber, isAccent, isSecondaryAccent = false, holdMs = 120) {
    if (!this.isOpen() || !this.pipBeatTracker) return;

    if (this.pipHitTimeout) {
      clearTimeout(this.pipHitTimeout);
      this.pipHitTimeout = null;
    }

    const pills = this.pipBeatTracker.querySelectorAll('.pip-beat-pill');
    let activePill = null;
    pills.forEach((pill, idx) => {
      const isActive = idx === beatNumber - 1;
      pill.classList.toggle('active', isActive);
      pill.classList.toggle('accent-beat', isActive && (isAccent || isSecondaryAccent));
      if (isActive) {
        activePill = pill;
      }
    });

    if (activePill) {
      this.pipHitTimeout = setTimeout(() => {
        activePill.classList.remove('active');
        this.pipHitTimeout = null;
      }, holdMs);
    }
  }

  clearBeatHighlight() {
    if (this.pipHitTimeout) {
      clearTimeout(this.pipHitTimeout);
      this.pipHitTimeout = null;
    }
    if (!this.pipBeatTracker) return;
    this.pipBeatTracker.querySelectorAll('.pip-beat-pill').forEach((pill) => {
      pill.classList.remove('active');
    });
  }

  updatePipButtonsState(active) {
    const topPipBtn = document.getElementById('pip-toggle-btn');
    topPipBtn?.classList.toggle('active', active);
    if (topPipBtn) {
      topPipBtn.title = active ? 'Close Mini Metronome (P)' : 'Mini Metronome Pop-out (P)';
    }
  }
}

window.PipManager = PipManager;
