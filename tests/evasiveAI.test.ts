import { describe, it, expect, vi, afterEach } from 'vitest';
import { EVASIVE_TUNING, evasiveThink } from '../src/combat/ai/evasiveAI';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/physics/shipTypes';
import type { EnemyShip, ShipBody } from '../src/core/world';
import type { EvasiveAIMemory } from '../src/core/types';

const TYPE = SHIP_TYPES[0];
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

function makeEnemy(pos = { x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance }, vel = ZERO): EnemyShip {
  return {
    type: TYPE, pos, vel, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0, throttleSpoolTime: 0, verticalSpoolTime: 0,
    health: createHealth(10), behavior: 'evasive', fireCooldown: 0, respawnTimer: 0
  };
}
function makePlayer(vel = ZERO): ShipBody {
  return {
    type: TYPE, pos: ZERO, vel, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, decoupled: false, spaceBrakeOn: false, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), hitFlash: 0, fireCooldown: 0,
    respawnTimer: 0
  };
}
function makeAI(overrides: Partial<EvasiveAIMemory> = {}): EvasiveAIMemory {
  return {
    jinkStrafeX: 0, jinkStrafeY: 0, jinkBoost: false, jinkReplanTimer: 999,
    mode: 'block', modeTimer: 0, wasThreatened: false, chasing: false,
    chaseStruggleTimer: 0, chaseCooldownTimer: 0, ...overrides
  };
}

// Enemy exactly at standoff distance dead ahead, matching player velocity along the same axis, so
// velDeficitMag collapses to exactly |playerSpeed - enemySpeed| (forwardShortfall/lateral/vertical
// all zero) — lets tests pick a precise velDeficitMag without hand-deriving the full formula.
function withPlayerSpeed(speed: number): { enemy: EnemyShip; player: ShipBody } {
  return { enemy: makeEnemy(), player: makePlayer({ x: 0, y: 0, z: speed }) };
}

describe('evasiveThink — chase/watch hysteresis', () => {
  it('enters chasing once the velocity deficit exceeds chaseEnterVelDeficit', () => {
    const { enemy, player } = withPlayerSpeed(EVASIVE_TUNING.chaseEnterVelDeficit + 5);
    const ai = makeAI();
    evasiveThink(enemy, ai, player, 0.1, false);
    expect(ai.chasing).toBe(true);
  });

  it('stays chasing while the deficit sits between chaseExitVelDeficit and chaseEnterVelDeficit (hysteresis band)', () => {
    const ai = makeAI({ chasing: true });
    const midBand = (EVASIVE_TUNING.chaseExitVelDeficit + EVASIVE_TUNING.chaseEnterVelDeficit) / 2;
    const { enemy, player } = withPlayerSpeed(midBand);
    evasiveThink(enemy, ai, player, 0.1, false);
    expect(ai.chasing).toBe(true);
  });

  it('exits chasing once the deficit drops below chaseExitVelDeficit', () => {
    const ai = makeAI({ chasing: true });
    const { enemy, player } = withPlayerSpeed(EVASIVE_TUNING.chaseExitVelDeficit - 5);
    evasiveThink(enemy, ai, player, 0.1, false);
    expect(ai.chasing).toBe(false);
  });

  it('gives up and forces a break after chaseStruggleLimitSec of failing to close a large, sustained deficit', () => {
    // deficit stays above chaseEnterVelDeficit (and therefore above chaseEnterVelDeficit*
    // chaseStruggleTolerance too, since that tolerance is < 1) the whole time, so it never "closes
    // the gap" and struggle time keeps accumulating instead of resetting.
    const strugglingSpeed = EVASIVE_TUNING.chaseEnterVelDeficit + 5;
    const ai = makeAI();
    const dt = 0.1;
    let broke = false;
    for (let i = 0; i < 40 && !broke; i++) {
      const { enemy, player } = withPlayerSpeed(strugglingSpeed);
      evasiveThink(enemy, ai, player, dt, false);
      if (i > 0 && !ai.chasing) broke = true; // first call only enters chasing, never struggles yet
    }
    expect(broke).toBe(true);
    expect(ai.chasing).toBe(false);
    expect(ai.chaseCooldownTimer).toBeCloseTo(EVASIVE_TUNING.chaseCooldownSec, 5);
    expect(ai.chaseStruggleTimer).toBe(0);
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
