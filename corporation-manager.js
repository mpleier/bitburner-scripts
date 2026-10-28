import {quoteCorporationAdvertisingCandidate,planCorporationAdvertisingGroups,executeCorporationAdvertisingGroup,refreshCorporationAdvertisingRecovery} from './corporation-advert-bundle-policy.js';
import {corporationDevelopmentDelay,corporationAdvertisingDelay,planCorporationDelayedReturns} from './corporation-delayed-return-policy.js';
import {captureCorporationCalibration,observeCorporationCalibration,calibrateCorporationGrowth} from './corporation-calibration-policy.js';
import {corporationGrowthPhase,corporationFundingGoal,corporationFundingDiagnostics,corporationHashMilestone} from './corporation-priority-policy.js';
import {hashSpendingDecision,spendHashesWithPolicy} from './hash-spending-policy.js';
import {readNodeRoutePlan} from './node-route-policy.js';
import {registerAutomation,automationHeartbeat,maintenanceRequested} from './runtime-policy.js';
import {achievementActionAllowed} from './achievement-policy.js';
import { claimSpending } from './spending-policy.js';
import { officeOnlyResearchJobs,corporationProductBaseline,observeCorporationUpkeep,corporationUpkeepResearchValues,planCorporationResearchBundles,executeCorporationResearchBundle,corporationResearchRate,corporationResearchDecision,corporationGrowthBudget,corporationOfficeUpkeepNeed,allocateCorporationUpkeep,corporationDevelopmentExpansion,observeCorporationGrowth,scoreCorporationGrowth,treasuryPolicy, recoveryJobCounts, priorSaleMultiplier, partySpendPerEmployee, materialSalePrice, outputBacklog, boostPurchaseBudget, productPriceStep, researchAffordable, salesPotential, formulaSalePrice, inferProductMarkup, supportAdvertLimit, clearCorporationBuyRates, optimizedOfficeJobs, corporationDevelopmentCity, executeCorporationGrowth, productReplacementReady, corporationAdvertBenefit, corporationResearchGoal, corporationCoreFunding, corporationScienceFactor } from './corporation-policy.js';
import { researchParents, extraResearch, productInvestment, investmentDecision, rescueShareIssue, shareSale, shareBuyback, recipeInputPlan, corporationDividendRate, corporationLiquidityTarget, estimateShareProceeds } from './corporation-lifecycle.js';
import { getNsDataThroughFile } from './helpers.js';
import { isScriptPaused } from './automation-control.js';
/** Standalone corporation controller: recipe-based supply, research, products,
 * expansion and finances. All discretionary spending preserves operating reserves.
 * Investor ownership cannot be recovered; share actions preserve min-ownership.
 * Custom products and existing export routes are preserved. */
import { optimalBoostTargets, chooseRetirement, upgradeReturn } from './automation-policy.js';

export async function main(ns) {
 registerAutomation(ns);
    if (isScriptPaused(ns, ns.getScriptName())) return;
    if (ns.ps("home").some(process => process.filename === ns.getScriptName() && process.pid !== ns.pid)) return;
  const options = typeof ns.flags === 'function' ? ns.flags([
    ['development-speed',true], ['investment-min-ownership',0.1], ['min-ownership', 0.5], ['expand-all-industries', false], ['manage-shares', true], ['bribe-factions', true],
  ]) : { 'development-speed':true, 'investment-min-ownership':0.1, 'min-ownership': 0.5, 'expand-all-industries': false, 'manage-shares': true, 'bribe-factions': true };
  const minOwnership = Number(options['min-ownership']);
  if (!(minOwnership > 0 && minOwnership <= 1)) { ns.tprint('min-ownership must be greater than zero and at most one.'); return; }
  const investmentMinOwnership=Number(options['investment-min-ownership']??0.1);
  if(!(investmentMinOwnership>0&&investmentMinOwnership<=1)){ns.tprint('investment-min-ownership must be greater than zero and at most one.');return;}
  const c = ns.corporation;
  const cities = ["Sector-12", "Aevum", "Volhaven", "Chongqing", "New Tokyo", "Ishima"];
  const name = "Apex Holdings";
  const agri = "Agri";
  const restaurant = "Dining";
  const chem = "Chem";
  const tobacco = "Tobacco";
  const CITY_EXPAND_BUFFER = 5e9;
  const WAREHOUSE_BUFFER = 5e9;
  let reserve = 5e9;
  let boostBudget = 0;
  const officeJobs = ["Operations", "Engineer", "Business", "Management", "Research & Development", "Intern"];
  let recovering = false;
  let upkeepBudget = 0;
  let upkeepAllocations = new Map();
  let growthBank = null,growthGoal=null,hashMilestone=null,growthPriority=!!options['development-speed'],growthPhase=null;
  const constants = (() => { try { return c.getConstants(); } catch { return {}; } })();
  const cycleSeconds = Number(constants.secondsPerMarketCycle) || 10;
  const teaCostPerEmployee = Number(constants.teaCostPerEmployee) || 500000;

  // ---- Dividend strategy ------------------------------------------------
  const DIVIDEND_TIERS = [
    [1e21, 0.20],
    [1e18, 0.10],
    [1e15, 0.05],
    [1e13, 0.02],
    [0,    0.00],
  ];
  const DIVIDEND_MAX = (() => {
    try {
      const v = c.getConstants().dividendMaxRate;
      return Number.isFinite(v) ? v : 1;
    } catch { return 1; }
  })();
  const dividendRateFor = (cash) => {
    for (const [threshold, rate] of DIVIDEND_TIERS)
      if (cash >= threshold) return Math.min(rate, DIVIDEND_MAX);
    return 0;
  };
  const PAY_DIVIDENDS = true;
  const IPO_VALUATION = 1e12;
  const ACCEPT_INVESTMENT = true;
  let lastDividendRate = -1,financeDecision=null,financeHistory=null,lastShareSaleAt=0,liquidityDecision=null;
  const financeFile='tasks/corporation-finance.json';

  // ---- Hash spend plan --------------------------------------------------
  const HASH_SPEND_PLAN = [
    "Sell for Corporation Funds",
    "Exchange for Corporation Research",
  ];
  let hashSpendIndex = 0;
  const SELL_HASHES_FOR_CORP = true;
  const MAX_HASH_COST_PER_PURCHASE = 5000;

  // ---- Hacknet server management ----------------------------------------
  const BUY_HACKNET_SERVERS = true;
  const HACKNET_SPEND_FRACTION = 0.05;
  const HACKNET_MAX_SERVERS = 20;
  const HACKNET_CACHE_TARGET = 4;

  // ---- Upgrade priority -------------------------------------------------

  // ---- Chemical quality loop --------------------------------------------
  const EXPORT_FORMULA = "(IPROD+IINV/10)*(-1)";

  // ---- AdVert budget ----------------------------------------------------
  const ADVERT_SPEND_FRACTION = 0.50;

  // ---- Office upkeep ----------------------------------------------------
  // Upkeep is budgeted across offices rather than spending a fixed party amount.


  // ---- Boost target -----------------------------------------------------
  const BOOST_WAREHOUSE_FRACTION = 0.60;

  // ---- Research orders --------------------------------------------------
  const MATERIAL_RESEARCH_ORDER = [
    "Hi-Tech R&D Laboratory",
    "AutoBrew",
    "AutoPartyManager",
    "Market-TA.I",
    "Market-TA.II",
    "Self-Correcting Assemblers",
    "Drones",
    "Drones - Assembly",
    "Drones - Transport",
    "Overclock",
    "Sti.mu",
  ];
  const PRODUCT_RESEARCH_ORDER = [
    "Hi-Tech R&D Laboratory",
    "AutoPartyManager",
    "AutoBrew",
    "Market-TA.I",
    "Market-TA.II",
    "uPgrade: Fulcrum",
    "uPgrade: Capacity.I",
    "uPgrade: Capacity.II",
    "uPgrade: Dashboard",
    "Self-Correcting Assemblers",
    "Drones",
    "Drones - Assembly",
    "Drones - Transport",
    "Overclock",
    "Sti.mu",
  ];

  const safeDisableLog = (label) => { try { ns.disableLog(label); } catch {} };
  safeDisableLog("sleep");
  safeDisableLog("corporation.nextUpdate");

  const safe = (label, fn) => {
    try { return fn(); }
    catch (error) { ns.print(`${label}: ${String(error)}`); return undefined; }
  };
  const corp = () => safe("getCorporation", () => c.getCorporation());
  const funds = () => corp()?.funds ?? 0;
  const divisions = () => corp()?.divisions ?? [];
  const hasDivision = (division) => divisions().includes(division);
  const hasUnlock = (unlock) => safe(`hasUnlock ${unlock}`, () => c.hasUnlock(unlock)) === true;
  const canManage=()=>!isScriptPaused(ns,ns.getScriptName())&&!maintenanceRequested(ns)&&achievementActionAllowed(ns,'corporation');
  const attempt = (label, fn) => canManage() && safe(label, () => fn() !== false) === true;
  const resetInfo = safe("Read reset information", () => ns.getResetInfo());
  const sourceFiles = resetInfo?.ownedSF;
  const sf = (n) => typeof sourceFiles?.get === "function" ? sourceFiles.get(n) : sourceFiles?.[n];
  const hasSourceFile3 = Number(sf(3)) > 0;
  if (!resetInfo || (resetInfo.currentNode !== 3 && !hasSourceFile3)) {
    ns.tprint("Corporation manager stopped: requires BitNode 3 or Source-File 3 access.");
    return;
  }
  try{const saved=JSON.parse(ns.read(financeFile));if(saved.nodeReset===resetInfo.lastNodeReset&&saved.corporation===corp()?.name){financeHistory=saved.history;lastShareSaleAt=Number(saved.lastShareSaleAt)||0;}}catch{}
  const hasHacknetServers = () =>
    resetInfo.currentNode === 9 || Number(sf(9)) > 0;

  const attemptCreate = (selfFund) => {
    if(!canManage())return {ok:false,reason:'Automation suspended'};
    if(selfFund){
      const cost=150e9,hold=Math.max(0,Number(ns.read('reserve.txt'))||0);
      if(ns.getPlayer().money<cost+hold)return {ok:false,reason:'Self-funding would consume reserved player cash'};
    }
    const label = selfFund ? "self-fund" : "seed";
    const eligible = safe(`Check ${label} eligibility`, () => c.canCreateCorporation(selfFund));
    if (eligible !== "Success") return { ok: false, reason: `${label}: ${String(eligible)}` };
    if(selfFund&&!claimSpending(ns,'corporation',150e9))return {ok:false,reason:'Waiting for corporation funding allowance'};
    safe(`Create corporation (${label})`, () => c.createCorporation(name, selfFund));
    if (safe("Confirm corporation", () => c.hasCorporation()) === true)
      return { ok: true, label };
    return { ok: false, reason: `${label}: creation rejected` };
  };

  while (!safe("Check corporation API", () => c.hasCorporation())) {
 automationHeartbeat(ns);
    if(isScriptPaused(ns,ns.getScriptName())||!achievementActionAllowed(ns,'corporation'))return;
    if(maintenanceRequested(ns)){await ns.sleep(1000);continue;}
    const seed = attemptCreate(false);
    if (seed.ok) { ns.print(`Created ${name} with seed money.`); break; }
    const self = attemptCreate(true);
    if (self.ok) { ns.print(`Created ${name} with self-funding.`); break; }
    ns.print(`Waiting for corporation creation eligibility (${seed.reason}; ${self.reason}).`);
    await ns.sleep(60_000);
  }

  const expand = (division, city) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (!d || d.cities.includes(city) || !hasUnlock('Warehouse API')) return;
    // Finish existing sites before committing another office-only expansion.
    if(d.cities.some(location=>safe('Expansion prerequisite warehouse',()=>c.hasWarehouse(division,location))!==true))return;
    const officeCost=Number(constants.officeInitialCost)||4e9,warehouseCost=Number(constants.warehouseInitialCost)||5e9;
    const packageCost=officeCost+warehouseCost+20e6;
    if(funds()>reserve+packageCost)capitalPurchase(`Expand ${division} to ${city}`,packageCost,()=>{
      const current=c.getDivision(division);
      if(current.cities.includes(city))return false;
      c.expandCity(division,city);
      if(!c.hasWarehouse(division,city))c.purchaseWarehouse(division,city);
      return true;
    },1/packageCost,1);
  };
  const createDivision = (industry, division) => {
    if (hasDivision(division)) return true;
    const data = safe(`Get ${industry} data`, () => c.getIndustryData(industry));
    const start = data?.startingCost;
    const core=[agri,chem,tobacco].includes(division);
    const funding=corporationCoreFunding(funds(),reserve,start,growthBank,core?5e9:0);
    if(funding.ready){
      if(core)growthBank=funding.budget;
      return capitalPurchase(`Create ${industry} division`,start,()=>c.expandIndustry(industry,division),1/start,core?2:0);
    }
    return false;
  };
  const buyUnlock = (unlock) => {
    if (hasUnlock(unlock)) return;
    const cost = safe(`Get ${unlock} cost`, () => c.getUnlockCost(unlock));
    if (Number.isFinite(cost) && cost > 0)
      capitalPurchase(`Buy ${unlock}`,cost,()=>c.purchaseUnlock(unlock),1/cost,2);
  };
  const growthPlans=new Map();let growthDecisions=[];let advertisingRecovery=new Map();const marketRows=new Map();let growthMarket=null;
  const calibrationScope=JSON.stringify([resetInfo.lastNodeReset,resetInfo.lastAugReset,corp()?.name]),calibrationFile='tasks/corporation-upgrade-calibration.json';let calibrationState=null;
  try{calibrationState=JSON.parse(ns.read(calibrationFile));}catch{}
  try{const m=JSON.parse(ns.read('tasks/corporation-growth-market.json'));if(m.scope===JSON.stringify([resetInfo.lastNodeReset,corp()?.name])&&Number.isFinite(m.at)&&m.at<=Date.now()&&Date.now()-m.at<=120000)growthMarket=m;}catch{}
  const capitalPurchase = (label,cost,fn,score=1/Math.max(1,cost),priority=0,commit=0,market=null) => {
    if(recovering||!Number.isFinite(cost)||cost<=0)return false;
    const plan={label,cost,score,priority,commit,market,...(market?.exclusive?{exclusive:market.exclusive}:{}),run:()=>{if(!canManage()||funds()<=reserve+cost)return false;return attempt(label,fn);}};
    // Foundation unlocks/first core divisions must exist before this pass can assign work.
    if(priority>=2){const result=executeCorporationGrowth([plan],growthBank,funds,()=>reserve,canManage);growthBank=result.remaining;growthDecisions.push(...result.decisions);return result.decisions.some(d=>d.state==='purchased');}
    growthPlans.set(label,plan);return false;
  };
  const advertQueue=new Set(),advertisingCandidates=new Map();
  const hireAdVert=division=>advertQueue.add(division);
  const buyAdVert = (division) => {
    const d=safe('Read advertising division',()=>c.getDivision(division));
    let goals;try{goals=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
    if(!d||supportAdvertLimit(d,goals?.expiresAt>Date.now()&&goals.finance)||d.awareness===Number.MAX_VALUE&&d.popularity===Number.MAX_VALUE)return;
    const adCost = safe(`Get AdVert cost (${division})`, () => c.getHireAdVertCost(division));
    const cash = funds();
    if (!Number.isFinite(adCost) || adCost > cash * ADVERT_SPEND_FRACTION || cash <= adCost + reserve)
      return;
    const industry=safe('Advert industry',()=>c.getIndustryData(d.industry))||{},wilsonLevel=safe('Advert analytics',()=>c.getUpgradeLevel('Wilson Analytics'));
    const benefit=corporationAdvertBenefit(d,industry,wilsonLevel||0);
    if(benefit<=0&&!goals?.finance)return;
    let delayMs=3*cycleSeconds*1000;
    if(d.makesProducts){
      const products=(d.products||[]).map(name=>safe('Read advertising product readiness',()=>c.getProduct(division,d.cities[0],name))).filter(Boolean),pending=products.find(p=>p.developmentProgress<100);
      const metric=productMetrics[division],needsProduct=!products.some(p=>p.developmentProgress>=100),city=needsProduct&&pending&&((metric?.name===pending.name?metric.city:null)||pending.creationCity);
      const office=city?safe('Read advertising development productivity',()=>c.getOffice(division,city)):null;
      const pendingMs=pending?corporationDevelopmentDelay(office,pending.developmentProgress,cycleSeconds):null;
      delayMs=corporationAdvertisingDelay(products,pendingMs,cycleSeconds);
    }
    capitalPurchase(`Hire AdVert (${division})`,adCost,()=>{
      const before=c.getDivision(division).numAdVerts,price=c.getHireAdVertCost(division);
      if(Number.isSafeInteger(d.numAdVerts)&&before!==d.numAdVerts||!Number.isFinite(price)||price<=0||price>adCost||funds()<=reserve+price)return false;
      c.hireAdVert(division);const live=c.getDivision(division).numAdVerts;
      if(Number.isSafeInteger(d.numAdVerts)&&!(live>d.numAdVerts))return false;
      if(live>d.numAdVerts)advertisingRecovery.delete(division);return true;
    },Math.max(.001,benefit)/adCost,0,0,{kind:'sales',division,exclusive:['advert:'+division],delay:{kind:'advertising',ms:delayMs}});
    if(advertisingRecovery.size||Date.now()-lastUpgrade<30000)return;
    const level=wilsonLevel,wilsonCost=safe('Quote bundled Wilson cost',()=>c.getUpgradeLevelCost('Wilson Analytics'));
    const quote=quoteCorporationAdvertisingCandidate({division:d,industry,level,wilsonCost,advertCost:adCost,benefit:corporationAdvertBenefit});
    if(quote&&wilsonCost<=cash*.35&&quote.cost<=cash*ADVERT_SPEND_FRACTION&&cash>reserve+quote.cost)advertisingCandidates.set(division,quote);
  };

  // ---- IPO / dividends --------------------------------------------------
  const manageIPO = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info || info.public || financeDecision?.holdIPO) return;
    const valuation = Number(info.valuation) || 0;
    if (valuation < IPO_VALUATION) return;
    if (attempt("Go public", () => c.goPublic(0)))
      ns.print(`IPO at $${ns.format.number(valuation)} valuation; issued 0 shares.`);
  };

  const playerCashBottleneck = () => {
    try {
      const plan = JSON.parse(ns.read('tasks/spending-plan.json'));
      return plan.reset === ns.getResetInfo().lastAugReset && plan.expiresAt > Date.now() &&
        Number.isFinite(plan.epoch) && plan.epoch <= Date.now() &&
        plan.signals?.bottleneck === 'cash' && ns.ps('home').some(p => p.pid === plan.ownerPid);
    } catch { return false; }
  };
  const manageDividends = () => {
    if (!PAY_DIVIDENDS) return;
    const info = corp();
    if (!info?.public) return;
    const wallet = Number(ns.getPlayer().money) || 0;
    const playerReserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
    const rate = growthPriority || recovering || Number(info.revenue) <= Number(info.expenses) ? 0 :
      Math.min(DIVIDEND_MAX, Math.max(dividendRateFor(funds()), (wallet < playerReserve + 1e9 || playerCashBottleneck()) && funds() > reserve * 5 ? 0.2 : 0));
    const actualRate = Number.isFinite(info.dividendRate) ? info.dividendRate : lastDividendRate;
    if (rate === actualRate) { lastDividendRate = rate; return; }
    if (attempt(`Set dividend rate ${(rate * 100).toFixed(0)}%`, () => c.issueDividends(rate)))
      lastDividendRate = rate;
  };

  // ---- Hash spends ------------------------------------------------------
  const cSafeHashCost=action=>{try{return ns.hacknet.hashCost(action);}catch{return Infinity;}};
  const spendHashes = async () => {
    if(!achievementActionAllowed(ns,"hashSpending"))return null;
    if (!SELL_HASHES_FOR_CORP || !hasHacknetServers()) return null;

    let available = 0;
    try { available = Number(ns.hacknet.numHashes()) || 0; }
    catch { return null; }

    const research=divisions().flatMap(name=>{
      const d=safe('Read hash research division',()=>c.getDivision(name));if(!d)return [];
      const lab=safe('Read hash laboratory',()=>c.hasResearched(name,'Hi-Tech R&D Laboratory'))===true,ta2=safe('Read hash pricing',()=>c.hasResearched(name,'Market-TA.II'))===true;
      if(ta2)return [];
      const next=lab?'Market-TA.II':'Hi-Tech R&D Laboratory',first=lab&&safe('Read hash prerequisite',()=>c.hasResearched(name,'Market-TA.I'))!==true?safe('Quote hash prerequisite',()=>c.getResearchCost(name,'Market-TA.I')):0;
      const cost=first+safe('Quote hash research',()=>c.getResearchCost(name,next)),context=researchContext(name,d),points=d.researchPoints;
      const before=corporationResearchDecision({name:next,cost,points,context}),after=corporationResearchDecision({name:next,cost,points:points+1000,context});
      return !before.ready&&after.ready?[{division:name,name:next,cost:after.target,points}]:[];
    });
    const liveFunding=growthGoal?{...growthGoal,cashGap:Math.max(0,growthGoal.cost-Math.max(0,funds()-reserve))}:null;
    hashMilestone=corporationHashMilestone(liveFunding,research,{funds:funds(),reserve,fundCost:cSafeHashCost('Sell for Corporation Funds'),researchCost:cSafeHashCost('Exchange for Corporation Research')});
    await ns.write('tasks/corporation-hash-goal.json',JSON.stringify({schemaVersion:1,at:Date.now(),ownerPid:ns.pid,nodeReset:resetInfo.lastNodeReset,augReset:resetInfo.lastAugReset,priority:growthPriority,milestone:hashMilestone}),'w');
    if(!canManage())return null;
    const targets=hashMilestone?[hashMilestone.action,...HASH_SPEND_PLAN.filter(a=>a!==hashMilestone.action)]:HASH_SPEND_PLAN;
    for (let n = 0; n < targets.length; n++) {
      const idx = hashMilestone?n:(hashSpendIndex + n) % targets.length;
      const target = targets[idx];

      let cost = 0;
      try { cost = Number(ns.hacknet.hashCost(target)); }
      catch { continue; }
      if (!Number.isFinite(cost) || cost <= 0 || cost > MAX_HASH_COST_PER_PURCHASE) continue;
      if (available < cost) continue;

      const corp=c.getCorporation();
      const useful=target==='Sell for Corporation Funds'?corp.funds<Math.max(1e9,Number(corp.expenses||0)*60)||(hashMilestone?.action===target&&growthGoal?.cost>corp.funds-reserve&&growthGoal.cost-(corp.funds-reserve)<=1e9):research.some(r=>{
        const points=c.getDivision(r.division).researchPoints;
        return !c.hasResearched(r.division,r.name)&&points<r.cost&&r.cost<=points+1000;
      });
      if (attempt(`Spend hashes on ${target}`, () => spendHashesWithPolicy(ns,target,undefined,1,{ownerPid:ns.pid,script:'corporation-manager.js',corporationUseful:useful},hashSpendingDecision).success)) {
        hashSpendIndex = (idx + 1) % HASH_SPEND_PLAN.length;
        return target;
      }
    }
    return null;
  };

  // ---- Hacknet server management ----------------------------------------
  const manageHacknetServers = () => {
    if (!BUY_HACKNET_SERVERS || !hasHacknetServers() || !achievementActionAllowed(ns,"hacknetExpense")) return;

    let numNodes = 0;
    try { numNodes = ns.hacknet.numNodes(); }
    catch { return; }
    const playerReserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
    let budget = Math.max(0, ns.getPlayer().money - playerReserve) * HACKNET_SPEND_FRACTION;
    const canSpend = cost => Number.isFinite(cost) && cost > 0 && cost <= budget && ns.getPlayer().money >= cost + playerReserve;
    if (budget <= 0) return;

    let bought = 0;
    while (numNodes < HACKNET_MAX_SERVERS && bought < 3) {
      let cost = Infinity;
      try { cost = ns.hacknet.getPurchaseNodeCost(); }
      catch { cost = Infinity; }
      if (!canSpend(cost)) break;
      try { if(claimSpending(ns,"hacknet",cost))ns.hacknet.purchaseNode(); }
      catch { break; }
      const after = ns.hacknet.numNodes();
      if (after <= numNodes) break;
      budget = Math.max(0, budget - cost);
      numNodes = after;
      bought++;
    }

    if (numNodes === 0) return;

    const stats = [];
    for (let i = 0; i < numNodes; i++) {
      const s = safe(`Read hacknet node ${i}`, () => ns.hacknet.getNodeStats(i));
      if (s) stats.push({ i, s });
    }

    const totalCapacity = stats.reduce((sum, { s }) => sum + (Number(s.hashCapacity) || 0), 0);
    const currentHashes = Number(ns.hacknet.numHashes()) || 0;
    const capacityTight = totalCapacity > 0 && currentHashes > totalCapacity * 0.5;

    if (capacityTight&&hashSpendingDecision(ns,'__capacity__',{ownerPid:ns.pid,script:'corporation-manager.js'}).allowed) {
      let bestCache = null;
      for (const { i, s } of stats) {
        if (s.cache === undefined || s.cache >= HACKNET_CACHE_TARGET) continue;
        const cost = safe(`cache cost ${i}`, () => ns.hacknet.getCacheUpgradeCost(i, 1));
        if (!canSpend(cost)) continue;
        if (!bestCache || cost < bestCache.cost) bestCache = { i, cost };
      }
      if (bestCache && canSpend(bestCache.cost) && claimSpending(ns,"hacknet",bestCache.cost)) {
        attempt(`Upgrade cache on node ${bestCache.i}`, () => ns.hacknet.upgradeCache(bestCache.i, 1));
        return;
      }
    }

    let best = null;
    for (const { i, s } of stats) {
      const level = Math.max(1, Number(s.level) || 1);
      const ram = Math.max(1, Number(s.ram) || 1);
      const cores = Math.max(1, Number(s.cores) || 1);
      const rateProxy = 0.001 * level * Math.pow(1.07, Math.log2(ram)) * (1 + (cores - 1) / 5);
      if (!Number.isFinite(rateProxy) || rateProxy <= 0) continue;

      const candidates = [
        { type: "level", value: rateProxy / level,
          cost: safe(`level cost ${i}`, () => ns.hacknet.getLevelUpgradeCost(i, 1)) },
        { type: "ram", value: rateProxy * 0.07,
          cost: safe(`ram cost ${i}`, () => ns.hacknet.getRamUpgradeCost(i, 1)) },
        { type: "core", value: rateProxy / (cores + 4),
          cost: safe(`core cost ${i}`, () => ns.hacknet.getCoreUpgradeCost(i, 1)) },
      ];
      for (const cand of candidates) {
        if (!Number.isFinite(cand.cost) || cand.cost <= 0) continue;
        if (!canSpend(cand.cost)) continue;
        const ratio = cand.value / cand.cost;
        if (!best || ratio > best.ratio) best = { ...cand, i, ratio };
      }
    }
    if (!best || !canSpend(best.cost) || !claimSpending(ns,"hacknet",best.cost)) return;
    const upgradeFns = {
      level: () => ns.hacknet.upgradeLevel(best.i, 1),
      ram:   () => ns.hacknet.upgradeRam(best.i, 1),
      core:  () => ns.hacknet.upgradeCore(best.i, 1),
    };
    attempt(`Upgrade ${best.type} on node ${best.i}`, upgradeFns[best.type]);
  };

  // ---- Material export supply chain -------------------------------------
  // exportMaterial throws when either the source or the target warehouse is
  // missing. Both are gated on hasWarehouse so the call only fires when the
  // route is legal. Routes are cached in exportRoutes so the attempt only
  // happens once per (source, city, target, material) tuple per session.
  const exportRoutes = new Set();
  const setupExportChain = (sourceDiv, sourceMat, targetDiv) => {
    const d = safe(`Read ${sourceDiv}`, () => c.getDivision(sourceDiv));
    if (!d?.cities?.length) return;
    for (const city of d.cities) {
      const key = `${sourceDiv}|${city}|${targetDiv}|${sourceMat}`;
      if (exportRoutes.has(key)) continue;
      if (!safe(`Check ${sourceDiv}/${city} wh`, () => c.hasWarehouse(sourceDiv, city))) continue;
      if (!safe(`Check ${targetDiv}/${city} wh`, () => c.hasWarehouse(targetDiv, city))) continue;
      const material = safe('Read existing export routes', () => c.getMaterial(sourceDiv, city, sourceMat));
      if (Array.isArray(material?.exports)) {
        if (material.exports.some(route => route.division === targetDiv && route.city === city)) continue;
      }
      if (attempt(`Export ${sourceMat} → ${targetDiv}`, () =>
        c.exportMaterial(sourceDiv, city, targetDiv, city, sourceMat, EXPORT_FORMULA)))
        exportRoutes.add(key);
    }
  };
  const manageExports = () => {
    const data = divisions().map(name => {
      const division = safe('Read export division', () => c.getDivision(name));
      return { name, industry: division && safe('Read export recipe', () => c.getIndustryData(division.industry)) };
    }).filter(item => item.industry);
    const routes = [];
    data.sort((a,b)=>Number(b.industry.makesProducts)-Number(a.industry.makesProducts));
    for (const target of data) for (const material of Object.keys(target.industry.requiredMaterials || {})) {
      const source = data.find(item => item.name !== target.name && item.industry.producedMaterials?.includes(material));
      if (source) routes.push([source.name, material, target.name]);
    }
    if (!routes.length) return;
    buyUnlock('Export');
    if (!hasUnlock('Export') || !hasUnlock('Warehouse API')) return;
    for (const route of routes) setupExportChain(...route);
  };

  // ---- Per-city office management ---------------------------------------
  const inCity = (division, city) =>
    safe(`Read division ${division}`, () => c.getDivision(division))?.cities?.includes(city) === true;
  let researchCycle=0;
  const researchContexts=new Map(),researchSamples=new Map(),researchDecisions={},upkeepHistory=new Map(),upkeepPaid=new Map();
  const recordUpkeep=(division,kind,cost)=>{const paid=upkeepPaid.get(division)||{tea:0,party:0};paid[kind]+=cost;upkeepPaid.set(division,paid);};
  const researchStateFile='tasks/corporation-research-state.json';
  try{const saved=JSON.parse(ns.read(researchStateFile));if(saved.nodeReset===resetInfo.lastNodeReset&&saved.corporation===corp()?.name){for(const [division,sample]of Object.entries(saved.divisions||{}))researchSamples.set(division,sample);for(const [division,samples]of Object.entries(saved.upkeep||{}))upkeepHistory.set(division,samples);}}catch{}
  const researchContext=(division,d)=>{
    if(researchContexts.has(division))return researchContexts.get(division);
    const rate=corporationResearchRate(researchSamples.get(division),d.researchPoints);
    const industry=safe('Read research quality factors',()=>c.getIndustryData(d.industry));
    const factor=industry?.scienceFactor,qualityRows=[];
    const operationalCities=(d.cities||[]).filter(city=>safe('Research warehouse availability',()=>c.hasWarehouse(division,city))===true);
    if(!d.makesProducts)for(const city of operationalCities){
      const office=safe('Read research quality office',()=>c.getOffice(division,city));
      const ai=safe('Read research quality AI',()=>c.getMaterial(division,city,'AI Cores'));
      const inputs=Object.keys(industry?.requiredMaterials||{}).map(name=>safe('Read research input quality',()=>c.getMaterial(division,city,name))?.quality);
      if(!office||!ai||inputs.some(v=>!Number.isFinite(v)))continue;
      qualityRows.push({engineering:Number(office.employeeProductionByJob?.Engineer),aiStored:ai.stored,aiFactor:industry?.aiCoreFactor??0,inputQuality:inputs.length?inputs.reduce((sum,n)=>sum+n,0)/inputs.length:1});
    }
    const sales=Object.values(growthMarket?.locations||{}).filter(r=>r.division===division&&r.ready&&Number.isFinite(r.sellThrough));
    const sellThrough=sales.length?Math.min(...sales.map(r=>r.sellThrough)):null;
    const products=(d.products||[]).map(name=>safe('Read research product capacity',()=>c.getProduct(division,d.cities[0],name))).filter(Boolean);
    const autoTea=safe('Read automatic tea research',()=>c.hasResearched(division,'AutoBrew'))===true,autoParty=safe('Read automatic party research',()=>c.hasResearched(division,'AutoPartyManager'))===true;
    const upkeepOffices=(d.cities||[]).map(city=>({office:{...safe('Read upkeep research office',()=>c.getOffice(division,city)),autoTea,autoParty},fundedBudget:upkeepAllocations.get(division+'/'+city)||0}));
    const upkeepValues=corporationUpkeepResearchValues(upkeepOffices,{samples:upkeepHistory.get(division),revenue:d.lastCycleRevenue,expenses:d.lastCycleExpenses,cycleSeconds});
    const context={upkeepValues,valid:options['development-speed']&&Number.isFinite(factor)&&(d.makesProducts||qualityRows.length===operationalCities.length&&qualityRows.length>0),rate,scienceFactor:factor,products:d.makesProducts,qualityRows,
      salesReady:sales.length===operationalCities.length&&sales.length>0,sellThrough,backlog:sales.some(r=>r.backlog),pricingGap:sales.length?Math.max(0,1-sellThrough):null,
      matureProducts:products.filter(p=>p.developmentProgress>=100).length,maxProducts:d.maxProducts,canFundProduct:productInvestment(funds(),reserve,growthBank)>=10e6};
    researchContexts.set(division,context);return context;
  };
  const staffingGoals=new Map();
  const runOffice = (division, city, production, productDivision = false) => {
    if (!hasUnlock("Office API")) return;
    let office = safe(`Read office ${division}/${city}`, () => c.getOffice(division, city));
    if (!office) return;
    const divisionInfo=safe('Read office development role',()=>c.getDivision(division));
    if(!productDivision&&safe('Research-only warehouse',()=>c.hasWarehouse(division,city))===false){
      const counts=officeOnlyResearchJobs(office);
      if(counts&&!officeJobs.every((job,i)=>Number(office.employeeJobs?.[job]??-1)===counts[i])){
        for(const job of officeJobs)attempt('Clear idle office '+job,()=>c.setJobAssignment(division,city,job,0));
        for(let i=0;i<officeJobs.length;i++)if(counts[i])attempt('Assign idle office '+officeJobs[i],()=>c.setJobAssignment(division,city,officeJobs[i],counts[i]));
      }
      return;
    }
    let researchGoal=staffingGoals.get(division);
    if(!researchGoal){
      const laboratory=safe('Read staffing laboratory',()=>c.hasResearched(division,'Hi-Tech R&D Laboratory'))===true,ta1=safe('Read staffing TA.I',()=>c.hasResearched(division,'Market-TA.I'))===true,ta2=hasTA2(division);
      researchGoal=corporationResearchGoal({laboratory,ta1,ta2,points:divisionInfo?.researchPoints,laboratoryCost:laboratory?0:safe('Staffing lab cost',()=>c.getResearchCost(division,'Hi-Tech R&D Laboratory')),ta1Cost:ta1?0:safe('Staffing TA.I cost',()=>c.getResearchCost(division,'Market-TA.I')),ta2Cost:ta2?0:safe('Staffing TA.II cost',()=>c.getResearchCost(division,'Market-TA.II'))},productDivision,researchContext(division,divisionInfo));
      staffingGoals.set(division,researchGoal);
    }
    const officeProducts=productDivision?(divisionInfo?.products||[]).map(p=>safe('Read developing product',()=>c.getProduct(division,city,p))).filter(Boolean):[];
    const rawPending=officeProducts.find(p=>p.developmentProgress<100);
    const offices=(productDivision?divisionInfo?.cities||[]:[]).filter(location=>safe('Development storage',()=>c.hasWarehouse(division,location))).map(location=>({...safe('Read development office',()=>c.getOffice(division,location)),city:location}));
    const pendingCity=rawPending&&productMetrics[division]?.name===rawPending.name?productMetrics[division]?.city:null;
    const pending=rawPending&&pendingCity?{...rawPending,creationCity:pendingCity}:null;
    const developmentCity=productDivision?corporationDevelopmentCity(offices,pending):null;
    const developing=productDivision&&(city===developmentCity||rawPending&&!pendingCity);
    let target = productDivision
      ? (funds() > 1e15 ? 120 : funds() > 1e14 ? 100 : funds() > 1e13 ? 80 : funds() > 1e12 ? 60 : 30)
      : (funds() > 1e13 ? 60 : funds() > 5e12 ? 45 : funds() > 1e12 ? 30 : funds() > 1e11 ? 20 : funds() > 1e10 ? 15 : funds() > 1e9 ? 9 : 3);
      if(productDivision&&!developing)target=Math.max(9,Math.floor(target/2));
      if(developing&&city===developmentCity&&options['development-speed']&&!recovering&&office.size>=target&&!outputBacklog(officeProducts.filter(p=>p.developmentProgress>=100))){
        const metric=productMetrics[division],progress=Number(rawPending?.developmentProgress),elapsed=metric?.name===rawPending?.name&&metric?.startedAt?Math.max(0,Date.now()-metric.startedAt):0;
        const remainingMs=rawPending&&progress>0&&progress<100&&elapsed>0?Math.min(3600000,elapsed*(100-progress)/progress):null;
        const expansion=corporationDevelopmentExpansion({size:office.size,cost:safe('Quote development increment',()=>c.getOfficeSizeUpgradeCost(division,city,3)),free:Math.max(0,funds()-reserve),profitPerSecond:Math.max(0,(Number(divisionInfo.lastCycleRevenue)-Number(divisionInfo.lastCycleExpenses))),remainingMs});
        if(expansion.ready)target=office.size+3;
      }
      let achievements;try{achievements=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
      if(achievements?.expiresAt>Date.now()&&achievements.finance&&!achievements.owned?.includes('CORPORATION_EMPLOYEE_3000'))target=Math.max(target,500);
      if (office.size < target) {
      if(developing&&options['development-speed']&&!recovering){
        const free=Math.max(0,funds()-reserve);
        const allocation=office.size<9?Math.min(5e9,free):free*.5;
        growthBank=Math.min(free,Math.max(growthBank,allocation));
      }
      let add = target - office.size;
      let cost = safe("Get office size cost", () => c.getOfficeSizeUpgradeCost(division, city, add));
      if(add>3&&cost>growthBank){add=3;cost=safe("Get incremental office cost",()=>c.getOfficeSizeUpgradeCost(division,city,add));}
      if (Number.isFinite(cost) && funds() > cost + reserve) {
        const fraction=Math.pow((office.size+add)/Math.max(1,office.size),developing?.34:.4)-1;
        capitalPurchase('Upgrade office '+division+'/'+city,cost,()=>c.upgradeOfficeSize(division,city,add),fraction*(developing?3:1)/cost,developing?(options['development-speed']?2:1):0,0,{kind:developing?'development':'production',division,city});
        office = safe("Refresh office", () => c.getOffice(division, city)) ?? office;
      }
    }
    for (let i = office.numEmployees ?? 0; i < (office.size ?? 0); i++) {
      if (!safe("Hire employee", () => c.hireEmployee(division, city))) break;
    }
    office = safe("Refresh employees", () => c.getOffice(division, city)) ?? office;
    const employees = office.numEmployees ?? 0;
    if (employees > 0) {
      const recoveryGap = Number(office.employeeJobs?.Intern) > 0 ? 2 : 5;
      const needsRecovery = office.avgEnergy < (office.maxEnergy ?? 100) - recoveryGap || office.avgMorale < (office.maxMorale ?? 100) - recoveryGap;
      let officeUpkeep=Math.min(upkeepBudget,upkeepAllocations.get(division+'/'+city)||0);
      const upkeepNeed=corporationOfficeUpkeepNeed(office,teaCostPerEmployee);
      const cannotFundUpkeep = recovering || officeUpkeep < upkeepNeed.total;
      let materialQuality;
      if(!productDivision&&hasUnlock('Warehouse API')&&safe('Staffing quality warehouse',()=>c.hasWarehouse(division,city))){
        const industry=safe('Read quality factors',()=>c.getIndustryData(divisionInfo.industry));
        const inputQualities=Object.keys(industry?.requiredMaterials||{}).map(material=>Number(safe('Read input quality',()=>c.getMaterial(division,city,material))?.quality)).filter(Number.isFinite);
        materialQuality={points:Number(divisionInfo.researchPoints)||0,researchFactor:corporationScienceFactor(industry),aiStored:Number(safe('Read quality AI cores',()=>c.getMaterial(division,city,'AI Cores'))?.stored)||0,aiFactor:Number(industry?.aiCoreFactor)||0,inputQuality:inputQualities.length?inputQualities.reduce((a,b)=>a+b,0)/inputQualities.length:1};
      }
      const counts = optimizedOfficeJobs(office,!!production,developing,needsRecovery && cannotFundUpkeep,{...researchGoal,researchPulse:researchCycle%5===0,developmentSpeed:developing&&options['development-speed'],researchWeight:developing?Math.max(.12,researchGoal.researchWeight):researchGoal.researchWeight,materialQuality});
      const jobs = office.employeeJobs;
      const aligned = jobs && officeJobs.every((job, i) => Number(jobs[job] ?? -1) === counts[i]);
      if (!aligned) {
        for (const job of officeJobs) attempt(`Clear ${job}`, () => c.setJobAssignment(division, city, job, 0));
        for (let i = 0; i < officeJobs.length; i++)
          if (counts[i]) attempt(`Assign ${officeJobs[i]}`, () => c.setJobAssignment(division, city, officeJobs[i], counts[i]));
      }
      const teaCost = employees * teaCostPerEmployee;
      if (!recovering && office.avgEnergy < (office.maxEnergy ?? 100) - 2 && teaCost <= officeUpkeep && funds() >= reserve) {
        const success = safe('Buy employee tea', () => c.buyTea(division, city));
        if (success === true) {upkeepBudget -= teaCost;officeUpkeep-=teaCost;reserve-=teaCost;recordUpkeep(division,'tea',teaCost);}
      }
      const allowance = Math.max(0, Math.min(officeUpkeep, funds() - reserve + officeUpkeep));
      const partyPerEmployee = partySpendPerEmployee(office.avgMorale, office.maxMorale ?? 100, employees, allowance);
      if (!recovering && partyPerEmployee > 0) {
        const result = safe('Throw budgeted party', () => c.throwParty(division, city, partyPerEmployee));
        if (Number(result) > 1) {const paid=partyPerEmployee*employees;upkeepBudget-=paid;officeUpkeep-=paid;reserve-=paid;recordUpkeep(division,'party',paid);}
      }
    }
  };

  // ---- Agriculture inputs and boosts ------------------------------------
  let inputBudget = 0;
  const manageInputs = (division, city) => {
    const d = safe('Read input division', () => c.getDivision(division));
    const industry = d && safe('Read input recipe', () => c.getIndustryData(d.industry));
    if (!industry) return;
    const recipe = industry.requiredMaterials || {};
    if (hasUnlock('Smart Supply')) {
      for (const material of Object.keys(recipe)) {
        attempt('Clear manual input', () => c.buyMaterial(division, city, material, 0));
        if (constants.smartSupplyOptions?.includes('leftovers'))
          attempt('Use exports before purchased inputs', () => c.setSmartSupplyOption(division, city, material, 'leftovers'));
      }
      return;
    }
    let production = 0;
    for (const material of industry.producedMaterials || [])
      production = Math.max(production, Number(safe('Read input demand', () => c.getMaterial(division, city, material))?.productionAmount) || 0);
    for (const product of d.products || [])
      production += Number(safe('Read product input demand', () => c.getProduct(division, city, product))?.productionAmount) || 0;
    const items = Object.fromEntries(Object.keys(recipe).map(material => [material, safe('Read input inventory', () => c.getMaterial(division, city, material))]));
    const warehouse = safe('Read input storage', () => c.getWarehouse(division, city));
    const budget = warehouse && warehouse.sizeUsed < warehouse.size * 0.95 ? Math.min(inputBudget, Math.max(0, funds() - reserve)) : 0;
    const plan = recipeInputPlan(recipe, items, production, budget, cycleSeconds);
    for (const order of plan.orders) attempt('Set recipe input rate', () => c.buyMaterial(division, city, order.name, order.rate));
    inputBudget -= plan.cost;
    reserve += plan.cost; // These rates will be charged during PURCHASE; reserve them now.
  };
  const boosts = [
    { name: "Real Estate", factor: 0.72, size: 0.005 },
    { name: "Hardware", factor: 0.2, size: 0.06 },
    { name: "Robots", factor: 0.3, size: 0.5 },
    { name: "AI Cores", factor: 0.3, size: 0.1 },
  ];
  const boostKeys = { 'Real Estate': 'realEstateFactor', Hardware: 'hardwareFactor', Robots: 'robotFactor', 'AI Cores': 'aiCoreFactor' };
  // buyMaterial sets a rate the game charges every PURCHASE cycle until
  // overwritten. Every early return in manageBoosts must zero the rate,
  // otherwise a stale rate from a prior cycle keeps draining funds.
  const recipeBoosts = division => {
    const d = safe('Read boost recipe division', () => c.getDivision(division));
    return d && safe('Read boost recipe', () => c.getIndustryData(d.industry))?.requiredMaterials || {};
  };
  const clearBoostRates = (division, city) => {
    const recipe = recipeBoosts(division);
    for (const b of boosts.filter(item => !(item.name in recipe)))
      attempt(`Clear ${b.name} buy rate`, () => c.buyMaterial(division, city, b.name, 0));
  };
  const manageBoosts = (city, division = agri) => {
    clearBoostRates(division,city);
    if(boostBudget<=0||marketRows.get(division+'/'+city)?.backlog)return;
    const wh = safe("Read warehouse", () => c.getWarehouse(division, city));
    if (!wh) return;
    const full = wh.sizeUsed / Math.max(1, wh.size) > 0.9;
    const divisionInfo = safe(`Read ${division}`, () => c.getDivision(division));
    const industry = safe('Read industry factors', () => c.getIndustryData(divisionInfo?.industry));
    const materials = boosts.filter(b => !(b.name in (industry?.requiredMaterials || {}))).map(b => ({ ...b,
      factor: Number.isFinite(industry?.[boostKeys[b.name]]) ? industry[boostKeys[b.name]] : b.factor,
      size: Number(safe(`Read ${b.name} size`, () => c.getMaterialData(b.name))?.size) || b.size,
    }));
    const targets = optimalBoostTargets(materials, wh.size * BOOST_WAREHOUSE_FRACTION);
    const plan = materials.map((b) => {
      const item = safe(`Read ${b.name}`, () => c.getMaterial(division, city, b.name));
      const target = targets[b.name];
      const price = Number(item?.marketPrice) || 0;
      const need = full || price <= 0 ? 0 : Math.max(0, target - (Number(item?.stored) || 0));
      return {name:b.name,need,cost:need*price,stored:Number(item?.stored)||0,factor:b.factor};
    });
    const total = plan.reduce((a, p) => a + p.cost, 0);
    if (total <= 0) { clearBoostRates(division, city); return; }
    const spend = Math.max(0, Math.min(boostBudget, total, funds() - reserve));
    const scale = total > spend ? spend / total : 1;
    const committed=total*scale;
    const benefit=Math.expm1(Math.min(20,.73*plan.reduce((sum,p)=>sum+p.factor*Math.log((1+.002*(p.stored+p.need*scale))/(1+.002*p.stored)),0)));
    boostBudget-=committed;
    capitalPurchase('Boost inventory '+division+'/'+city,committed,()=>{
      for(const p of plan)if(!attempt('Set boost order',()=>c.buyMaterial(division,city,p.name,p.need*scale/cycleSeconds))){clearBoostRates(division,city);return false;}
      reserve+=committed;return true;
    },benefit/Math.max(1,committed),0,committed,{kind:'production',division,city});

  };

  // ---- Research ---------------------------------------------------------
  const runResearch = (division, order) => {
    const d=safe('Read research division',()=>c.getDivision(division));if(!d)return;
    const points=d.researchPoints??0,context=researchContext(division,d);let spent=0;
    const decision=(name,cost)=>{const result=corporationResearchDecision({name,points,cost,context});researchDecisions[division]={name,cost,points,...result};return result.ready;};
    const purchase=name=>{
      const cost=safe('Requote research cost',()=>c.getResearchCost(division,name)),live=safe('Recheck research points',()=>c.getDivision(division));
      if(!Number.isFinite(cost)||cost<0||!Number.isFinite(live?.researchPoints)||live.researchPoints<cost)return false;
      if(!attempt('Research '+name,()=>c.research(division,name)))return false;spent+=cost;return true;
    };
    try{
      if(safe('Check laboratory',()=>c.hasResearched(division,'Hi-Tech R&D Laboratory'))!==true){
        const cost=safe('Laboratory cost',()=>c.getResearchCost(division,'Hi-Tech R&D Laboratory'));
        if(decision('Hi-Tech R&D Laboratory',cost))purchase('Hi-Tech R&D Laboratory');return;
      }
      if(!hasTA2(division)){
        const hasTA1=safe('Check TA.I',()=>c.hasResearched(division,'Market-TA.I'))===true;
        const first=hasTA1?0:safe('TA.I cost',()=>c.getResearchCost(division,'Market-TA.I')),second=safe('TA.II cost',()=>c.getResearchCost(division,'Market-TA.II'));
        if(Number.isFinite(first)&&Number.isFinite(second)&&decision('Market-TA.II',first+second)){
          if(!hasTA1&&!purchase('Market-TA.I'))return;
          if(safe('Confirm TA.I',()=>c.hasResearched(division,'Market-TA.I'))===true)purchase('Market-TA.II');
        }return;
      }
      const available=[...order,...extraResearch,...(constants.researchNamesBase||[]),...(d.makesProducts?constants.researchNamesProductOnly||[]:[])];
      const optionalAutomation=new Set(['HRBuddy-Recruitment','HRBuddy-Training','uPgrade: Dashboard']);
      const bundleNames=[...new Set(available)].filter(name=>!optionalAutomation.has(name));
      const owned=bundleNames.filter(name=>safe('Read bundle research ownership',()=>c.hasResearched(division,name))===true);
      const costs=Object.fromEntries(bundleNames.filter(name=>!owned.includes(name)).map(name=>[name,safe('Quote research package',()=>c.getResearchCost(division,name))]));
      const bundle=planCorporationResearchBundles({names:bundleNames,owned,costs,parents:researchParents,points,context})[0];
      if(bundle){
        const result=executeCorporationResearchBundle({owned:name=>safe('Recheck package ownership',()=>c.hasResearched(division,name)),cost:name=>safe('Requote package research',()=>c.getResearchCost(division,name)),points:()=>safe('Recheck package balance',()=>c.getDivision(division))?.researchPoints,buy:purchase},bundle,canManage);
        researchDecisions[division]={name:bundle.target,package:bundle.items.map(item=>item.name),cost:bundle.cost,points,...bundle.decision,...result};return;
      }
      for(const name of new Set(available)){
        if(optionalAutomation.has(name)||['Drones','Automatic Drug Administration'].includes(name)||safe('Check research',()=>c.hasResearched(division,name))===true)continue;
        const parent=researchParents[name]||'Hi-Tech R&D Laboratory';if(safe('Check research parent',()=>c.hasResearched(division,parent))!==true)continue;
        const cost=safe('Get research cost',()=>c.getResearchCost(division,name));
        if(decision(name,cost))purchase(name);break;
      }
    }finally{researchSamples.set(division,{at:Date.now(),points,spent});}
  };
  const hasTA2 = (division) => safe(`Check TA.II ${division}`, () => c.hasResearched(division, "Market-TA.II")) === true;

  // ---- Warehouse management ---------------------------------------------
  // A sales backlog needs pricing recovery before more storage spending.
  let storagePressure = false;
  const runWarehouse = (division, city) => {
    if (!hasUnlock("Warehouse API")) return;
    let has = safe("Check warehouse", () => c.hasWarehouse(division, city)) === true;
    if (!has) {
      capitalPurchase('Purchase warehouse '+division+'/'+city,Number(constants.warehouseInitialCost)||5e9,()=>c.purchaseWarehouse(division,city),1/(Number(constants.warehouseInitialCost)||5e9),2);
      has = safe("Check warehouse after purchase", () => c.hasWarehouse(division, city)) === true;
    }
    if (!has) return;
    const wh = safe("Read warehouse", () => c.getWarehouse(division, city));
    const divisionData = safe('Read warehouse division', () => c.getDivision(division));
    const industryData = safe('Read warehouse outputs', () => c.getIndustryData(divisionData?.industry));
    const outputs = (industryData?.producedMaterials || []).map(material => safe('Read warehouse output', () => c.getMaterial(division, city, material)));
    if (divisionData?.makesProducts) for (const product of divisionData.products || [])
      outputs.push(safe('Read warehouse product', () => c.getProduct(division, city, product)));
    const backlog = outputBacklog(outputs);
    const mature=outputs.filter(o=>o&&(o.developmentProgress===undefined||o.developmentProgress>=100));
    const known=mature.length>0&&mature.every(o=>[o.productionAmount,o.actualSellAmount,o.stored].every(v=>Number.isFinite(v)&&v>=0));
    const sellThrough=known?Math.min(1,...mature.map(o=>o.productionAmount>0?o.actualSellAmount/o.productionAmount:o.stored>0&&o.actualSellAmount===0?0:1)):null;
    const revenue=divisionData?.lastCycleRevenue,expenses=divisionData?.lastCycleExpenses;
    if(wh&&[revenue,expenses].every(Number.isFinite))marketRows.set(division+'/'+city,{key:division+'/'+city,division,city,
      profitPerSecond:(revenue-expenses)/Math.max(1,divisionData.cities.length),expectedCities:divisionData.cities.length,
      outputs:known&&mature.length===outputs.length?mature.map(o=>({name:o.name,sold:o.actualSellAmount,produced:o.productionAmount})):null,
      sellThrough,backlog:known&&backlog,pressure:wh.sizeUsed/Math.max(1,wh.size)});
    let used = wh ? wh.sizeUsed / Math.max(1, wh.size) : 0;
    if (used > 0.8) storagePressure = true;
    for (let level = 0; level < 5 && used > 0.7 && !backlog; level++) {
      const cost = safe("Get warehouse upgrade cost", () => c.getUpgradeWarehouseCost(division, city));
      if (!Number.isFinite(cost) || funds() <= cost + reserve) break;
      capitalPurchase('Upgrade warehouse '+division+'/'+city,cost,()=>c.upgradeWarehouse(division,city),Math.max(.1,used-.7)*3/cost,0,0,{kind:'storage',division,city});
      break;
      const next = safe("Refresh warehouse", () => c.getWarehouse(division, city));
      used = next ? next.sizeUsed / Math.max(1, next.size) : 0;
    }
    if (hasUnlock("Smart Supply")) attempt("Enable Smart Supply", () => c.setSmartSupply(division, city, true));
  };

  // ---- Selling ----------------------------------------------------------
  const productMarkup=new Map(),markupCandidates=new Map(),pricingObservations=new Map();
  const formulaPricing=(division,city,item,materialData=null)=>{
    const d=safe('Read pricing division',()=>c.getDivision(division));
    const industry=d&&safe('Read pricing industry',()=>c.getIndustryData(d.industry));
    const office=safe('Read pricing office',()=>c.getOffice(division,city));
    const bots=safe('Read sales bots',()=>c.getUpgradeLevel('ABC SalesBots'));
    const potential=salesPotential(item,d,industry,office,bots,!!d?.makesProducts);
    if(!potential)return null;
    const key=division+'/'+city+'/'+item.name,markupKey=division+'/'+item.name;
    if(d.makesProducts){
      const previous=pricingObservations.get(key);
      const stable=previous?.potential>0&&Math.abs(potential/previous.potential-1)<.05&&previous.rating>0&&Math.abs(Number(item.effectiveRating)/previous.rating-1)<.05&&previous.base>0&&Math.abs(Number(item.productionCost)/previous.base-1)<.05;
      const observed=stable?inferProductMarkup(item,previous):null;
      if(observed&&!productMarkup.has(markupKey)){
        const candidate=markupCandidates.get(markupKey);
        if(candidate&&Math.abs(observed/candidate-1)<.1)productMarkup.set(markupKey,(observed+candidate)/2);
        else markupCandidates.set(markupKey,observed);
      }
      const markup=productMarkup.get(markupKey);
      if(!markup)return {potential,key};
      return {...formulaSalePrice(item,potential,Math.max(item.effectiveRating,.001)/markup,cycleSeconds),key};
    }
    return formulaSalePrice(item,potential,Number(item.quality)/Number(materialData?.baseMarkup),cycleSeconds);
  };
  const saleMultipliers = new Map();
  const saleTimes = new Map();
  const salePrice = (key, item, automated) => {
    if (automated) return 'MP';
    let state=saleMultipliers.get(key)||{multiplier:priorSaleMultiplier(item?.desiredSellPrice)};
    // Tune after each full market cycle, using only completed sales feedback.
    if(Date.now()-(saleTimes.get(key)||0)>=cycleSeconds*1000){
      state=productPriceStep(item,state,cycleSeconds);
      saleMultipliers.set(key,state);saleTimes.set(key,Date.now());
    }
    const multiplier=state.multiplier;
    return `MP*${multiplier}`;
  };
  // sellMaterial throws when the city has no warehouse. Cities are expanded
  // as funds allow, and warehouses are gated separately on reserve + buffer,
  // so a city can exist without a warehouse. Skip those.
  const sellMaterials = (division, materials) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (!d || d.makesProducts) return;
    const ta2 = hasTA2(division);
    for (const city of d.cities ?? []) {
      if (!safe(`Check ${division}/${city} warehouse`, () => c.hasWarehouse(division, city))) continue;
      for (const material of materials) {
        const item = safe(`Read ${material} sale`, () => c.getMaterial(division, city, material));
        const data = ta2 ? null : safe('Read material markup', () => c.getMaterialData(material));
        const price = ta2 ? 'MP' : formulaPricing(division,city,item,data)?.price || materialSalePrice(item, data);
        attempt(`Sell ${material}`, () => c.sellMaterial(division, city, material, "MAX", price));
        if (ta2)
          attempt(`Market-TA.II ${material}`, () => c.setMaterialMarketTA2(division, city, material, true));
      }
    }
  };

  const sellProducts = (division) => {
    const d = safe(`Read division ${division}`, () => c.getDivision(division));
    if (!d) return;
    const activeCities = d.cities ?? [];
    if (!activeCities.length) return;
    const ta2 = hasTA2(division);
    for (const product of d.products ?? []) {
      const ready = activeCities.every((city) => {
        const item = safe(`Read ${product} in ${city}`, () => c.getProduct(division, city, product));
        return item?.developmentProgress >= 100;
      });
      if (!ready) continue;
      if (ta2) {
        attempt(`Sell ${product}`, () => c.sellProduct(division, activeCities[0], product, "MAX", "MP", true));
        attempt(`Market-TA.II ${product}`, () => c.setProductMarketTA2(division, product, true));
      } else for (const city of activeCities) {
        const item = safe(`Read ${product} sale`, () => c.getProduct(division, city, product));
        const formula=formulaPricing(division,city,item);
        const price=formula?.price||salePrice(`${division}/${city}/${product}`,item,false);
        if(formula?.potential){
          const premium=formula.premium??Math.max(0,(priorSaleMultiplier(price)-1)*Number(item.productionCost));
          pricingObservations.set(formula.key,{potential:formula.potential,target:formula.target??Number(item.productionAmount)+Number(item.stored)/cycleSeconds,premium,rating:Number(item.effectiveRating),base:Number(item.productionCost)});
        }
        if(typeof c.setProductMarketTA1==='function'&&safe('Check TA.I pricing',()=>c.hasResearched(division,'Market-TA.I'))===true)attempt('Disable TA.I for custom pricing',()=>c.setProductMarketTA1(division,product,false));
        attempt(`Sell ${product} in ${city}`, () => c.sellProduct(division, city, product, "MAX", price, false));
      }
    }
  };

  const productMetricsFile='tasks/corporation-product-metrics.json';let productMetrics={},productHistory={};
  try{const saved=JSON.parse(ns.read(productMetricsFile));if(saved.nodeReset===resetInfo.lastNodeReset&&saved.corporation===corp()?.name){productMetrics=saved.divisions||{};productHistory=saved.productsByDivision||{};}}catch{}
  const manageProductDevelopment=division=>{
    const d=safe('Read product cycle',()=>c.getDivision(division));if(!d?.cities?.length||recovering)return;
    const offices=d.cities.filter(city=>safe('Development warehouse',()=>c.hasWarehouse(division,city))).map(city=>({...safe('Development office',()=>c.getOffice(division,city)),city}));
    const products=(d.products||[]).map(name=>safe('Read product progress',()=>c.getProduct(division,d.cities[0],name))).filter(Boolean);
    const history=productHistory[division]||{};
    for(const name of Object.keys(history))if(!d.products.includes(name))delete history[name];
    const previous=productMetrics[division];
    if(previous?.name&&d.products.includes(previous.name)&&!Object.hasOwn(history,previous.name))history[previous.name]=previous;
    productHistory[division]=history;
    const pending=products.find(p=>p.developmentProgress<100),metric=corporationProductBaseline(history,productMetrics[division],productMetrics[division]?.name);
    if(metric.name)productMetrics[division]=metric;
    if(pending){
      if(metric.name!==pending.name)productMetrics[division]=history[pending.name]||{name:pending.name,startedAt:Date.now(),observedOnly:true};
      history[pending.name]=productMetrics[division];
      return;
    }
    if(metric.name&&!metric.finishedAt&&products.some(p=>p.name===metric.name)){metric.finishedAt=Date.now();metric.developmentMs=Math.max(0,metric.finishedAt-metric.startedAt);}
    const investment=productInvestment(funds(),reserve,growthBank);if(!(investment>=10e6))return;
    const prefix=division===restaurant?'Apex Dining':division+' Auto',retiring=products.length>=d.maxProducts?chooseRetirement(products,prefix):null;
    const baseline=corporationProductBaseline(history,metric,retiring?.name);
    const at=Number(baseline.startedAt)||0;
    if(products.length>=d.maxProducts&&(!retiring||products.length<2||!productReplacementReady({product:retiring,investment,at,developmentMs:baseline.developmentMs||0,baselineResearch:baseline.observedOnly?0:baseline.research,baselineEmployees:baseline.observedOnly?0:baseline.employees,research:d.researchPoints,employees:Math.max(0,...offices.map(o=>o.numEmployees||0)),cycleSeconds})))return;
    const city=corporationDevelopmentCity(offices);if(!city)return;
    const developmentMs=corporationDevelopmentDelay(offices.find(o=>o.city===city),0,cycleSeconds);
    const escaped=prefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('^'+escaped+' (\\d+)$');
    const sequence=Math.max(0,...(d.products||[]).map(name=>Number(name.match(pattern)?.[1])||0))+1,name=prefix+' '+sequence;
    capitalPurchase('Develop '+division+'/'+name,2*investment,()=>{
      const live=c.getDivision(division);if(live.products.some(p=>c.getProduct(division,city,p).developmentProgress<100))return false;
      if(live.products.length>=live.maxProducts){if(!retiring||!live.products.includes(retiring.name))return false;c.discontinueProduct(division,retiring.name);}
      c.makeProduct(division,city,name,investment,investment);
      if(!c.getDivision(division).products.includes(name))return false;
      productMetrics[division]={name,city,startedAt:Date.now(),research:live.researchPoints,employees:offices.find(o=>o.city===city)?.numEmployees||0};
      history[name]=productMetrics[division];if(retiring)delete history[retiring.name];
      if(division===restaurant)lastProductAt=Date.now();else otherProductTimes[division]=Date.now();return true;
    },(retiring?.designInvestment>0?Math.max(.1,(investment/retiring.designInvestment)**.1-1):2)/(2*investment),products.length===0?1:0,0,{kind:'development',division,delay:{kind:'product-development',ms:Number.isFinite(developmentMs)?developmentMs+3*cycleSeconds*1000:null}});
  };

  const manageShares = () => {
    if (!options['manage-shares']) return;
    const info = corp();
    if (!info?.public) return;
    const issue = rescueShareIssue(info, reserve, minOwnership);
    if (issue > 0) { attempt('Issue emergency operating capital', () => c.issueNewShares(issue)); return; }
    const wallet = Number(ns.getPlayer().money) || 0;
    const playerReserve = Math.max(0, Number(ns.read('reserve.txt')) || 0);
    const cap=Math.max(0,Math.min(1e12,Math.floor(info.numShares-info.totalShares*minOwnership),Math.floor(info.totalShares*.01),Math.floor(info.numShares)-1));
    let snapshot;try{snapshot=JSON.parse(ns.read('/Temp/affordable-augs.txt')).speedSnapshot;}catch{}
    const pill=readNodeRoutePlan(ns)?.redPill;
    liquidityDecision=corporationLiquidityTarget(snapshot,{augReset:ns.getResetInfo().lastAugReset,wallet,reserve:pill?.active?Math.min(playerReserve,1e9):playerReserve,maxProceeds:estimateShareProceeds(info,cap)});
    if(pill?.active&&!liquidityDecision.augmentation)liquidityDecision={...liquidityDecision,targetCash:wallet,reason:'Preserve ownership until a complete Red Pill funding gap fits the share-sale cap'};
    const sale = shareSale(info, wallet, playerReserve, minOwnership,liquidityDecision.targetCash);
    if (sale > 0) {if(attempt('Sell shares for player liquidity',()=>c.sellShares(sale))){lastShareSaleAt=Date.now();liquidityDecision={...liquidityDecision,at:lastShareSaleAt,shares:sale,estimatedProceeds:estimateShareProceeds(info,sale)};}return;}
    const buyback = options['development-speed'] || recovering || playerCashBottleneck() || Date.now()-lastShareSaleAt<60*60000 ? 0 : shareBuyback(info, wallet, playerReserve, minOwnership);
    if (buyback > 0 && claimSpending(ns,'corporation',buyback*info.sharePrice*1.25)) attempt('Recover public share ownership', () => c.buyBackShares(buyback));
  };
  let lastExpansion = 0, lastBribe = 0;
  const expandIndustries = () => {
    if (recovering || !hasDivision(tobacco) || !hasTA2(tobacco) || Date.now() - lastExpansion < 300000) return;
    const info = corp();
    if (!(Number(info?.revenue) > Number(info?.expenses))) return;
    const current = new Set(divisions().map(division => safe('Read industry presence', () => c.getDivision(division))?.industry));
    const candidates = (constants.industryNames || []).filter(industry => !current.has(industry)).map(industry => ({
      industry, cost: Number(safe('Read expansion cost', () => c.getIndustryData(industry))?.startingCost),
    })).filter(item => item.cost > 0).sort((a, b) => a.cost - b.cost);
    const demand=new Set(divisions().flatMap(name=>Object.keys(safe('Read expansion demand',()=>c.getIndustryData(c.getDivision(name).industry))?.requiredMaterials||{})));
    const existingSupply=new Set(divisions().flatMap(name=>safe('Read expansion supply',()=>c.getIndustryData(c.getDivision(name).industry))?.producedMaterials||[]));
    let achievementGoal;try{achievementGoal=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
    const estateNeeded=achievementGoal?.expiresAt>Date.now()&&achievementGoal.finance&&!achievementGoal.owned?.includes('CORPORATION_REAL_ESTATE');
    const eligible=candidates.filter(item=>options['expand-all-industries']||estateNeeded&&item.industry==='Real Estate'||safe('Read selective expansion',()=>c.getIndustryData(item.industry))?.producedMaterials?.some(m=>demand.has(m)&&!existingSupply.has(m)));
    const next = eligible.find(item => item.cost + 25e9 < Math.max(0, funds() - reserve) * 0.1);
    if (!next) return;
    lastExpansion = Date.now(); // Includes rejected attempts at the BitNode division cap.
    createDivision(next.industry, `Auto ${next.industry}`);
  };
  const bribeFactions = async () => {
    const info = corp();
    if (!options['bribe-factions'] || growthPriority || recovering || !(Number(sf(4)) > 0 || resetInfo.currentNode === 4) ||
        !(info?.valuation >= (Number(constants.bribeThreshold) || 100e12)) || Date.now() - lastBribe < 60000) return;
    lastBribe = Date.now();
    try {
      const targets = await getNsDataThroughFile(ns, `(() => {
        const owned = new Set(ns.singularity.getOwnedAugmentations(true));
        return ns.getPlayer().factions.filter(f => ns.singularity.getFactionWorkTypes(f).length).map(faction => {
          const required = Math.max(0, ...ns.singularity.getAugmentationsFromFaction(faction)
            .filter(aug => aug !== 'NeuroFlux Governor' && !owned.has(aug)).map(aug => ns.singularity.getAugmentationRepReq(aug)));
          return { faction, deficit: Math.max(0, required - ns.singularity.getFactionRep(faction)) };
        }).filter(item => item.deficit > 0).sort((a,b) => a.deficit - b.deficit);
      })()`, 'Temp/corporation-bribe-targets.txt', [], false, 1, 0, true);
      if(!canManage())return;
      const target = targets?.[0];
      if (!target) return;
      const profit = Math.max(0, (Number(info.revenue) - Number(info.expenses)) * cycleSeconds);
      const amount = Math.min(target.deficit * (Number(constants.bribeAmountPerReputation) || 1e9), Math.max(0, funds() - reserve) * 0.001, profit * 0.05);
      if (amount >= 1e9) attempt('Bribe for useful augmentation reputation', () => c.bribe(target.faction, amount));
    } catch (error) { ns.print(`Faction support waiting: ${String(error)}`); }
  };

  // ---- Main loop --------------------------------------------------------
  let lastInvestmentCycle = 0;
  let lastUpgrade = 0;
  let lastProductAt = 0;
  let managedOnce = false;
  const productStateFile = 'tasks/corporation-product-cycle.json';
  const otherProductStateFile = 'tasks/corporation-other-product-cycles.json';
  let otherProductTimes = {};
  const lifecycleFile = 'tasks/corporation-lifecycle.json';
  try {
    const saved = JSON.parse(ns.read(lifecycleFile) || '{}');
    if (saved.nodeReset === resetInfo.lastNodeReset && saved.corporation === corp()?.name) {
      if (Number.isFinite(saved.growthBank)) growthBank = Math.max(0, saved.growthBank);
      lastExpansion = Number(saved.lastExpansion) || 0;
      advertisingRecovery=refreshCorporationAdvertisingRecovery(saved.advertisingRecovery,divisions().map(name=>safe('Restore advertising recovery',()=>c.getDivision(name))||{name}));
    }
  } catch { /* No previous lifecycle state. */ }
  try {
    const saved = JSON.parse(ns.read(otherProductStateFile) || '{}');
    if (saved.nodeReset === resetInfo.lastNodeReset && saved.corporation === corp()?.name)
      otherProductTimes = saved.divisions || {};
  } catch { }
  try {
    const previous = JSON.parse(ns.read(productStateFile) || '{}');
    if (previous.nodeReset === resetInfo.lastNodeReset && previous.corporation === corp()?.name)
      lastProductAt = Number(previous.at) || 0;
  } catch { /* First run: start with a fresh product cycle. */ }
  if (typeof ns.atExit === 'function') ns.atExit(() => clearCorporationBuyRates(c));
  while (!isScriptPaused(ns,ns.getScriptName())) {
    automationHeartbeat(ns);
    try {
      if(!canManage()){
        clearCorporationBuyRates(c);
        await ns.write('tasks/corporation-status.json',JSON.stringify({at:Date.now(),pid:ns.pid,mode:'suspended'}),'w');
        await ns.sleep(1000);continue;
      }
      const info = corp();
      if (!info) { await ns.sleep(30_000); continue; }
      // START applies the previous cycle's results before the next purchases.
      // Manage once per full cycle; the first pass also handles startup mid-cycle.
      if (managedOnce && info.prevState && info.prevState !== 'START') { await c.nextUpdate(); continue; }
      advertisingRecovery=refreshCorporationAdvertisingRecovery([...advertisingRecovery],divisions().map(name=>safe('Refresh advertising recovery',()=>c.getDivision(name))||{name}));
      const completedCycle=managedOnce;
      if(completedCycle)researchCycle++;
      const calibrationEvents=calibrationState?.events||[];
      const calibrationReading=completedCycle&&Array.isArray(calibrationEvents)&&(!calibrationEvents.length||calibrationEvents.length===1&&calibrationEvents[0]?.calibrationQuote)?captureCorporationCalibration(c,info,constants):null;
      calibrationState=observeCorporationCalibration(calibrationState,{scope:calibrationScope,at:Date.now(),snapshot:calibrationReading,events:calibrationEvents});
      managedOnce = true;
      const treasury = treasuryPolicy(info, cycleSeconds,{developmentSpeed:options['development-speed']});
      reserve = treasury.reserve;
      const pricingReady=divisions().some(name=>{const d=safe('Read growth maturity',()=>c.getDivision(name));return d?.makesProducts&&safe('Read pricing maturity',()=>c.hasResearched(name,'Market-TA.II'))===true&&d.products?.some(p=>safe('Read mature growth product',()=>c.getProduct(name,d.cities[0],p))?.developmentProgress>=100);});
      growthPhase=corporationGrowthPhase(info,{enabled:!!options['development-speed'],reserve,pricingReady});growthPriority=growthPhase.active;
      recovering = treasury.recovering;
      const upkeepRows=[];
      if(hasUnlock('Office API'))for(const division of divisions()){
        const d=safe('Read upkeep division',()=>c.getDivision(division));
        for(const city of d?.cities||[]){const office=safe('Read upkeep office',()=>c.getOffice(division,city));if(office)upkeepRows.push({key:division+'/'+city,product:d.makesProducts,office:{...office,autoTea:safe('Read auto tea',()=>c.hasResearched(division,'AutoBrew'))===true,autoParty:safe('Read auto party',()=>c.hasResearched(division,'AutoPartyManager'))===true}});}
      }
      upkeepAllocations=allocateCorporationUpkeep(upkeepRows,treasury.upkeepBudget,teaCostPerEmployee);
      upkeepBudget=[...upkeepAllocations.values()].reduce((sum,value)=>sum+value,0);
      reserve+=upkeepBudget; // Protect allocated upkeep from capital plans until actually paid.

      const available = Math.max(0, funds() - reserve);
      const profit = Math.max(0, (Number(info.revenue) || 0) - (Number(info.expenses) || 0)) * cycleSeconds;
      growthBank = corporationGrowthBudget(info,reserve,growthBank,cycleSeconds,options['development-speed']);
      inputBudget = available * 0.5;
      if (ACCEPT_INVESTMENT) {
        const offer=safe('Read investment offer',()=>c.getInvestmentOffer());
        const stageReady=offer?.round<=2?hasDivision(agri)&&safe('Read agricultural reach',()=>c.getDivision(agri))?.cities?.length===6&&safe('Read agricultural warehouses',()=>c.getDivision(agri).cities.every(city=>c.hasWarehouse(agri,city)))===true&&
          (offer.round===1||hasDivision(chem)||hasDivision(tobacco)):divisions().some(name=>{const d=safe('Read funding product stage',()=>c.getDivision(name));return d?.makesProducts&&d.products?.some(p=>safe('Read funding product',()=>c.getProduct(name,d.cities[0],p))?.developmentProgress>=100);});
        financeDecision=investmentDecision(info,offer,financeHistory,investmentMinOwnership,{reserve,cycleSeconds,stageReady});
        financeHistory=financeDecision.history;
        if(financeDecision.accept&&attempt(`Accept round ${offer.round} investment`,()=>c.acceptInvestmentOffer())){financeHistory=null;growthBank=corporationGrowthBudget({...info,funds:funds(),revenue:0,expenses:0},reserve,growthBank,cycleSeconds,options['development-speed']);}
      }
      manageDividends(); // Let share-sale policy consider the dividend rate selected for this cycle.
      manageShares();

      growthPlans.clear();growthDecisions=[];marketRows.clear();staffingGoals.clear();researchContexts.clear();upkeepPaid.clear();
      advertQueue.clear();advertisingCandidates.clear();
      exportRoutes.clear(); // Reinspect persistent routes every cycle; deduplicate calls within this pass.
      storagePressure = false;
      // Preserve cash for upcoming inputs and salaries before discretionary spending.
      const boostLocations = [];

      createDivision("Agriculture", agri);
      buyUnlock("Warehouse API");
      buyUnlock("Office API");
      buyUnlock("Smart Supply");
      const allCities = cities;

      if (hasDivision(agri)) {
        for (const city of allCities) {
          expand(agri, city);
          if (!inCity(agri, city)) continue;
          runOffice(agri, city, false);
          runWarehouse(agri, city);
          if (hasUnlock("Warehouse API") && safe("Check agricultural warehouse", () => c.hasWarehouse(agri, city))) {
            manageInputs(agri, city);
            boostLocations.push({ city, division: agri });
          }
        }
        sellMaterials(agri, ["Plants", "Food"]);
        runResearch(agri, MATERIAL_RESEARCH_ORDER);
        hireAdVert(agri);
      }

      // Plants from Agriculture can supply Tobacco without a Chemical division.
      // Launch the primary product industry as soon as its protected setup is funded.
      if(hasDivision(agri)&&!hasDivision(tobacco))createDivision('Tobacco',tobacco);
      if(hasDivision(agri)&&!hasDivision(chem))createDivision('Chemical',chem);
      if (hasDivision(chem)) {
        for (const city of allCities) {
          expand(chem, city);
          if (!inCity(chem, city)) continue;
          runOffice(chem, city, false);
          runWarehouse(chem, city);
          if (hasUnlock("Warehouse API") && safe("Check chemical warehouse", () => c.hasWarehouse(chem, city))) {
            manageInputs(chem, city);
            boostLocations.push({ city, division: chem });
          }
        }
        sellMaterials(chem, ["Chemicals"]);
        runResearch(chem, MATERIAL_RESEARCH_ORDER);
        hireAdVert(chem);
      }

      if(options['expand-all-industries']&&hasDivision(tobacco)&&hasTA2(tobacco)&&funds()>Math.max(reserve*2,(Number(safe('Read Restaurant cost',()=>c.getIndustryData('Restaurant'))?.startingCost)||250e9)*4))createDivision('Restaurant',restaurant);
      if(divisions().some(name=>safe('Read product data need',()=>c.getDivision(name))?.makesProducts)){
        for(const unlock of ['Market Research - Demand','Market Data - Competition']){
          const cost=hasUnlock(unlock)?Infinity:safe('Market data price',()=>c.getUnlockCost(unlock));
          if(Number.isFinite(cost)&&cost<=Math.max(0,funds()-reserve)*.2)capitalPurchase('Buy '+unlock,cost,()=>c.purchaseUnlock(unlock));
        }
      }
      if (hasDivision(restaurant)) {
        runResearch(restaurant, PRODUCT_RESEARCH_ORDER);
        for (const city of allCities) {
          expand(restaurant, city);
          if (!inCity(restaurant, city)) continue;
          runOffice(restaurant, city, true, true);
          runWarehouse(restaurant, city);
          if (hasUnlock('Warehouse API') && safe('Check restaurant warehouse', () => c.hasWarehouse(restaurant, city))) {
            manageInputs(restaurant, city);
            boostLocations.push({ city, division: restaurant });
          }
        }
        sellProducts(restaurant);
        manageProductDevelopment(restaurant);
        hireAdVert(restaurant);
      }

      manageIPO();
      manageDividends();
      // Schedule boost purchases after immediate corporation expenses, so buy
      // rates cannot commit money later consumed by offices, upgrades or products.
      // Maintain divisions already created by the player, using their own industry recipes.
      // Custom products are preserved; only products created by this manager are retired.
      for (const division of divisions().filter(value => ![agri, chem, restaurant].includes(value))) {
        const d = safe(`Read existing ${division}`, () => c.getDivision(division));
        const industry = d && safe(`Read ${division} industry`, () => c.getIndustryData(d.industry));
        if (!d || !industry) continue;
        runResearch(division, d.makesProducts ? PRODUCT_RESEARCH_ORDER : MATERIAL_RESEARCH_ORDER);
        for (const city of cities) {
          expand(division, city);
          if (!inCity(division, city)) continue;
          runOffice(division, city, d.makesProducts, d.makesProducts);
          runWarehouse(division, city);
          if (!hasUnlock('Warehouse API') || !safe('Check existing warehouse', () => c.hasWarehouse(division, city))) continue;
          manageInputs(division, city);
          boostLocations.push({ city, division });
        }
        if (d.makesProducts) {
          sellProducts(division);
          manageProductDevelopment(division);
          hireAdVert(division);
        } else sellMaterials(division, industry.producedMaterials || []);
      }
      if (Date.now() - lastUpgrade >= 30_000) {
        const cash = funds();
        const order = [
          ...(storagePressure ? ["Smart Storage"] : []),
          "Smart Factories", "Smart Storage",
          "Nuoptimal Nootropic Injector Implants", "Speech Processor Implants",
          "Neural Accelerators", "FocusWires", "ABC SalesBots", "Project Insight",
        ];
        const ranked = [...new Set(order)].map(upgrade => {
          const cost = safe(`Get ${upgrade} cost`, () => c.getUpgradeLevelCost(upgrade));
          const level = safe(`Read ${upgrade} level`, () => c.getUpgradeLevel(upgrade)) || 0;
          return { upgrade, cost, score: upgradeReturn(upgrade, level, cost, storagePressure) };
        }).filter(item => Number.isFinite(item.cost) && item.cost > 0).sort((a, b) => b.score - a.score);
        for (const { upgrade, cost } of ranked) {
          const cap = storagePressure && upgrade === "Smart Storage" ? 0.35 : 0.20;
          if (cost <= cash * cap && funds() > cost + reserve)
            capitalPurchase(`Level ${upgrade}`, cost, () => {c.levelUpgrade(upgrade);lastUpgrade=Date.now();},upgradeReturn(upgrade,c.getUpgradeLevel(upgrade),cost,storagePressure),0,0,{kind:upgrade==="Smart Storage"?"storage":upgrade==="ABC SalesBots"?"sales":upgrade==="Project Insight"?"research":"production"});
        }
      }

      let achievements;try{achievements=JSON.parse(ns.read('tasks/achievement-goals.json'));}catch{}
      if(!recovering&&achievements?.expiresAt>Date.now()&&achievements.finance&&!achievements.owned?.includes('CORPORATION_PROD_1000')) {
        for(const division of divisions()){const d=safe('Achievement division',()=>c.getDivision(division));if(!d||d.productionMult>=1000)continue;
          for(const city of d.cities){if(!safe('Achievement warehouse',()=>c.hasWarehouse(division,city)))continue;
            const cost=safe('Achievement warehouse price',()=>c.getUpgradeWarehouseCost(division,city,1));if(Number.isFinite(cost)&&cost<(funds()-reserve)*.01)capitalPurchase('Achievement production storage',cost,()=>c.upgradeWarehouse(division,city,1));}break;}
      }
      manageExports();
      for(const division of [...advertQueue].sort((a,b)=>Number(safe('Read advert priority',()=>c.getDivision(b))?.makesProducts)-Number(safe('Read advert priority',()=>c.getDivision(a))?.makesProducts)))buyAdVert(division);
      expandIndustries();
      // Optional late unlocks, capped individually to leave room for division growth.
      if (!recovering) for (const unlock of constants.unlockNames || []) {
        const cost = hasUnlock(unlock) ? Infinity : safe('Read optional unlock cost', () => c.getUnlockCost(unlock));
        if (Number.isFinite(cost) && cost <= Math.max(0, funds() - reserve) * 0.05)
          capitalPurchase(`Buy optional ${unlock}`, cost, () => c.purchaseUnlock(unlock));
      }
      await bribeFactions();
      if(!canManage()){clearCorporationBuyRates(c);continue;}
      let remainingBoostBudget=recovering?0:Math.min(growthBank,boostPurchaseBudget({...info,funds:funds()},reserve,0,cycleSeconds,{developmentSpeed:options['development-speed']}));
      for(let index=0;index<boostLocations.length;index++){
        boostBudget=remainingBoostBudget/(boostLocations.length-index);const allowance=boostBudget;
        manageBoosts(boostLocations[index].city,boostLocations[index].division);remainingBoostBudget-=allowance-boostBudget;
      }
      if(completedCycle)growthMarket=observeCorporationGrowth(growthMarket,{scope:JSON.stringify([resetInfo.lastNodeReset,info.name]),at:Date.now(),rows:[...marketRows.values()]});
      const route=readNodeRoutePlan(ns),remainingMs=route?.routes?.[route.selected]?.etaMs;
      const delayedGrowth=planCorporationDelayedReturns(scoreCorporationGrowth([...growthPlans.values()],growthMarket),{remainingMs});
      const pricedGrowth=calibrateCorporationGrowth(delayedGrowth,calibrationState,{scope:calibrationScope,at:Date.now()});
      const candidates=pricedGrowth.flatMap(plan=>{
        const q=advertisingCandidates.get(plan.market?.division);
        return q&&plan.label==='Hire AdVert ('+q.division+')'&&plan.score>0?[{...q,aloneValue:plan.score*q.advertCost,profitPerSecond:plan.profitPerSecond,delayedReturn:plan.delayedReturn}]:[];
      });
      const anchor=candidates[0],groups=anchor&&!advertisingRecovery.size?planCorporationAdvertisingGroups(candidates,{level:anchor.level,wilsonCost:anchor.wilsonCost,maxCost:funds()*ADVERT_SPEND_FRACTION}):[];
      const groupPlans=groups.map(quote=>{
        const names=quote.advertisements.map(a=>a.division),receipt={state:'quoted'},label='Wilson + AdVerts ('+names.map(n=>JSON.stringify(n)).join(', ')+')';
        return {label,cost:quote.cost,score:quote.score,priority:0,exclusive:['wilson-upgrade',...names.map(n=>'advert:'+n)],market:{kind:'sales',divisions:names},growthBasis:quote.basis,
          profitPerSecond:quote.advertisements.reduce((sum,a)=>sum+(Number(a.profitPerSecond)||0),0),delayedReturn:{state:'estimated',basis:'Per-division delays already included',components:quote.advertisements.map(a=>({division:a.division,...a.delayedReturn}))},
          advertisingBundle:quote,advertisingReceipt:receipt,run:()=>{
            Object.assign(receipt,executeCorporationAdvertisingGroup(c,quote,{cash:funds,reserve:()=>reserve,allowed:canManage}));
            if(receipt.wilsonPurchased)lastUpgrade=Date.now();
            for(const a of quote.advertisements){
              if(receipt.advertisementsPurchased.includes(a.division))advertisingRecovery.delete(a.division);
              else if(receipt.wilsonPurchased)advertisingRecovery.set(a.division,{level:quote.level+1,adverts:a.adverts});
            }
            return receipt.state==='purchased';
          }};
      });
      const rankedGrowth=[...pricedGrowth,...groupPlans];
      const foundationWaits=growthDecisions.filter(d=>d.state==='budget-wait').map(d=>({label:d.label,cost:d.cost,priority:2,score:1/Math.max(1,d.cost)}));
      growthGoal=corporationFundingGoal([...foundationWaits,...rankedGrowth],{...info,funds:funds()},reserve,growthBank,{enabled:growthPriority});
      const growth=executeCorporationGrowth(rankedGrowth,growthBank,funds,()=>reserve,canManage,{hold:growthGoal});growthBank=growth.remaining;growthDecisions.push(...growth.decisions);
      manageHacknetServers();

      const spentOn = await spendHashes();
      if (spentOn) {
        const hashCount = (() => {
          try { return Number(ns.hacknet.numHashes()) || 0; }
          catch { return 0; }
        })();
        ns.print(`Spent hashes on "${spentOn}" (${ns.format.number(hashCount)} hashes remaining).`);
      }

      calibrationState.events=growthDecisions.filter(d=>['purchased','ordered'].includes(d.state)||d.state==='rejected'&&d.cost>0).slice(0,128);
      if(spentOn==='Exchange for Corporation Research')calibrationState.events.push({state:'changed',label:'Corporate hash research'});
      await ns.write(calibrationFile,JSON.stringify(calibrationState),'w');
      const liveStatus = corp() || info;
      for(const division of divisions())upkeepHistory.set(division,observeCorporationUpkeep(upkeepHistory.get(division),upkeepPaid.get(division)||{tea:0,party:0}));
      await ns.write(researchStateFile,JSON.stringify({upkeep:Object.fromEntries(upkeepHistory),nodeReset:resetInfo.lastNodeReset,corporation:info.name,divisions:Object.fromEntries(researchSamples)}),'w');
      if(growthMarket)await ns.write('tasks/corporation-growth-market.json',JSON.stringify(growthMarket),'w');
      await ns.write(productMetricsFile,JSON.stringify({nodeReset:resetInfo.lastNodeReset,corporation:info.name,divisions:productMetrics,productsByDivision:productHistory}),'w');
      await ns.write(productStateFile,JSON.stringify({at:lastProductAt,nodeReset:resetInfo.lastNodeReset,corporation:info.name}),'w');
      await ns.write(otherProductStateFile,JSON.stringify({nodeReset:resetInfo.lastNodeReset,corporation:info.name,divisions:otherProductTimes}),'w');
      await ns.write(financeFile,JSON.stringify({at:Date.now(),pid:ns.pid,nodeReset:resetInfo.lastNodeReset,corporation:info.name,history:financeHistory,lastShareSaleAt,decision:financeDecision&&{accept:financeDecision.accept,holdIPO:financeDecision.holdIPO,reason:financeDecision.reason}}),'w');
      await ns.write(lifecycleFile, JSON.stringify({nodeReset: resetInfo.lastNodeReset, corporation: info.name, growthBank, lastExpansion, advertisingRecovery:[...advertisingRecovery]}), 'w');
      await ns.write('tasks/corporation-status.json', JSON.stringify({ at: Date.now(), pid: ns.pid, nodeReset:resetInfo.lastNodeReset, augReset:resetInfo.lastAugReset, corporation: info.name,
        growthBank, growthDecisions, fundingDiagnostics:corporationFundingDiagnostics([...foundationWaits,...rankedGrowth].filter(p=>!growthDecisions.some(d=>d.label===p.label&&['purchased','ordered'].includes(d.state))),liveStatus,reserve,growthBank), researchDecisions, advertisingRecovery:[...advertisingRecovery], calibration:{status:calibrationState.status,pending:calibrationState.pending?.quote?.upgrade||null,learnedUpgrades:Object.values(calibrationState.stats).filter(s=>s.length>=3).length}, productMetrics, staffingGoals:Object.fromEntries(staffingGoals), mode: recovering ? 'cash recovery' : 'growth', funds: funds(), reserve, divisions: divisions(),
        revenue: liveStatus.revenue, expenses: liveStatus.expenses, public: liveStatus.public,
        ownership: liveStatus.totalShares > 0 ? liveStatus.numShares / liveStatus.totalShares : null,
        minOwnership, investmentMinOwnership, growthPriority, growthPhase, growthGoal, hashMilestone, liquidityDecision, retainedProfitFraction:1-Number(liveStatus.dividendRate||0), playerCashBottleneck:playerCashBottleneck(), estimatedDividendIncome:corporationDividendRate(liveStatus,cycleSeconds), developmentSpeed:options['development-speed'], financing:financeDecision?.reason, lastShareSaleAt, dividendRate: Math.max(0, lastDividendRate), expandAllIndustries: options['expand-all-industries'],
      }), 'w');
      const now = Date.now();
      if (now - lastInvestmentCycle > 60_000) {
        lastInvestmentCycle = now;
        const live = corp() ?? info;
        const hashes = (() => {
          try { return Number(ns.hacknet.numHashes()) || 0; }
          catch { return 0; }
        })();
        const serverCount = hasHacknetServers() ? (() => {
          try { return ns.hacknet.numNodes(); }
          catch { return 0; }
        })() : 0;
        const owned = Math.max(0, Number(live?.numShares) || 0);
        const total = Math.max(1, Number(live?.totalShares) || 1);
        ns.print(
          `${info.name}: $${ns.format.number(funds())}; ` +
          `divisions: ${divisions().join(", ") || "none"}; ` +
          `public: ${live?.public ? "yes" : "no"}; ` +
          `mode: ${recovering ? "cash recovery" : "growth"}; ` +
          `shares: ${(owned / total * 100).toFixed(1)}% (${ns.format.number(owned)}/${ns.format.number(total)}); ` +
          `dividends: ${(Math.max(0, lastDividendRate) * 100).toFixed(0)}%; ` +
          `hashes: ${ns.format.number(hashes)}; ` +
          `servers: ${serverCount}; ` +
          `wallet: $${ns.format.number(ns.getPlayer().money)}.`
        );
      }
      await c.nextUpdate();
    } catch (error) {
      clearCorporationBuyRates(c);
      ns.print(`Corporation manager recovered from: ${String(error)}`);
      await ns.sleep(10_000);
    }
  }
}
