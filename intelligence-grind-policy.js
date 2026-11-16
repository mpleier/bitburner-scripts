/** Intelligence cannot be trained like the other stats: the game only awards int exp from discrete actions.
 *  Values below are copied from the official source so a grind plan can be priced without guessing.
 *
 *  - src/NetscriptFunctions/Singularity.ts: purchaseAugmentation and installAugmentations each award
 *    CONSTANTS.IntelligenceSingFnBaseExpGain * 10 (base 1.5 → 15 exp); upgradeHomeRam / upgradeHomeCores
 *    award * 2 (3 exp). Travel/backdoor/work helpers award base/500 or less — rounding noise.
 *  - src/Netscript/NetscriptHelpers.tsx: only a MANUAL hack (typed in the terminal) awards 0.005.
 *  - src/Bladeburner/Bladeburner.ts: general actions award BlakeburnerConstants.BaseIntGain (0.003) per
 *    completed action; contracts and operations award BaseIntGain * seconds.
 *  - src/Work/ClassWork.tsx: any university course awards 0.01 per work tick.
 *
 *  Intelligence levels use the same curve as every other stat with mult 1 (src/PersonObjects/formulas/skill.ts):
 *  level = floor(32 * ln(exp + 534.6) - 200).
 */
/** Create Program is the only int source with a *rate* rather than a per-action award.
 *
 *  src/Work/CreateProgramWork.ts:79 pays `IntelligenceProgramBaseExpGain * cyclesWorked * MilliPerCycle / 1000`
 *  when the work finishes — 0.1 * cycles * 200 / 1000 = 0.02 per cycle, and a cycle is 1/5 s. Hacking level and
 *  the intelligence bonus only change how many cycles a program needs (src/Work/CreateProgramWork.ts:62), so the
 *  rate is a flat 0.1 int exp per second of work whatever program you pick and whatever your skills are.
 *
 *  Repeating it is possible: BaseServer.removeFile() splices the program out of home.programs (Server/BaseServer.ts:195),
 *  and createProgram only refuses while Player.hasProgram() is true (NetscriptFunctions/Singularity.ts:953) — so
 *  `rm <program>.exe` between runs re-opens the same program.
 */
export const PROGRAM_INT_PER_SECOND = 0.1; // IntelligenceProgramBaseExpGain (0.1) * MilliPerCycle (200) / 1000 / 5 cycles per second

/** Int exp a finished program pays. exp scales with work done, not with the result, so a faster skill multiplier
 *  shortens the job and reduces the award by exactly the same factor. */
export function programIntExp({ timeMs = 0, skillMult = 1 } = {}) {
  const ms = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
  const mult = Number.isFinite(skillMult) && skillMult > 0 ? skillMult : 1;
  return (PROGRAM_INT_PER_SECOND * (ms / 1000)) / mult;
}

/** Wall-clock seconds the same program occupies the player's single work slot. */
export function programWorkSeconds({ timeMs = 0, skillMult = 1 } = {}) {
  const ms = Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0;
  const mult = Number.isFinite(skillMult) && skillMult > 0 ? skillMult : 1;
  return (ms / 1000) / mult;
}

const INTELLIGENCE_EXP = Object.freeze({
  augmentationPurchase: 15,
  augmentationInstall: 15,
  homeRamUpgrade: 3,
  homeCoreUpgrade: 3,
  bladeburnerAction: 0.003,
  bladeburnerPerSecond: 0.003,
  universityTick: 0.01,
  manualHack: 0.005,
  programPerSecond: PROGRAM_INT_PER_SECOND,
});

export function intelligenceLevelForExp(exp) {
  if (!Number.isFinite(exp) || exp < 0) return 1;
  return Math.max(1, Math.floor(32 * Math.log(exp + 534.6) - 200));
}

export function intelligenceExpForLevel(level) {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.exp((Math.max(1, level) + 200) / 32) - 534.6);
}

/** What one augmentation reset cycle is worth: every purchased augmentation plus the install itself. */
export function intelligencePerReset(augsPerReset = 0) {
  const augs = Number.isFinite(augsPerReset) && augsPerReset > 0 ? Math.floor(augsPerReset) : 0;
  return INTELLIGENCE_EXP.augmentationInstall + augs * INTELLIGENCE_EXP.augmentationPurchase;
}

/** NeuroFlux Governor is the only repeatable purchase, so it is the only augmentation exp that can be
 *  bought with cash alone. Price escalates 1.14x per level owned, which makes the first levels cheap and
 *  the later ones poor value; report both. */
export function neurofluxPlan({ price, money, owned = 0, reserve = 0, maxLevels = 200 } = {}) {
  const base = Number(price);
  const wallet = Number(money) - (Number.isFinite(reserve) ? reserve : 0);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(wallet) || wallet <= 0) {
    return { affordable: 0, cost: 0, exp: 0, cheapest: null, dearest: null };
  }
  let remaining = wallet, affordable = 0, cost = 0, last = null;
  while (affordable < maxLevels) {
    const levelPrice = base * Math.pow(1.14, affordable);
    if (levelPrice > remaining) break;
    remaining -= levelPrice;
    cost += levelPrice;
    last = levelPrice;
    affordable++;
  }
  return {
    affordable,
    cost,
    exp: affordable * INTELLIGENCE_EXP.augmentationPurchase,
    cheapest: base,
    dearest: last,
    levelNow: Number(owned),
  };
}

/** Full plan: how far the current exp is from a target level and what it costs in resets and cash. */
export function intelligenceGrindPlan({ exp = 0, targetLevel = null, augsPerReset = 0, resetsPerHour = 0, neuroflux = null } = {}) {
  const current = Number.isFinite(exp) && exp >= 0 ? exp : 0;
  const level = intelligenceLevelForExp(current);
  const nextLevelExp = intelligenceExpForLevel(level + 1);
  const target = Number.isFinite(targetLevel) && targetLevel > level ? Math.floor(targetLevel) : null;
  const targetExp = target ? intelligenceExpForLevel(target) : null;
  const perReset = intelligencePerReset(augsPerReset);
  const needed = target ? Math.max(0, targetExp - current) : 0;
  const resetsNeeded = perReset > 0 && target ? Math.ceil(needed / perReset) : null;
  const rate = Number.isFinite(resetsPerHour) && resetsPerHour > 0 ? perReset * resetsPerHour : 0;
  return {
    exp: current,
    level,
    expToNextLevel: Math.max(0, nextLevelExp - current),
    nextLevelAt: nextLevelExp,
    targetLevel: target,
    expToTarget: target ? needed : null,
    perReset,
    resetsNeeded,
    expPerHour: rate,
    hoursToTarget: rate > 0 && target ? needed / rate : null,
    neuroflux: neuroflux || null,
  };
}
