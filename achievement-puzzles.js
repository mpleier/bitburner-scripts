/** Intended single-player exploit puzzles. Hooks are scoped and restored on exit. */
export async function main(ns) {
 ns.disableLog('ALL');const kind=String(ns.args[0]||'');
 if(kind==='reload-url'){
  const before=globalThis.location.href,url=new URL(before);url.searchParams.set('noScripts','true');
  try{globalThis.history.replaceState(globalThis.history.state,'',url.href);}catch{return;}
  ns.atExit(()=>{if(globalThis.location.href===url.href)globalThis.history.replaceState(globalThis.history.state,'',before);});
  await ns.sleep(15000);return;
 }
 if(kind==='devmenu'){ns.openDevMenu();return;}
 if(kind==='undocumented'){ns.exploit();return;}
 if(kind==='bypass'){ns.bypass(globalThis['doc'+'ument']);return;}
 if(kind==='prototype'){
  const original=Object.getOwnPropertyDescriptor(Number.prototype,'toExponential');
  const hook=function(...args){return Number(this)===55?'5.50e+1':original.value.apply(this,args);};
  Object.defineProperty(Number.prototype,'toExponential',{...original,value:hook});
  ns.atExit(()=>{if(Number.prototype.toExponential===hook)Object.defineProperty(Number.prototype,'toExponential',original);});
  await ns.sleep(16*60000);return;
 }
 if(kind==='time'){
  const original=Object.getOwnPropertyDescriptor(globalThis,'setTimeout'),native=globalThis.setTimeout;
  const hook=function(fn,delay,...args){const probe=typeof fn==='function'&&delay===15000&&Function.prototype.toString.call(fn).includes('TimeCompression');return native.call(globalThis,fn,probe?100:delay,...args);};
  Object.defineProperty(globalThis,'setTimeout',{configurable:true,writable:true,value:hook});
  ns.atExit(()=>{if(globalThis.setTimeout===hook){if(original)Object.defineProperty(globalThis,'setTimeout',original);else delete globalThis.setTimeout;}});
  await ns.sleep(45000);return;
 }
 if(kind==='rainbow'){for(const guess of ['rainbow','password','n00dles','bitburner','rainbow table','I need a rainbow','letmein','123456']){if(ns.rainbow(guess))return;await ns.sleep(100);}return;}
}
