// A Controls-panel slider paired with an editable number box and an inline out-of-range warning.
// Dragging the slider applies live; the box applies on change (blur/Enter) but only within the valid
// range — otherwise it flags the box red and shows a warning without applying. Used by every slider
// in the F4 panel (mouseSettingsUI.ts, espSettingsUI.ts).
//
// `min`/`max` are the valid range in DISPLAY units (what the slider/box show); toDisplay/fromDisplay
// convert to the stored units when they differ (e.g. deadzone shows a 0-20 % but stores a 0-1 fraction).

export interface NumericControlConfig {
  sliderId: string;
  numId: string;
  warnId: string;
  min: number;
  max: number;
  decimals: number;
  get: () => number;
  set: (stored: number) => void;
  toDisplay?: (stored: number) => number;
  fromDisplay?: (display: number) => number;
}

const input = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const identity = (v: number) => v;

function displayOf(c: NumericControlConfig): number {
  return (c.toDisplay ?? identity)(c.get());
}

function setWarning(c: NumericControlConfig, message: string): void {
  const warn = document.getElementById(c.warnId);
  const num = input(c.numId);
  if (warn) warn.textContent = message;
  if (num) num.classList.toggle('invalid', message !== '');
}

// Push the current model value into both the slider and the box, and clear any warning. Call on
// startup and whenever a control preset is applied.
export function syncNumericControl(c: NumericControlConfig): void {
  const d = displayOf(c);
  const slider = input(c.sliderId);
  const num = input(c.numId);
  if (slider) slider.value = String(d);
  if (num) num.value = d.toFixed(c.decimals);
  setWarning(c, '');
}

// Attach the slider/box listeners (call once) and do an initial sync.
export function wireNumericControl(c: NumericControlConfig): void {
  const slider = input(c.sliderId);
  const num = input(c.numId);
  if (!slider || !num) return;
  const fromDisplay = c.fromDisplay ?? identity;

  // Dragging the slider is always in-range: apply live, mirror into the box.
  slider.addEventListener('input', () => {
    const display = parseFloat(slider.value);
    c.set(fromDisplay(display));
    num.value = display.toFixed(c.decimals);
    setWarning(c, '');
  });

  // The box applies on change (blur/Enter), only within the valid range; otherwise warn and don't
  // apply (the typed text stays, flagged red, so the user can correct it).
  num.addEventListener('change', () => {
    const display = parseFloat(num.value);
    if (!Number.isFinite(display) || display < c.min || display > c.max) {
      setWarning(c, `Enter a value between ${c.min} and ${c.max}`);
      return;
    }
    const rounded = Number(display.toFixed(c.decimals)); // keep model == shown at the control's precision
    c.set(fromDisplay(rounded));
    slider.value = String(rounded);
    num.value = rounded.toFixed(c.decimals);
    setWarning(c, '');
  });

  syncNumericControl(c);
}
