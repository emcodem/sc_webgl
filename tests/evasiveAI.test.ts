import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshCapacitors, freshCapacitorCooldowns } from '../src/combat/weapons';
import { EVASIVE_TUNING, evasiveThink } from '../src/combat/ai/evasiveAI';
import { createHealth } from '../src/combat/health';
import { getShipType } from '../src/physics/ships';
import type { EnemyShip, ShipBody } from '../src/core/world';
import type { EvasiveAIMemory } from '../src/core/types';

const TYPE = getShipType('Gladius');
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

function makeEnemy(pos = { x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance }, vel = ZERO): EnemyShip {
  return {
    type: TYPE, pos, vel, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0, throttleSpoolTime: 0, verticalSpoolTime: 0,
    health: createHealth(10), behavior: 'evasive', fireCooldown: 0,
    weaponCapacitors: freshCapacitors(TYPE.weaponType), weaponCapacitorCooldownTimers: freshCapacitorCooldowns(), respawnTimer: 0,
    spawnPos: pos, spawnQuat: IDENTITY
  };
}
function makePlayer(vel = ZERO): ShipBody {
  return {
    type: TYPE, pos: ZERO, vel, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, decoupled: false, spaceBrakeOn: false, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), hitFlash: 0, fireCooldown: 0,
    weaponCapacitors: freshCapacitors(TYPE.weaponType), weaponCapacitorCooldownTimers: freshCapacitorCooldowns(),
    respawnTimer: 0
  };
}
function makeAI(overrides: Partial<EvasiveAIMemory> = {}): EvasiveAIMemory {
  return {
    jinkStrafeX: 0, jinkStrafeY: 0, jinkFwd: 0, jinkReplanTimer: 999,
    mode: 'block', modeTimer: 0, wasThreatened: false, ...overrides
  };
}

// Enemy exactly at standoff distance dead ahead, matching player velocity along the same axis, so
// the forward-axis deficit collapses to exactly |playerSpeed - enemySpeed| (forwardShortfall/
// lateral/vertical all zero) — lets tests pick a precise deficit without hand-deriving the full formula.
function withPlayerSpeed(speed: number): { enemy: EnemyShip; player: ShipBody } {
  return { enemy: makeEnemy(), player: makePlayer({ x: 0, y: 0, z: speed }) };
}

describe('evasiveThink — unified forward/lateral/vertical bias servo', () => {
  it('commands positive (closing) throttle when the enemy has fallen behind the standoff point', () => {
    // player cruising fast, enemy not yet matching that speed -> needs to accelerate forward to keep
    // its 50m-ahead station -> throttle should be strongly positive (closing/main thrust)
    const { enemy, player } = withPlayerSpeed(120);
    const ai = makeAI();
    const decision = evasiveThink(enemy, ai, player, 0.1, false);
    expect(decision.inputs.throttle).toBeGreaterThan(0.5);
  });

  it('commands negative (opening) throttle when the enemy has overshot ahead of the standoff point', () => {
    // enemy well past the standoff distance, player stationary -> needs to fall back -> throttle
    // should be strongly negative (retro thrust)
    const enemy = makeEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance + 200 });
    const player = makePlayer();
    const ai = makeAI();
    const decision = evasiveThink(enemy, ai, player, 0.1, false);
    expect(decision.inputs.throttle).toBeLessThan(-0.5);
  });

  it('always steers the nose toward the player (aimDir), regardless of the forward deficit', () => {
    // large forward deficit used to swing the nose away to 'chase' — it should never do that now
    const { enemy, player } = withPlayerSpeed(500);
    const ai = makeAI();
    const decision = evasiveThink(enemy, ai, player, 0.1, false);
    const toEnemy = { x: enemy.pos.x - player.pos.x, y: enemy.pos.y - player.pos.y, z: enemy.pos.z - player.pos.z };
    const mag = Math.hypot(toEnemy.x, toEnemy.y, toEnemy.z);
    expect(decision.aimDir.x).toBeCloseTo(-toEnemy.x / mag, 5);
    expect(decision.aimDir.y).toBeCloseTo(-toEnemy.y / mag, 5);
    expect(decision.aimDir.z).toBeCloseTo(-toEnemy.z / mag, 5);
  });

  it('suppresses the MPC bank/forward bias once beyond maxRangeM, leaving only the baseline correction', () => {
    // enemy drifted far sideways (the common way distance actually grows — forward is tightly
    // servo-held continuously) with a committed bias fighting the recovery in every axis
    const enemy = makeEnemy({ x: EVASIVE_TUNING.maxRangeM + 50, y: 0, z: EVASIVE_TUNING.standoffDistance });
    const player = makePlayer();
    const withBias = evasiveThink(enemy, makeAI({ jinkStrafeX: -1, jinkStrafeY: 1, jinkFwd: -1 }), player, 0.1, false);
    const noBias = evasiveThink(enemy, makeAI({ jinkStrafeX: 1, jinkStrafeY: -1, jinkFwd: 1 }), player, 0.1, false);
    // whatever the committed bias was, the overRange override should produce the SAME baseline-only
    // correction — i.e. the committed candidate no longer matters once beyond maxRangeM
    expect(withBias.inputs.throttle).toBeCloseTo(noBias.inputs.throttle, 5);
    expect(withBias.inputs.strafeX).toBeCloseTo(noBias.inputs.strafeX, 5);
    expect(withBias.inputs.strafeY).toBeCloseTo(noBias.inputs.strafeY, 5);
    // and it should be pulling back toward the player's nose-line (negative lateral strafe, since
    // the enemy drifted to +right)
    expect(withBias.inputs.strafeX).toBeLessThan(-0.3);
  });

  it('commits jinkFwd to one of the searched forward-bias levels after a replan', () => {
    const { enemy, player } = withPlayerSpeed(50);
    const ai = makeAI({ jinkReplanTimer: 0 });
    evasiveThink(enemy, ai, player, 0.1, false);
    expect([-1, 0, 1]).toContain(ai.jinkFwd);
  });
});

describe('evasiveThink — threat-triggered replan', () => {
  it('forces an immediate MPC replan on a fresh threat and adopts the fast (threatened) cadence', () => {
    // player dead-on aim at a stationary enemy 100m out -> missDistanceNow ~0 -> threatened
    const enemy = makeEnemy({ x: 0, y: 0, z: 100 });
    const player = makePlayer();
    const ai = makeAI({ jinkReplanTimer: 999, wasThreatened: false }); // "not due to replan for a long time"
    evasiveThink(enemy, ai, player, 0.1, false);
    expect(ai.wasThreatened).toBe(true);
    expect(ai.jinkReplanTimer).toBeCloseTo(EVASIVE_TUNING.mpcThreatReplanSec, 5);
  });

  it('uses the slower baseline replan cadence once not threatened', () => {
    const enemy = makeEnemy({ x: 0, y: 0, z: 100000 }); // far away -> not threatened
    const player = makePlayer();
    const ai = makeAI({ jinkReplanTimer: 0 }); // due to replan this tick regardless
    evasiveThink(enemy, ai, player, 0.1, false);
    expect(ai.jinkReplanTimer).toBeCloseTo(EVASIVE_TUNING.mpcReplanSec, 5);
  });
});

describe('evasiveThink — shootback mini state machine', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never leaves block when returnFireEnabled is false, even if the random roll would trigger it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // would always trigger the chance roll if it ran
    const enemy = makeEnemy();
    const player = makePlayer();
    const ai = makeAI();
    const decision = evasiveThink(enemy, ai, player, 0.1, false);
    expect(ai.mode).toBe('block');
    expect(decision.wantsToFire).toBe(false);
  });

  it('rolls into shootback when enabled and the random roll succeeds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 0 < shootbackChancePerSec*dt for any dt > 0
    const enemy = makeEnemy();
    const player = makePlayer();
    const ai = makeAI();
    const decision = evasiveThink(enemy, ai, player, 0.1, true);
    expect(ai.mode).toBe('shootback');
    expect(ai.modeTimer).toBeCloseTo(EVASIVE_TUNING.shootbackDurationSec, 5);
    expect(decision.wantsToFire).toBe(true);
  });

  it('returns to block with a cooldown once a shootback window expires', () => {
    const enemy = makeEnemy();
    const player = makePlayer();
    const ai = makeAI({ mode: 'shootback', modeTimer: 0.0001 });
    evasiveThink(enemy, ai, player, 0.1, true);
    expect(ai.mode).toBe('block');
    expect(ai.modeTimer).toBeCloseTo(EVASIVE_TUNING.shootbackCooldownSec, 5);
  });
});
