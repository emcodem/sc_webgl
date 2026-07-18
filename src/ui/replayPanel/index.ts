import type { World } from '../../core/world';
import { resetWorld } from '../../core/player';
import * as Recorder from '../../replay/recorder';
import * as ReplayPlayer from '../../replay/player';
import * as ReplayIO from '../../replay/io';
import type { ReplayClip } from '../../replay/types';
import * as FreeCamera from '../../control/freeCamera';
import { computeAxes } from '../../math/quaternion';

// ============================================================================================
// F6 flight recorder panel — recording controls + clip management (modal, pauses the sim while
// open, same convention as ui/mainMenu.ts's F3 overlay), plus a non-modal playback transport bar
// shown whenever a clip is loaded (see ui/index.ts's isPaused(), which now also checks
// isReplayPanelOpen() below). See replay/recorder.ts (the always-on rolling buffer + manual
// recording) and replay/player.ts (interpolated playback over the live World/renderer/HUD).
// ============================================================================================

let open = false;
let world: World;
let lastClip: ReplayClip | null = null;

export function isReplayPanelOpen(): boolean {
  return open;
}

const WINDOW_OPTIONS: { label: string; sec: number }[] = [
  { label: '2 min', sec: 120 },
  { label: '5 min', sec: 300 },
  { label: '10 min', sec: 600 }
];
const SAVE_OPTIONS_SEC = [10, 30, 60];

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function initReplayPanel(w: World): void {
  world = w;

  const overlay = document.getElementById('replay-panel-overlay') as HTMLElement;
  const closeBtn = document.getElementById('replay-panel-close-btn') as HTMLElement;
  const toggleBtn = document.getElementById('replay-toggle') as HTMLElement;
  const windowButtonsEl = document.getElementById('replay-window-buttons') as HTMLElement;
  const bufferStatusEl = document.getElementById('replay-buffer-status') as HTMLElement;
  const recordBtn = document.getElementById('replay-record-btn') as HTMLButtonElement;
  const recordStatusEl = document.getElementById('replay-record-status') as HTMLElement;
  const saveButtonsEl = document.getElementById('replay-save-buttons') as HTMLElement;
  const playBtn = document.getElementById('replay-play-btn') as HTMLButtonElement;
  const exportBtn = document.getElementById('replay-export-btn') as HTMLButtonElement;
  const importBtn = document.getElementById('replay-import-btn') as HTMLElement;
  const importInput = document.getElementById('replay-import-input') as HTMLInputElement;
  const clipStatusEl = document.getElementById('replay-clip-status') as HTMLElement;

  const transport = document.getElementById('replay-transport') as HTMLElement;
  const transportPlayPause = document.getElementById('replay-transport-playpause') as HTMLButtonElement;
  const transportScrub = document.getElementById('replay-transport-scrub') as HTMLInputElement;
  const transportTime = document.getElementById('replay-transport-time') as HTMLElement;
  const transportSpeed = document.getElementById('replay-transport-speed') as HTMLSelectElement;
  const transportFreecam = document.getElementById('replay-transport-freecam') as HTMLButtonElement;
  const transportExit = document.getElementById('replay-transport-exit') as HTMLButtonElement;

  function refreshPanel(): void {
    recordBtn.textContent = Recorder.isManualRecording() ? '■ Stop Recording' : '● Start Recording';
    recordStatusEl.textContent = Recorder.isManualRecording()
      ? `Recording — ${fmtTime(Recorder.manualRecordingElapsedSec())} elapsed`
      : '';
    bufferStatusEl.textContent =
      `${fmtTime(Recorder.availableSeconds())} available in the rolling buffer (window: ${fmtTime(Recorder.getRollingWindowSec())}).`;
    playBtn.disabled = !lastClip;
    exportBtn.disabled = !lastClip;
  }

  windowButtonsEl.innerHTML = '';
  for (const opt of WINDOW_OPTIONS) {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    if (Recorder.getRollingWindowSec() === opt.sec) btn.classList.add('on');
    btn.addEventListener('click', () => {
      Recorder.setRollingWindowSec(opt.sec);
      windowButtonsEl.querySelectorAll('button').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      refreshPanel();
    });
    windowButtonsEl.appendChild(btn);
  }

  saveButtonsEl.innerHTML = '';
  for (const sec of SAVE_OPTIONS_SEC) {
    const btn = document.createElement('button');
    btn.textContent = `Last ${sec}s`;
    btn.addEventListener('click', () => {
      const clip = Recorder.saveLastNSeconds(sec);
      if (!clip) { clipStatusEl.textContent = 'Nothing recorded yet.'; return; }
      lastClip = clip;
      clipStatusEl.textContent = `Grabbed the last ${sec}s (${clip.frames.length} samples).`;
      refreshPanel();
    });
    saveButtonsEl.appendChild(btn);
  }

  function hide(): void {
    open = false;
    overlay.style.display = 'none';
  }
  function show(): void {
    open = true;
    overlay.style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
    refreshPanel();
  }
  function toggle(): void {
    if (open) hide(); else show();
  }

  toggleBtn.addEventListener('click', toggle);
  closeBtn.addEventListener('click', hide);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F6') { e.preventDefault(); toggle(); }
    else if (e.code === 'Escape' && open) hide();
  });

  recordBtn.addEventListener('click', () => {
    if (Recorder.isManualRecording()) {
      const clip = Recorder.stopManualRecording();
      if (clip) {
        lastClip = clip;
        clipStatusEl.textContent = `Recorded ${fmtTime(clip.frames[clip.frames.length - 1].simTime)} (${clip.frames.length} samples).`;
      } else {
        clipStatusEl.textContent = 'Nothing was captured during that recording.';
      }
    } else {
      Recorder.startManualRecording();
    }
    refreshPanel();
  });

  playBtn.addEventListener('click', () => {
    if (!lastClip) return;
    ReplayPlayer.loadClip(world, lastClip);
    hide();
  });

  exportBtn.addEventListener('click', () => {
    if (!lastClip) return;
    ReplayIO.exportClip(lastClip).then(() => { clipStatusEl.textContent = 'Exported.'; });
  });

  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    ReplayIO.importClipFromFile(file).then(
      (loadedClip) => {
        lastClip = loadedClip;
        clipStatusEl.textContent = `Loaded "${file.name}" (${loadedClip.frames.length} samples).`;
        refreshPanel();
      },
      (err: Error) => { clipStatusEl.textContent = err.message; }
    );
  });

  // ---- non-modal transport bar, driven every frame via tickReplayPanelUI() below ----
  transportPlayPause.addEventListener('click', () => {
    if (ReplayPlayer.isPlaying()) ReplayPlayer.pause(); else ReplayPlayer.play();
  });
  transportScrub.addEventListener('input', () => {
    const frac = Number(transportScrub.value) / 1000;
    ReplayPlayer.seek(frac * ReplayPlayer.getDurationSec());
  });
  transportSpeed.addEventListener('change', () => {
    ReplayPlayer.setSpeed(Number(transportSpeed.value));
  });
  transportFreecam.addEventListener('click', () => {
    if (FreeCamera.isActive()) {
      FreeCamera.disable();
    } else {
      // Start a short distance behind the ship (along its own forward axis) and above it in WORLD
      // space (+Y, matching control/freeCamera.ts's own world-up movement convention — the ship's
      // own "up" axis is inverted relative to world +Y in this project's convention, see CLAUDE.md,
      // and would be the wrong direction to use here), aimed back at the ship rather than its exact
      // origin — starting there would put the camera inside the hull, at the cockpit position.
      const ship = world.player.ship;
      const forward = computeAxes(ship.quat).forward;
      const startPos = {
        x: ship.pos.x - forward.x * 40,
        y: ship.pos.y - forward.y * 40 + 15,
        z: ship.pos.z - forward.z * 40
      };
      FreeCamera.enable(startPos, ship.pos);
    }
    transportFreecam.classList.toggle('on', FreeCamera.isActive());
  });
  transportExit.addEventListener('click', () => {
    ReplayPlayer.stop();
    FreeCamera.disable(); // don't leave the spectator camera active over live flight
    transportFreecam.classList.remove('on');
    resetWorld(world);
    transport.style.display = 'none';
  });

  tickFn = () => {
    if (!ReplayPlayer.isActive()) {
      transport.style.display = 'none';
      return;
    }
    transport.style.display = 'flex';
    transportPlayPause.textContent = ReplayPlayer.isPlaying() ? '⏸' : '▶';
    const duration = ReplayPlayer.getDurationSec();
    const t = ReplayPlayer.getClockSec();
    transportTime.textContent = `${fmtTime(t)} / ${fmtTime(duration)}`;
    // don't fight the user while they're actively dragging the scrub handle
    if (document.activeElement !== transportScrub) {
      transportScrub.value = duration > 0 ? String(Math.round((t / duration) * 1000)) : '0';
    }
  };
}

let tickFn: () => void = () => {};

// Called once per frame from main.ts (unconditionally, like updateHUD) to keep the non-modal
// transport bar in sync with playback state.
export function tickReplayPanelUI(): void {
  tickFn();
}
