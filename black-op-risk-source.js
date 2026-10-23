/** Native read-only quote. Durations are game time; the risk model shares the finite bonus balance across phases. */
export const blackOpRiskQuoteSource = `(()=>{const b=ns.bladeburner,p=ns.getPlayer(),r=ns.getResetInfo(),target=ns.args[0];return {at:Date.now(),ownerPid:ns.args[1],target,nodeReset:r.lastNodeReset,augReset:r.lastAugReset,city:b.getCity(),rank:b.getRank(),loss:b.getActionRankLoss('Black Operations',target),time:b.getActionTime('Black Operations',target),team:b.getTeamSize('Black Operations',target),totalTeam:b.getTeamSize(),stamina:b.getStamina(),rawChance:b.getActionEstimatedSuccessChance('Black Operations',target),hp:p.hp,money:p.money,bonusMs:b.getBonusTime(),recruit:{time:b.getActionTime('General','Recruitment'),chance:b.getActionEstimatedSuccessChance('General','Recruitment')[0]},hrcTime:b.getActionTime('General','Hyperbolic Regeneration Chamber')};})()`;
/** Official v3.0.1 base failure HP losses; difficulty and the 10% adverse offset are applied by policy. */
export const blackOpFailureHp = {
  "Operation Typhoon": 100,
  "Operation Zero": 50,
  "Operation X": 100,
  "Operation Titan": 100,
  "Operation Ares": 200,
  "Operation Archangel": 25,
  "Operation Juggernaut": 300,
  "Operation Red Dragon": 500,
  "Operation K": 1000,
  "Operation Deckard": 200,
  "Operation Tyrell": 500,
  "Operation Wallace": 1500,
  "Operation Shoulder of Orion": 1500,
  "Operation Hyron": 500,
  "Operation Morpheus": 100,
  "Operation Ion Storm": 5000,
  "Operation Annihilus": 10000,
  "Operation Ultron": 10000,
  "Operation Centurion": 10000,
  "Operation Vindictus": 20000,
  "Operation Daedalus": 100000
};
