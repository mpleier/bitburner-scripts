export function casinoOptionsError(options) {
  for(const name of ['save-sleep-time','click-sleep-time','find-sleep-time'])
    if(!Number.isFinite(options[name])||options[name]<0)return name+' must be a finite nonnegative number.';
  return null;
}
export function casinoWager(wallet) {
  if(!Number.isFinite(wallet)||wallet<1)return 0;
  return Math.min(100e6,Math.max(1,Math.floor(wallet*.9)));
}
export function casinoRoundDelta(outcome,bet,before,after,blackjack=false) {
  if(Number.isFinite(before)&&Number.isFinite(after))return after-before;
  if(outcome==='win')return bet*(blackjack?1.5:1);
  if(outcome==='lose')return -bet;
  if(outcome==='tie')return 0;
  throw new Error('Unknown blackjack outcome: '+outcome);
}
export function parseDealerRank(text) {
  const rank=String(text).trim().replace(/[♠♣♥♦]/g,'').trim().toUpperCase();
  if(rank==='A')return 11;
  if(['J','Q','K'].includes(rank))return 10;
  const number=Number(rank);
  if(Number.isInteger(number)&&number>=2&&number<=10)return number;
  throw new Error('Cannot read visible dealer card: '+text);
}
export function blackjackShouldHit(text,dealer,basic=false) {
  const counts=(String(text).replace(/^.*?Count:\s*/i,'').match(/\d+/g)||[]).map(Number);
  const valid=counts.filter(count=>count>=1&&count<=21);
  if(!valid.length)throw new Error('Cannot read a playable blackjack count: '+text);
  const total=Math.max(...valid),soft=valid.length>1;
  if(basic)return total<17;
  if(!(dealer>=2&&dealer<=11))throw new Error('Cannot read dealer rank.');
  if(soft)return total<18||(total===18&&dealer>=9);
  return total<12||(total===12&&!(dealer>=4&&dealer<=6))||(total>=13&&total<17&&dealer>6);
}
export class CasinoUiUnavailable extends Error {
  constructor(message) { super(message);this.name='CasinoUiUnavailable'; }
}
export function casinoReactHandler(element,eventName) {
  if(!element||element.isConnected===false||element.disabled)throw new CasinoUiUnavailable('Casino control is missing, stale, or disabled.');
  for(const key of Object.keys(element))if(key.startsWith('__reactProps$')) {
    const handler=element[key]?.[eventName];if(typeof handler==='function')return handler;
  }
  for(const key of Object.keys(element))if(key.startsWith('__reactFiber$')) {
    const fiber=element[key];
    if(fiber?.stateNode===element)for(const props of [fiber.memoizedProps,fiber.pendingProps])
      if(typeof props?.[eventName]==='function')return props[eventName];
  }
  throw new CasinoUiUnavailable('Casino control has no current '+eventName+' handler.');
}
function dispatchCasinoEvent(element,handler,eventName,value) {
  const target=eventName==='onChange'?{value:String(value)}:element;
  return handler({isTrusted:true,target,currentTarget:element,nativeEvent:{isTrusted:true},preventDefault(){},stopPropagation(){}});
}
export async function casinoUiEvent(element,eventName,value) {
  return await dispatchCasinoEvent(element,casinoReactHandler(element,eventName),eventName,value);
}
/** Retry only before dispatch: repeating a dispatched handler could place a second bet. */
export async function performCasinoUiAction(resolve,eventName,value,{assertControl,wait,optional=false,attempts=5}) {
  let lastError;
  for(let attempt=0;attempt<attempts;attempt++) {
    assertControl();
    const element=resolve();
    if(!element&&optional)return false;
    let handler;
    try { handler=casinoReactHandler(element,eventName); }
    catch(error) {
      if(error?.name!=='CasinoUiUnavailable')throw error;
      lastError=error;
      if(attempt+1<attempts)await wait(Math.min(200,25*2**attempt));
      continue;
    }
    await dispatchCasinoEvent(element,handler,eventName,value);
    return true;
  }
  throw lastError||new CasinoUiUnavailable('Casino interface remained unavailable.');
}
/** Self-contained helper: preserve the casino, this helper and the Remote API worker. */
export function stopCasinoCompetitors(ns,casinoPid) {
  const processes=ns.ps('home').filter(process=>process.pid!==casinoPid&&process.pid!==ns.pid&&
    !/(^|\/)remote-api-agent\.js$/.test(process.filename)&&!process.filename.startsWith('remote-control/'));
  return processes.map(process=>({pid:process.pid,stopped:ns.kill(process.pid)}));
}

export function casinoRetryPending(record,augReset,now=Date.now()) {
  return record?.mode==='failed'&&record.augReset===augReset&&record.retryAt>now;
}

export function casinoHookArgs(input) {
  let args=Array.isArray(input)?input:[input];
  if(args.length===1&&typeof args[0]==='string'&&args[0].trim().startsWith('['))args=JSON.parse(args[0]);
  if(!Array.isArray(args))throw new Error('Completion arguments must be an array.');
  return args.map(arg=>{
    if(typeof arg==='string')return ['"',"'",'`'].some(quote=>arg.startsWith(quote)&&arg.endsWith(quote))?arg.slice(1,-1):arg;
    if(typeof arg==='boolean'||(typeof arg==='number'&&Number.isFinite(arg)))return arg;
    throw new Error('Completion arguments must be strings, numbers, or booleans.');
  });
}


export function casinoControlAllowed(ns,parent) {
 if(!ns.isRunning(parent)||ns.read('remote-control/paused/casino.js.txt').trim()==='true')return false;
 try{const r=JSON.parse(ns.read('tasks/progression-transition.json'));if(r.expiresAt>Date.now()&&r.ownerPid!==parent&&ns.isRunning(r.ownerPid))return false;}catch{}
 return true;
}
export async function reloadCasinoWindow(ns,win,delay,allowed,maxAttempts=5) {
 const previous=win.onbeforeunload;
 try{
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   if(!allowed())throw new Error('Casino control lost before reload');
   win.onbeforeunload=null;await ns.sleep(delay);
   if(!allowed())throw new Error('Casino control lost before reload');
   win.location.reload();
   for(let tick=0;tick<50;tick++){await ns.sleep(200);if(!allowed())throw new Error('Casino control lost while waiting for reload');}
   ns.print('Casino reload attempt '+attempt+' did not finish.');
  }
  throw new Error('Casino reload failed after '+maxAttempts+' attempts.');
 }finally{win.onbeforeunload=previous;}
}
export function launchCasinoHook(ns,script,args) {
 if(ns.ps('home').some(p=>p.filename===script))return 'already-running';
 if(ns.run(script,1,...args))return 'started';
 const host=ns.getHostname(),needed=ns.getScriptRam(script,host);
 const released=ns.getScriptRam(ns.getScriptName(),host),free=ns.getServerMaxRam(host)-ns.getServerUsedRam(host)+released;
 if(needed>0&&needed<=free){ns.spawn(script,{threads:1,spawnDelay:1},...args);return 'spawned';}
 return 'failed';
}
