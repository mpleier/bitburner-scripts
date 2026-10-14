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
export function casinoReactHandler(element,eventName) {
  if(!element||element.isConnected===false||element.disabled)throw new Error('Casino control is missing, stale, or disabled.');
  for(const key of Object.keys(element))if(key.startsWith('__reactProps$')) {
    const handler=element[key]?.[eventName];if(typeof handler==='function')return handler;
  }
  for(const key of Object.keys(element))if(key.startsWith('__reactFiber$')) {
    const fiber=element[key];
    if(fiber?.stateNode===element)for(const props of [fiber.memoizedProps,fiber.pendingProps])
      if(typeof props?.[eventName]==='function')return props[eventName];
  }
  throw new Error('Casino control has no current '+eventName+' handler.');
}
export async function casinoUiEvent(element,eventName,value) {
  const handler=casinoReactHandler(element,eventName);
  const target=eventName==='onChange'?{value:String(value)}:element;
  return await handler({isTrusted:true,target,currentTarget:element,nativeEvent:{isTrusted:true},preventDefault(){},stopPropagation(){}});
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
