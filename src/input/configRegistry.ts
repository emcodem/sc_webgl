// =====================================================================
// ConfigRegistry — generic backbone for "control preset" persistence.
//
// Each input-config module (keybinds, joystick axis/button maps, mouse
// look settings, ...) registers itself here with a serialize/deserialize
// pair under its own key. Preset save/export bundles serializeAllConfig()
// into one JSON blob; preset load/import runs it back through
// deserializeAllConfig(). Neither side needs to know what the other config
// modules are — adding or removing a config item only touches the module
// that owns it.
//
// UI modules that display config state can subscribe via onConfigApplied
// to refresh themselves whenever a preset is loaded, without the preset
// UI needing to know they exist.
//
// Ported from the original project's input/configRegistry.ts — note there
// is deliberately no "always autosave every tweak" path here: persistence
// only happens through the named-preset system (input/presetStore.ts),
// matching the original exactly. A slider dragged without ever saving a
// preset does not survive a reload.
// =====================================================================

export interface ConfigEntry {
  key: string;
  serialize(): unknown;
  deserialize(data: unknown): void;
  // Optional: resets this module's own state to its built-in defaults. Not every module needs one
  // (e.g. scDevices is just auto-detected metadata), but any that has a real "default" should
  // provide it here rather than the "Reset to Sandbox Defaults" button hardcoding a list of
  // per-module reset calls -- that list silently goes stale every time a new config module is
  // added (this is exactly how the button ended up only resetting keybinds and nothing else).
  resetToDefault?(): void;
}

const registry: ConfigEntry[] = [];
const applyListeners: Array<() => void> = [];

export function registerConfig(entry: ConfigEntry): void {
  registry.push(entry);
}

export function onConfigApplied(fn: () => void): void {
  applyListeners.push(fn);
}

export function serializeAllConfig(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of registry) out[entry.key] = entry.serialize();
  return out;
}

export function deserializeAllConfig(data: Record<string, unknown> | null | undefined): void {
  if (data) {
    for (const entry of registry) {
      if (Object.prototype.hasOwnProperty.call(data, entry.key)) entry.deserialize(data[entry.key]);
    }
  }
  applyListeners.forEach(fn => fn());
}

// Resets every registered module that provides a resetToDefault (silently skips ones that don't --
// e.g. joystickMap's scDevices is detected metadata, not a "setting" with a default), then refreshes
// the UI the same way a preset load does.
export function resetAllToDefault(): void {
  for (const entry of registry) entry.resetToDefault?.();
  applyListeners.forEach(fn => fn());
}
