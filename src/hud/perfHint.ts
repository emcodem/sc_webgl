import { getFps } from './fpsTracker';

// One-time dismissible hint for GitHub issue #1: Chrome's frame rate can get halved to ~30fps
// while windowed and a screen-capture tool (OBS's Desktop Duplication source) is attached — a
// Windows-compositor behavior no Web API can detect or fix from inside the page. The only
// available signal is the symptom itself: a sustained, suspiciously capped FPS while NOT
// fullscreen (fullscreen bypasses the multi-consumer DWM path entirely, per the issue's findings).
const LOW_FPS_MIN = 24;
const LOW_FPS_MAX = 36;
const SUSTAINED_SEC = 4;
const DISMISS_KEY = 'vector_perfhint_dismissed';

let sustainedLowSec = 0;
let dismissed = false;
try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* storage unavailable */ }

let el: HTMLElement | null = null;
let wired = false;

function wire(): void {
  if (wired) return;
  wired = true;
  el = document.getElementById('perf-hint');
  const dismissBtn = document.getElementById('perf-hint-dismiss');
  dismissBtn?.addEventListener('click', () => {
    dismissed = true;
    if (el) el.style.display = 'none';
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable */ }
  });
}

export function updatePerfHint(dtSec: number): void {
  if (dismissed) return;
  wire();
  if (!el) return;

  const fullscreen = document.fullscreenElement != null;
  const fps = getFps();
  const suspicious = !fullscreen && fps >= LOW_FPS_MIN && fps <= LOW_FPS_MAX;
  sustainedLowSec = suspicious ? sustainedLowSec + dtSec : 0;

  if (sustainedLowSec >= SUSTAINED_SEC) el.style.display = '';
}
