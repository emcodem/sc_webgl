// TEMPORARY DEBUG PANEL — for tuning the starfield's magnitude range live instead of edit/reload/
// eyeball. Remove this file and its one call site in main.ts once the starfield is dialed in.
import type { Renderer } from './renderer';

const DEFAULT_BRIGHTEST = -1.5;
const DEFAULT_FAINTEST = 8.0;

export function initStarDebugPanel(renderer: Renderer): void {
  const panel = document.createElement('div');
  panel.id = 'star-debug-panel';
  panel.style.cssText = `
    position: fixed; bottom: 12px; right: 12px; z-index: 1000;
    background: rgba(10,14,20,0.88); border: 1px solid #3a4a5a; border-radius: 4px;
    padding: 10px 12px; font: 11px monospace; color: #cfe8ff; width: 230px;
  `;
  panel.innerHTML = `
    <div style="margin-bottom:8px; color:#8fd3ff;">STAR DEBUG (temporary)</div>
    <label>Brightest mag: <span id="sdp-bright-val">${DEFAULT_BRIGHTEST.toFixed(1)}</span></label>
    <input type="range" id="sdp-bright" min="-3" max="4" step="0.1" value="${DEFAULT_BRIGHTEST}" style="width:100%">
    <label style="margin-top:8px; display:block">Faintest mag (cutoff): <span id="sdp-faint-val">${DEFAULT_FAINTEST.toFixed(1)}</span></label>
    <input type="range" id="sdp-faint" min="0" max="8" step="0.1" value="${DEFAULT_FAINTEST}" style="width:100%">
  `;
  document.body.appendChild(panel);

  const brightInput = panel.querySelector('#sdp-bright') as HTMLInputElement;
  const faintInput = panel.querySelector('#sdp-faint') as HTMLInputElement;
  const brightVal = panel.querySelector('#sdp-bright-val') as HTMLSpanElement;
  const faintVal = panel.querySelector('#sdp-faint-val') as HTMLSpanElement;

  const apply = (): void => {
    const magBrightest = parseFloat(brightInput.value);
    const magFaintest = parseFloat(faintInput.value);
    brightVal.textContent = magBrightest.toFixed(1);
    faintVal.textContent = magFaintest.toFixed(1);
    renderer.setStarfieldRange(magBrightest, magFaintest);
  };
  brightInput.addEventListener('input', apply);
  faintInput.addEventListener('input', apply);
}
