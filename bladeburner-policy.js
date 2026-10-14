/** Decisions shared by the controller and its focused checks. */
export function isBlackOp(action) { return /black/i.test(action?.type || ''); }
export function nextSkill(skills, levels, costs, points, weights) {
 let best=null,score=Infinity;
 for(const name of skills) {
  const cost=costs[name];
  if(!(Number.isFinite(cost)&&cost>0&&cost<=points)||name==='Overclock'&&levels[name]>=90)continue;
  const adjusted=cost*(weights[name]||1);
  if(adjusted<score){best=name;score=adjusted;}
 }
 return best;
}
export function raidCities(cities,population,communities,allowHighest=false) {
 const highest=cities.reduce((best,c)=>population[c]>population[best]?c:best,cities[0]);
 return cities.filter(c=>communities[c]>0&&(allowHighest||c!==highest));
}
export function recoveryRequired(hp,stamina,previous,low,high) {
 return {health:hp<0.5||previous.health&&hp<0.9,stamina:stamina<low||previous.stamina&&stamina<high};
}
export function optionsError(o) {
 if(o['team-cap']!==undefined&&(!Number.isInteger(o['team-cap'])||o['team-cap']<0||o['team-cap']>1000))return 'team-cap must be an integer between 0 and 1000';
 if(o['recruitment-budget-minutes']!==undefined&&(!Number.isFinite(o['recruitment-budget-minutes'])||o['recruitment-budget-minutes']<0||o['recruitment-budget-minutes']>60))return 'recruitment-budget-minutes must be between 0 and 60';
 for(const key of ['success-threshold','low-stamina-pct','high-stamina-pct'])if(!Number.isFinite(o[key])||o[key]<0||o[key]>1)return key+' must be between 0 and 1';
 if(o['low-stamina-pct']>=o['high-stamina-pct'])return 'high-stamina-pct must exceed low-stamina-pct';
 for(const key of ['chaos-recovery-threshold','max-chaos','training-limit','reserved-action-count'])if(!Number.isFinite(o[key])||o[key]<0)return key+' must be nonnegative';
 if(o['max-chaos']<o['chaos-recovery-threshold'])return 'max-chaos must be at least chaos-recovery-threshold';
 if(!Number.isFinite(o['update-interval'])||o['update-interval']<100)return 'update-interval must be at least 100 ms';
 return null;
}

/** Operation/BlackOp bonus is (assigned+1)^0.05; require a reliable estimate. */
export function requiredBladeburnerTeam(chance,threshold,cap=30){
 if(!Array.isArray(chance)||chance.length<2||!chance.every(Number.isFinite)||!Number.isFinite(threshold)||threshold<0||threshold>1||!Number.isInteger(cap)||cap<0)return null;
 const [low,high]=chance;if(low>=threshold)return 0;
 if(!(low>0)||high<low||high-low>.02)return null;
 const need=Math.ceil(Math.expm1(20*Math.log(threshold/low)));
 return Number.isFinite(need)&&need<=cap?Math.max(0,need):null;
}
/** Executed in a guarded worker; restore the prior assignment if recruitment cannot help. */
export function prepareBladeburnerTeam(api,name,threshold,cap,required){
 const type='Black Operations',available=api.getTeamSize(),previous=api.getTeamSize(type,name);
 if(!Number.isFinite(available)||available<0||!Number.isFinite(previous)||previous<0)return {state:'unavailable'};
 let modified=false;
 try{
  if(api.setTeamSize(type,name,0)!==0)return {state:'unavailable'};modified=true;
  const baseline=api.getActionEstimatedSuccessChance(type,name),need=required(baseline,threshold,cap);
  if(need===null){api.setTeamSize(type,name,previous);modified=false;return {state:'no-useful-team',available,baseline};}
  const assigned=api.setTeamSize(type,name,Math.min(available,need));
  if(!(assigned>=0))throw Error('Team assignment rejected');modified=false;
  return {state:available<need?'needs-recruitment':'ready',available,required:need,assigned,baseline};
 }catch(error){if(modified)try{api.setTeamSize(type,name,previous);}catch{}return {state:'unavailable',error:String(error)};}
}
