export const researchParents = {
 'Go-Juice':'Automatic Drug Administration','CPH4 Injections':'Automatic Drug Administration',
 'Drones - Assembly':'Drones','Drones - Transport':'Drones','HRBuddy-Training':'HRBuddy-Recruitment',
 'Market-TA.II':'Market-TA.I','Sti.mu':'Overclock','uPgrade: Capacity.I':'uPgrade: Fulcrum',
 'uPgrade: Capacity.II':'uPgrade: Capacity.I','uPgrade: Dashboard':'uPgrade: Fulcrum',
};
export const extraResearch = ['Automatic Drug Administration','Go-Juice','CPH4 Injections','HRBuddy-Recruitment','HRBuddy-Training'];
export function productInvestment(cash,reserve,budget=Infinity) {
 if(!Number.isFinite(cash)||!Number.isFinite(reserve)||cash<0||reserve<0||!(Number.isFinite(budget)||budget===Infinity)||budget<0)return 0;
 const free=Math.max(0,cash-reserve);
 return free>20e6?Math.min(Math.max(0,budget)*.25,Math.max(10e6,free*0.005)):0;
}
export function acceptVentureOffer(info,offer,minOwnership=0.5) {
 const profit=Math.max(0,(Number(info.revenue)||0)-(Number(info.expenses)||0));
 return !info.public&&Number.isInteger(offer?.round)&&offer.round>=1&&offer.round<=4&&
  [offer.funds,offer.shares,info.numShares,info.totalShares,minOwnership].every(Number.isFinite)&&
  offer.funds>Math.max(1e9,profit*300)&&offer.shares>0&&info.totalShares>0&&minOwnership>0&&minOwnership<=1&&
  (info.numShares-offer.shares)/info.totalShares>=minOwnership;
}
/** Allow valuation's ten-cycle average to settle; do not wait indefinitely for peaks. */
export function investmentDecision(info,offer,previous,minOwnership=.5,{now=Date.now(),cycleSeconds=10,reserve=0,stageReady=true}={}){
 if(!info.public&&(!offer||!Number.isInteger(offer.round)))return {accept:false,holdIPO:true,reason:'Investment offer unavailable',history:previous};
 const remaining=!info.public&&offer?.round>=1&&offer.round<=4&&offer.shares>0&&offer.funds>0;
 const floorBlocked=remaining&&(info.numShares-offer.shares)/info.totalShares<minOwnership;
 const same=previous?.round===offer?.round&&Number.isFinite(previous.since)&&previous.since<=now;
 const anchor=same?(Number(previous.growthAnchor)||Number(previous.peak)||offer.funds):offer?.funds;
 const grew=same&&offer.funds>anchor*1.02;
 const history={round:offer?.round,since:same?previous.since:now,peak:Math.max(same?previous.peak||0:0,offer?.funds||0),growthAnchor:!same||grew?offer?.funds:anchor,lastGrowthAt:!same||grew?now:previous.lastGrowthAt??previous.since};
 if(!remaining)return {accept:false,holdIPO:false,reason:'No private investment rounds remain',history};
 if(floorBlocked)return {accept:false,holdIPO:false,reason:'Next round violates the configured ownership floor',history};
 if(!acceptVentureOffer(info,offer,minOwnership))return {accept:false,holdIPO:true,reason:'Offer is too small relative to operating profit',history};
 const emergency=info.funds<reserve*1.5;
 const settled=now-history.lastGrowthAt>=cycleSeconds*1000*10;
 const timeout=now-history.since>=30*60000;
 const accept=emergency||timeout||stageReady&&settled;
 return {accept,holdIPO:true,reason:accept?emergency?'Operating capital needed':timeout?'Bounded funding wait elapsed':'Offer growth has settled':!stageReady?'Waiting for supply chain or completed products':'Waiting for improving valuation',history};
}
/** Source share sales reprice by at most -0.5% per million shares. Lower-bound proceeds. */
export function estimateShareProceeds(info,count){
 if(!(info.sharePrice>0)||!Number.isFinite(info.sharePrice)||!Number.isSafeInteger(count)||count<0)return 0;
 const step=1e6,q=.995,full=Math.floor(count/step),part=count%step;
 return info.sharePrice*(step*q*(-Math.expm1(full*Math.log(q)))/(1-q)+part*Math.pow(q,full+1));
}
export function rescueShareIssue(info,reserve,minOwnership=0.5) {
 if(!info.public||info.issueNewSharesCooldown>0||info.funds>=reserve*1.5||info.revenue>info.expenses||!(info.sharePrice>0)||!Number.isFinite(info.sharePrice)||!(minOwnership>0&&minOwnership<=1)||![info.totalShares,info.numShares,reserve,info.funds].every(Number.isFinite))return 0;
 const cap=Math.min(info.totalShares*.2,info.numShares/minOwnership-info.totalShares,1e14);
 const units=Math.max(0,Math.floor(cap/10e6));if(!units)return 0;
 const needed=Math.max(0,reserve*1.5-info.funds);
 const proceeds=count=>{
  const target=info.valuation>0?info.valuation*(.5+Math.sqrt(info.numShares/(info.totalShares+count)))/info.totalShares:info.sharePrice*.6;
  return count*(info.sharePrice+target)/2;
 };
 let low=1,high=units;while(low<high){const mid=Math.floor((low+high)/2);if(proceeds(mid*10e6)>=needed)high=mid;else low=mid+1;}
 return low*10e6;
}
export function shareSale(info,wallet,playerReserve,minOwnership=0.5,targetCash=playerReserve+1e9) {
 if(!info.public||info.shareSaleCooldown>0||!(info.sharePrice>0)||!Number.isFinite(info.sharePrice)||![wallet,playerReserve,targetCash,info.numShares,info.totalShares,minOwnership].every(Number.isFinite)||!(minOwnership>0&&minOwnership<=1))return 0;
 const gap=Math.max(0,targetCash-wallet);if(!gap)return 0;
 const dividends=corporationDividendRate(info);
 if(dividends>0&&gap/dividends<=300)return 0; // Prefer a short dividend wait over selling permanent income.
 const cap=Math.max(0,Math.min(1e12,Math.floor(info.numShares-info.totalShares*minOwnership),Math.floor(info.totalShares*.01),Math.floor(info.numShares)-1));
 if(!cap)return 0;
 let low=1,high=cap;while(low<high){const mid=Math.floor((low+high)/2);if(estimateShareProceeds(info,mid)>=gap)high=mid;else low=mid+1;}
 return low;
}
export function shareBuyback(info,wallet,playerReserve,minOwnership=0.5) {
 if(![wallet,playerReserve,minOwnership,info.numShares,info.totalShares,info.issuedShares].every(Number.isFinite)||wallet<0||playerReserve<0||!(minOwnership>0&&minOwnership<=1)||!(info.totalShares>0)||!info.public||!(info.sharePrice>0)||!Number.isFinite(info.sharePrice)||!(info.issuedShares>0)||info.numShares/info.totalShares>=minOwnership+0.15)return 0;
 const budget=Math.max(0,wallet-playerReserve-1e9)*.01;
 return Math.max(0,Math.min(1e6,info.issuedShares,Math.floor(budget/(info.sharePrice*1.25))));
}
export function recipeInputPlan(recipe,items,production,budget,cycleSeconds=10) {
 const plan=Object.entries(recipe).map(([name,coefficient])=>{
  const item=items[name]||{}, price=Number(item.marketPrice)||0;
  const amount=Math.max(0,Math.max(1,production)*coefficient*cycleSeconds*1.1-(Number(item.stored)||0));
  return {name,amount:price>0?amount:0,price};
 });
 const cost=plan.reduce((sum,item)=>sum+item.amount*item.price,0);
 const scale=cost>0?Math.max(0,Math.min(1,budget/cost)):0;
 return {cost:cost*scale,orders:plan.map(item=>({name:item.name,rate:item.amount*scale/cycleSeconds}))};
}

/** Source getCycleDividends applies tribute to the full cycle payout as an exponent. */
export function corporationDividendRate(info,cycleSeconds=10){
 const profit=Number(info.revenue)-Number(info.expenses),rate=Number(info.dividendRate),shares=Number(info.numShares),total=Number(info.totalShares),tribute=Number(info.tributeModifier??0);
 if(![profit,rate,shares,total,tribute,cycleSeconds].every(Number.isFinite)||profit<=0||rate<=0||rate>1||shares<=0||total<=0||shares>total||tribute<0||tribute>=1||cycleSeconds<=0)return 0;
 const value=(profit*cycleSeconds*rate*shares/total)**(1-tribute)/cycleSeconds;
 return Number.isFinite(value)&&value>0?value:0;
}

/** Sell equity only for a fresh, reputation-ready augmentation milestone that this sale can fully fund. */
export function corporationLiquidityTarget(snapshot,{now=Date.now(),augReset,wallet,reserve=0,maxProceeds=0}={}) {
 const fallback={targetCash:reserve+1e9,reason:'Maintain emergency player liquidity',priorityShortfalls:[]};
 if(!snapshot||snapshot.augReset!==augReset||!Number.isFinite(snapshot.at)||snapshot.at>now||now-snapshot.at>60000||
    !Number.isFinite(snapshot.worth)||!Number.isFinite(wallet)||!Number.isFinite(maxProceeds))return fallback;
 const worth=Math.max(wallet,snapshot.worth),priority=["The Red Pill","The Blade's Simulacrum","Neuroreceptor Management Implant"];
 const choices=[];
 for(const target of snapshot.targets||[]){
  if(!Number.isFinite(target.cost)||target.cost<0||!Number.isFinite(target.rep)||!Array.isArray(target.factions))continue;
  const repReady=target.factions.some(f=>Number.isFinite(snapshot.reputation?.[f])&&snapshot.reputation[f]>=target.rep);
  const donation=repReady?0:target.donationCost;
  if(priority.includes(target.name))fallback.priorityShortfalls.push({name:target.name,price:target.standaloneCost??target.cost,reputationReady:repReady,repRequired:target.rep,repAvailable:Math.max(0,...target.factions.map(f=>Number(snapshot.reputation?.[f])||0)),cashGap:Math.max(0,(target.standaloneCost??target.cost)+(Number.isFinite(donation)?donation:0)-worth),maxShareProceeds:maxProceeds});
  if(!Number.isFinite(donation)||donation<0)continue;
  const standalone=Number.isInteger(target.priority)&&target.priority>=0&&Number.isFinite(target.standaloneCost)&&target.standaloneCost>=0;
  const cost=(standalone?target.standaloneCost:target.cost)+donation,gap=cost-worth;
  if(!(gap>0)||gap>maxProceeds)continue;
  choices.push({targetCash:Math.max(reserve+1e9,wallet+gap),reason:'Fund augmentation milestone: '+target.name,augmentation:target.name,cost,priority:priority.includes(target.name)?priority.indexOf(target.name):priority.length,priorityShortfalls:fallback.priorityShortfalls});
 }
 return choices.filter(c=>c.targetCash-wallet<=maxProceeds).sort((a,b)=>a.priority-b.priority||a.targetCash-b.targetCash)[0]||fallback;
}
