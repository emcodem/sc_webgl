// Rolling FPS estimate for the stats panel. Fed the unclamped (pre-50ms-clamp) frame delta from
// main.ts's loop() every frame — the clamped dt used for sim integration would silently floor the
// displayed number at 20fps, which defeats the point of a performance readout. Smoothed with an
// exponential moving average so it reads as a stable number rather than jittering every frame.
// Lives in its own module (rather than main.ts exporting it directly) so hud.ts can read it
// without an import cycle with main.ts.
const EMA_ALPHA = 0.1;
let fps = 0;

export function sampleFrame(rawDtSec: number): void {
  if (rawDtSec <= 0) return;
  const instFps = 1 / rawDtSec;
  fps = fps === 0 ? instFps : fps + EMA_ALPHA * (instFps - fps);
}

export function getFps(): number {
  return fps;
}
