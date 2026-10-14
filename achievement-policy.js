export const challengeRules={
 1:{actions:['homeRam','homeCores'],scripts:['Tasks/ram-manager.js'],reason:'Home stays at most 128 GB and one core'},
 2:{actions:['gang'],scripts:['gangs.js'],reason:'No gang'},
 3:{actions:['corporation'],scripts:['corporation-manager.js'],reason:'No corporation'},
 6:{actions:['bladeburner'],scripts:['bladeburner.js'],reason:'No Bladeburner division'},
 7:{actions:['bladeburner'],scripts:['bladeburner.js'],reason:'No Bladeburner division'},
 8:{actions:['fourSigma'],scripts:[],reason:'No 4S data or API purchase'},
 9:{actions:['hacknetMoney','hacknetExpense'],scripts:['hacknet-upgrade-manager.js','spend-hacknet-hashes.js','darknet-manager.js'],reason:'No Hacknet expenses or money'},
 10:{actions:['sleeve'],scripts:['sleeve.js','sleeve-expansion.js'],reason:'Sleeves remain unused'},
 13:{actions:['stanek'],scripts:['stanek.js','stanek.js.create.js'],reason:'No installed Stanek Genesis'},
 14:{actions:['go'],scripts:['go.js'],reason:'No IPvGO API moves or cheats'},
 15:{actions:['heartbleed'],scripts:['darknet-manager.js'],reason:'No Heartbleed calls'},
};
export const sourceEditAchievements=new Set(['REALITYALTERATION','EDITSAVEFILE','UNACHIEVABLE','TRUE_RECURSION']);
export function campaignReady(levels){return [1,2,3,4,5,6,7,8,9,10,11,13,14,15].every(n=>Number(levels[n])>=3)&&Number(levels[12])>=1;}
export function challengeEligible(node,s={}) {
 if(node===1)return s.ram<=128&&s.cores===1;
 if(node===2)return s.gang===false;if(node===3)return s.corporation===false;
 if([6,7].includes(node))return s.bladeburner===false;if(node===8)return s.fourSigma===false;
 if(node===9)return s.hacknetIncome===0&&s.hacknetExpenses===0;
 if(node===10)return s.sleevesUnused===true;if(node===13)return s.stanek===false;
 // These flags are not public APIs. Fresh-node initialization precedes the forbidden managers.
 return [14,15].includes(node)&&s.fresh===true;
}
export function challengeProfile(reset,owned,snapshot,levels,previous,enabled=true,now=Date.now()) {
 if(!enabled)return {nodeReset:reset.lastNodeReset,active:false,disabledScripts:[],deniedActions:[]};
 if(previous?.nodeReset===reset.lastNodeReset&&previous.active)return previous;
 const prerequisites=['QUEUE_40','MONEY_1Q','STOCK_1q','INSTALL_100','NEUROFLUX_255','HACKING_100000','COMBAT_3000','INTELLIGENCE_255','KARMA_1000000','REPUTATION_10M'];
 if(reset.currentNode===8&&owned.includes('CHALLENGE_BN8')&&campaignReady(levels)&&!owned.includes('MONEY_M1B')&&prerequisites.every(id=>owned.includes(id)))return {nodeReset:reset.lastNodeReset,node:8,id:'MONEY_M1B',active:true,kind:'debt',reason:'Dedicated debt achievement with recoverable long-stock assets',disabledScripts:['stockmaster.js','soa-manager.js','grafting-manager.js'],deniedActions:['cashSpending','hacknetMoney']};
 const id='CHALLENGE_BN'+reset.currentNode,rule=challengeRules[reset.currentNode];
 const fresh=now-reset.lastNodeReset>=0&&now-reset.lastNodeReset<45000;
 const active=!!rule&&campaignReady(levels)&&!owned.includes(id)&&fresh&&challengeEligible(reset.currentNode,{...snapshot,fresh});
 return {nodeReset:reset.lastNodeReset,node:reset.currentNode,id,active,reason:active?rule.reason:'Normal run; challenge retries are scheduled on fresh nodes',
  disabledScripts:active?rule.scripts:[],deniedActions:active?rule.actions:[]};
}
export function achievementNode(projected,owned,base,profile=null,supported=null) {
 if(!campaignReady(projected))return base;
 const applicable=id=>!supported||supported.includes(id);
 const have=new Set(owned);if(profile?.active)have.add(profile.id); // Plan the next run; never report this prediction as an unlock.
 for(const n of [1,2,3,6,7,8,9,10,13,14,15])if(applicable('CHALLENGE_BN'+n)&&!have.has('CHALLENGE_BN'+n))return n;
 const finances=['NEUROFLUX_255','QUEUE_40','MONEY_1Q','STOCK_1q','CORPORATION_EMPLOYEE_3000','CORPORATION_PROD_1000','CORPORATION_REAL_ESTATE','CORPORATION_BRIBE'];
 if(finances.some(id=>applicable(id)&&!have.has(id)))return 3;
 if(['INSTALL_100','HACKING_100000','COMBAT_3000','INTELLIGENCE_255','KARMA_1000000','REPUTATION_10M'].some(id=>applicable(id)&&!have.has(id)))return 1;
 if(applicable('MONEY_M1B')&&!have.has('MONEY_M1B'))return 8;
 if(applicable('CHALLENGE_BN12')&&Number(projected[12])<50)return 12;
 return base;
}
/** Self-contained: small workers can serialize this guard without importing heavyweight APIs. */
export function achievementActionAllowed(ns,action) {
 try{const p=JSON.parse(ns.read('tasks/achievement-profile.json'));
  if(p?.active&&p.nodeReset===ns.getResetInfo().lastNodeReset&&p.deniedActions?.includes(action))return false;}catch{}
 try{const g=JSON.parse(ns.read('tasks/achievement-goals.json'));
  if(g?.expiresAt>Date.now()&&g.nodeReset===ns.getResetInfo().lastNodeReset&&ns.isRunning(g.ownerPid)&&g.deniedActions?.includes(action))return false;}catch{}
 return true;
}
export function achievementScriptBlocked(ns,script) {
 try{const p=JSON.parse(ns.read('tasks/achievement-profile.json'));
  if(p?.active&&p.nodeReset===ns.getResetInfo().lastNodeReset&&p.disabledScripts?.some(s=>s.split('/').pop()===script.split('/').pop()))return true;}catch{}
 return false;
}
export function achievementGoals({owned,levels,node,profile,queued=0,overclock=0,money=0,ownerPid,nodeReset,now=Date.now()}) {
 const has=new Set(owned),late=campaignReady(levels)&&!profile.active;
 const finance=late&&node===3,stats=late&&node===1,debt=profile.kind==='debt';
 const holdHashes=!has.has('MAX_CACHE')&&money>1e7&&achievementRulesAllow(profile,'hacknetMoney');
 return {ownerPid,nodeReset,expiresAt:now+60000,late,finance,stats,debt,minimumQueue:finance&&!has.has('QUEUE_40')?40:0,
  holdAugmentations:debt||finance&&!has.has('QUEUE_40')&&queued<40,
  holdDeparture:debt?['MONEY_M1B']:finance?['NEUROFLUX_255','QUEUE_40','MONEY_1Q','STOCK_1q','CORPORATION_EMPLOYEE_3000','CORPORATION_PROD_1000','CORPORATION_REAL_ESTATE','CORPORATION_BRIBE'].filter(id=>!has.has(id)):
   stats?['INSTALL_100','HACKING_100000','COMBAT_3000','INTELLIGENCE_255','KARMA_1000000','REPUTATION_10M'].filter(id=>!has.has(id)):[],
  xp:stats&&!has.has('HACKING_100000'),combat:stats&&!has.has('COMBAT_3000'),karma:stats&&!has.has('KARMA_1000000'),
  reputation:stats&&!has.has('REPUTATION_10M'),intelligence:stats&&!has.has('INTELLIGENCE_255'),
  bankBladeburnerPoints:!has.has('BLADEBURNER_UNSPENT_100000')&&overclock>=90,
  goStreak:!has.has('IPVGO_WINNING_STREAK'),goFailure:!has.has('IPVGO_ANTICHEAT'),
  deniedActions:[...(holdHashes?['hashSpending']:[]),...(finance&&has.has('STOCK_1q')&&!has.has('MONEY_1Q')?['stockInvesting']:[])],owned};
}
function achievementRulesAllow(p,action){return !p?.active||!p.deniedActions.includes(action);}
