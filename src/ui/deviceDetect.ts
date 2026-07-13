// Ported from the original project's ui/deviceDetect.ts.

// 'ontouchstart' in window / navigator.maxTouchPoints only report touch CAPABILITY, which Firefox
// on Windows sets true for any touch-capable display (touchscreen laptops/monitors) even when the
// user is flying with a mouse. pointer/hover reflect the PRIMARY input mechanism instead: a
// touchscreen laptop still reports hover:hover (mouse/trackpad is primary), while phones/tablets
// with no attached pointer report hover:none. (Unused by this project — no touch-control UI yet —
// kept for parity and because any future touch layer would need exactly this check.)
export function isTouchPrimary(): boolean {
  return window.matchMedia('(pointer: coarse) and (hover: none)').matches;
}

export function isFirefox(): boolean {
  return navigator.userAgent.includes('Firefox');
}

// Chromium-based (Chrome, Edge, Brave, …). Used to warn about vJoy: Chromium doesn't report vJoy
// axis input (it reads zero), whereas Firefox reads it fine — see joystickDetectionUI.
export function isChromium(): boolean {
  return /Chrome|Chromium|Edg/.test(navigator.userAgent) && !isFirefox();
}
