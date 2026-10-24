/**
 * Pulse Metronome Controller — Pure Minimalist Edition
 * High-precision sample-accurate audio + 1 2 3 4 Beat Tracker
 */
document.addEventListener('DOMContentLoaded', () => {
  const engine = new MetronomeAudioEngine();
  const bgPath = window.location.pathname.includes('/frontend') ? '../media/pulse-bg.jpg' : 'media/pulse-bg.jpg';
  const waterCinemagraph = window.WaterCinemagraph ? new WaterCinemagraph('water-canvas', bgPath) : null;

  // Central Hero Elements
  const heroBpmDisplay = document.getElementById('hero-bpm-display');
  const dialProgress = document.getElementById('dial-progress');
  const dialDotWrapper = document.getElementById('dial-dot-wrapper');
  const pendulumNeedle = document.getElementById('pendulum-needle');
  const beatTracker = document.getElementById('beat-tracker');
  const sigHeroVal = document.getElementById('sig-hero-val');

  // Transport Controls
  const playBtn = document.getElementById('play-btn');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const bpmMinusBtn = document.getElementById('bpm-minus-btn');
  const bpmPlusBtn = document.getElementById('bpm-plus-btn');

  // Right Control Sidebar Elements
  const stepMinus = document.getElementById('step-minus');
  const stepPlus = document.getElementById('step-plus');
  const bpmInput = document.getElementById('bpm-input');
  const bpmSlider = document.getElementById('bpm-slider');
  const timeSigChips = document.getElementById('time-sig-chips');
  const soundGrid = document.getElementById('sound-grid');
  const volSlider = document.getElementById('vol-slider');
  const boostReadout = document.getElementById('boost-readout');
  const accentSegmented = document.getElementById('accent-segmented');
  const strobe = document.getElementById('strobe');

  // Mini Player (PiP) Controls
  const pipToggleBtn = document.getElementById('pip-toggle-btn');

  // Sidebar Controls
  const appLayout = document.querySelector('.app-layout');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const floatingSidebarTab = document.getElementById('floating-sidebar-tab');

  let needleDirection = 1;
  let pillHitTimeout = null;
  let pendulumTimeout = null;
  let strobeTimeout = null;
  const tapTimes = [];

  function clearVisualTimeouts() {
    if (pillHitTimeout) {
      clearTimeout(pillHitTimeout);
      pillHitTimeout = null;
    }
    if (pendulumTimeout) {
      clearTimeout(pendulumTimeout);
      pendulumTimeout = null;
    }
    if (strobeTimeout) {
      clearTimeout(strobeTimeout);
      strobeTimeout = null;
    }
  }

  // Initialize PipManager
  const pipManager = window.PipManager ? new PipManager({
    engine,
    onSetBpm: (newBpm) => setBpm(newBpm),
    onTogglePlay: () => togglePlay()
  }) : null;

  // Set BPM in all places
  function setBpm(val) {
    const clamped = Math.max(30, Math.min(300, Math.round(val)));
    engine.setBpm(clamped);
    heroBpmDisplay.textContent = clamped;
    bpmInput.value = clamped;
    bpmSlider.value = clamped;

    updateDialVisuals(clamped);
    pipManager?.updateBpm(clamped);
  }

  function updateDialVisuals(bpm) {
    const circumference = 691.15;
    const ratio = (bpm - 30) / (300 - 30);
    const offset = circumference * (1 - ratio);
    dialProgress.style.strokeDashoffset = offset;

    const degrees = ratio * 360;
    dialDotWrapper.style.transform = `rotate(${degrees}deg)`;
  }

  // Render 1 2 3 4 Beat Tracker
  function renderBeatTracker(beats) {
    beatTracker.innerHTML = '';
    for (let i = 1; i <= beats; i++) {
      const pill = document.createElement('div');
      pill.className = 'beat-pill';
      pill.id = `beat-${i}`;
      pill.dataset.beat = i;

      const num = document.createElement('span');
      num.className = 'pill-num';
      num.textContent = i;
      pill.appendChild(num);

      beatTracker.appendChild(pill);
    }
  }

  // Audio-Synchronized Beat Indicator (Driven by hardware-locked requestAnimationFrame queue)
  engine.onBeat = (beatNumber, isAccent, audioTime, totalBeats, beatInfo = {}) => {
    if (!engine.audioCtx || !engine.isPlaying) return;

    clearVisualTimeouts();

    const beatDurationMs = beatInfo.beatDurationMs || (engine.getSecondsPerBeat() * 1000);
    const pillHoldMs = Math.min(150, Math.max(40, Math.round(beatDurationMs * 0.55)));
    const pendulumReturnMs = Math.min(120, Math.max(35, Math.round(beatDurationMs * 0.45)));
    const transitionMs = Math.min(95, Math.max(28, Math.round(beatDurationMs * 0.36)));
    const strobeHoldMs = Math.min(90, Math.max(28, Math.round(beatDurationMs * 0.35)));
    const isSecondaryAccent = Boolean(beatInfo.isSecondaryAccent);

    // 1. Highlight the active beat pill
    const pills = beatTracker.querySelectorAll('.beat-pill');
    let activePill = null;
    pills.forEach(pill => {
      const pillBeat = parseInt(pill.dataset.beat, 10);
      if (pillBeat === beatNumber) {
        pill.classList.add('hit');
        activePill = pill;
      } else {
        pill.classList.remove('hit');
      }
    });
    if (activePill) {
      pillHitTimeout = setTimeout(() => {
        activePill.classList.remove('hit');
        pillHitTimeout = null;
      }, pillHoldMs);
    }

    // 2. Animate pendulum needle with tempo-adaptive physics
    needleDirection = -needleDirection;
    const swingAngle = isAccent ? 24 * needleDirection : (isSecondaryAccent ? 20 * needleDirection : 16 * needleDirection);
    const scaleVal = isAccent ? 1.15 : (isSecondaryAccent ? 1.07 : 1.0);
    pendulumNeedle.style.transitionDuration = `${transitionMs}ms`;
    pendulumNeedle.style.transform = `rotate(${swingAngle}deg) scale(${scaleVal})`;
    pendulumTimeout = setTimeout(() => {
      pendulumNeedle.style.transform = `rotate(${swingAngle * 0.3}deg) scale(1.0)`;
      pendulumTimeout = null;
    }, pendulumReturnMs);

    // 3. Screen Flash on accented downbeat
    if (isAccent) {
      strobe.classList.remove('flash-beat');
      strobe.classList.add('flash-one');
      strobeTimeout = setTimeout(() => {
        strobe.classList.remove('flash-one');
        strobeTimeout = null;
      }, strobeHoldMs);
    } else {
      strobe.classList.remove('flash-one', 'flash-beat');
    }

    // 4. Subtle beat resonance on living water cinemagraph
    if (waterCinemagraph) {
      waterCinemagraph.pulseBeat(isAccent || isSecondaryAccent);
    }

    // 5. Sync PiP Mini Player beat tracker
    pipManager?.onBeat(beatNumber, isAccent, isSecondaryAccent, pillHoldMs);
  };

  // Play / Pause Toggle
  function togglePlay() {
    if (engine.isPlaying) {
      engine.stop();
      clearVisualTimeouts();
      playBtn.classList.remove('playing');
      iconPlay.style.display = 'block';
      iconPause.style.display = 'none';
      pendulumNeedle.style.transform = 'rotate(0deg)';
      strobe.classList.remove('flash-one', 'flash-beat');
      beatTracker.querySelectorAll('.beat-pill').forEach(p => p.classList.remove('hit'));
      pipManager?.updatePlayState(false);
    } else {
      engine.start();
      playBtn.classList.add('playing');
      iconPlay.style.display = 'none';
      iconPause.style.display = 'block';
      pipManager?.updatePlayState(true);
    }
  }

  playBtn.addEventListener('click', togglePlay);

  // Steppers & Sliders
  bpmSlider.addEventListener('input', () => setBpm(parseInt(bpmSlider.value, 10)));
  bpmInput.addEventListener('change', () => setBpm(parseInt(bpmInput.value, 10) || 90));

  stepMinus.addEventListener('click', () => setBpm(engine.bpm - 1));
  stepPlus.addEventListener('click', () => setBpm(engine.bpm + 1));
  bpmMinusBtn.addEventListener('click', () => setBpm(engine.bpm - 5));
  bpmPlusBtn.addEventListener('click', () => setBpm(engine.bpm + 5));

  // Time Signatures
  timeSigChips.querySelectorAll('.chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      timeSigChips.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');

      const sig = btn.dataset.sig;
      sigHeroVal.textContent = sig.replace('/', ' / ');
      const [beatsStr, noteValStr] = sig.split('/');
      const beats = parseInt(beatsStr, 10);
      const noteValue = parseInt(noteValStr, 10) || 4;
      clearVisualTimeouts();
      engine.setTimeSignature(beats, noteValue);
      renderBeatTracker(beats);
      pipManager?.updateTimeSignature(beats);
    });
  });

  // Sound Engine
  soundGrid.querySelectorAll('.sound-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      soundGrid.querySelectorAll('.sound-btn').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      engine.setSoundType(btn.dataset.sound);
    });
  });

  // Volume Boost Slider
  volSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    engine.setVolume(val);
    boostReadout.textContent = `${val}% BOOST`;
  });

  // Accent Switch
  if (accentSegmented) {
    accentSegmented.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        accentSegmented.querySelectorAll('.seg-btn').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        engine.setAccentEnabled(btn.dataset.accent === 'on');
        pipManager?.updateTimeSignature(engine.beatsPerBar);
      });
    });
  }

  // Mini Player (Picture-in-Picture) Button Bindings
  pipToggleBtn?.addEventListener('click', () => pipManager?.toggle());

  // Sidebar Toggle Logic
  function toggleSidebar(forceState) {
    if (!appLayout) return;
    const isCollapsed = appLayout.classList.contains('sidebar-collapsed');
    const targetState = typeof forceState === 'boolean' ? forceState : !isCollapsed;
    appLayout.classList.toggle('sidebar-collapsed', targetState);
    if (sidebarToggleBtn) {
      sidebarToggleBtn.title = targetState ? 'Show Sidebar (H)' : 'Hide Sidebar (H)';
      sidebarToggleBtn.setAttribute('aria-expanded', !targetState);
    }
  }

  sidebarToggleBtn?.addEventListener('click', () => toggleSidebar());
  sidebarCloseBtn?.addEventListener('click', () => toggleSidebar(true));
  floatingSidebarTab?.addEventListener('click', () => toggleSidebar(false));

  // High-Precision Tap Tempo (KeyT)
  function handleTapTempo() {
    const now = performance.now();
    if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > 2500) {
      tapTimes.length = 0;
    }
    tapTimes.push(now);
    if (tapTimes.length > 6) {
      tapTimes.shift();
    }
    if (tapTimes.length >= 2) {
      let totalInterval = 0;
      for (let i = 1; i < tapTimes.length; i++) {
        totalInterval += (tapTimes[i] - tapTimes[i - 1]);
      }
      const avgIntervalMs = totalInterval / (tapTimes.length - 1);
      if (avgIntervalMs > 0) {
        setBpm(60000 / avgIntervalMs);
      }
    }
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'KeyH') {
      e.preventDefault();
      toggleSidebar();
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      pipManager?.toggle();
    } else if (e.code === 'KeyT') {
      e.preventDefault();
      handleTapTempo();
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      setBpm(engine.bpm + (e.shiftKey ? 5 : 1));
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      setBpm(engine.bpm - (e.shiftKey ? 5 : 1));
    }
  });

  // Expose global methods for testing & control
  window.__pulseEngine = engine;
  window.__setBpm = setBpm;
  window.__togglePlay = togglePlay;
  window.__toggleSidebar = toggleSidebar;
  window.__pipManager = pipManager;
  window.__waterCinemagraph = waterCinemagraph;

  // Ensure the main stage never scrolls or rubber-bands
  const mainStage = document.querySelector('.main-stage');
  if (mainStage) {
    mainStage.addEventListener('wheel', (e) => {
      e.preventDefault();
    }, { passive: false });
  }

  // Initial setup: 90 BPM, 4/4
  setBpm(90);
  renderBeatTracker(4);
});
