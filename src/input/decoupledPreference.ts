// Persists the decoupled-flight toggle (C key / HUD click) across reloads — same
// try/catch-wrapped localStorage pattern as hud/perfHint.ts's dismiss flag.
const DECOUPLED_KEY = 'vector_decoupled';

export function loadDecoupledPreference(): boolean {
  try { return localStorage.getItem(DECOUPLED_KEY) === '1'; } catch { return false; }
}

export function saveDecoupledPreference(decoupled: boolean): void {
  try { localStorage.setItem(DECOUPLED_KEY, decoupled ? '1' : '0'); } catch { /* storage unavailable */ }
}
