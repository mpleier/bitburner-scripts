import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isBlankPassword,parsePasswordEntries,modelCandidates,solveFeedbackPassword,solveNilPassword,solveMastermindPassword} from '../darknet-solvers.js';
import {main as manager} from '../darknet-manager.js';
import {main as scout} from '../darknet-node.js';
import {decodeCredentials,credentialBundle} from '../darknet-credentials.js';

function feedback(guess,password) {
  let exact=0,misplaced=0;const counts={};
  for(let i=0;i<password.length;i++)if(guess[i]===password[i])exact++;else counts[password[i]]=(counts[password[i]]||0)+1;
  for(let i=0;i<guess.length;i++)if(guess[i]!==password[i]&&counts[guess[i]]>0){counts[guess[i]]--;misplaced++;}
  return `${exact},${misplaced}`;
}
function puzzle(modelId,password,format='numeric') {
  const guesses=[],logs=[],details={modelId,passwordLength:password.length,passwordFormat:format};
  const auth=async guess=>{
    guesses.push(guess);
    if(guess===password)return {success:true,code:200};
    logs.unshift({code:401,passwordAttempted:guess,data:modelId==='DeepGreen'?feedback(guess,password):
      [...guess].map((char,i)=>char===password[i]?'yes':i%2?"yes’nt":"yesn’t").join(',')});
    return {success:false,code:401};
  };
  return {details,guesses,logs,auth,readLogs:async()=>({success:true,logs:logs.slice(0,20)})};
}
async function finish(p,state={}) {
  let result;
  for(let i=0;i<12;i++){result=await solveFeedbackPassword(p.details,p.auth,p.readLogs,state);if(result.success)return result;assert.match(result.reason,/progress retained/);}
  assert.fail(JSON.stringify(result));
}

test('credential parsing distinguishes empty, missing, zero and whitespace passwords',()=>{
  const values=parsePasswordEntries('# comment\r\nblank=\r\nzero=0\r\nspace= \r\nexact= a=b \r\ninvalid\r\n =bad');
  assert.equal(values.has('blank'),true);assert.equal(values.get('blank'),'');assert.equal(values.get('missing'),undefined);
  assert.equal(values.get('zero'),'0');assert.equal(values.get('space'),' ');assert.equal(values.get('exact'),' a=b ');assert.equal(values.has(''),false);
});
test('native blank models and hints produce one empty candidate',()=>{
  for(const details of [{modelId:'ZeroLogon'},{passwordLength:0},{passwordHint:'The PIN is empty'},{passwordHint:"I didn't set a password"},{passwordHint:'The password is not set'}]){
    assert.equal(isBlankPassword(details),true);assert.deepEqual(modelCandidates(details),['']);
  }
  assert.equal(isBlankPassword({modelId:'DeepGreen',passwordLength:4,passwordHint:'There is no password hint'}),false);
});
test('blank generic, NIL and Mastermind solve without touching Heartbleed',async()=>{
  for(const [solver,modelId]of [[solveFeedbackPassword,'ZeroLogon'],[solveFeedbackPassword,'NIL'],[solveNilPassword,'NIL'],[solveMastermindPassword,'DeepGreen']]){
    const guesses=[];
    const result=await solver({modelId,passwordLength:0},async guess=>{guesses.push(guess);return {success:true,code:200};},()=>assert.fail('must not read Heartbleed'));
    assert.deepEqual(result,{success:true,password:''});assert.deepEqual(guesses,['']);
  }
});
test('blank authentication failures preserve the native interruption code',async()=>{
  const result=await solveFeedbackPassword({passwordLength:0},async()=>({success:false,code:408}),()=>assert.fail());
  assert.equal(result.success,false);assert.equal(result.code,408);
});
test('yes’nt supports aliases, curly apostrophes and numeric leading zeros',async()=>{
  const p=puzzle('NIL','00975');p.details.modelId='yes’nt';
  const result=await finish(p);assert.equal(result.password,'00975');assert.ok(p.guesses.length<=11);assert.equal(new Set(p.guesses).size,p.guesses.length);
});
test('Mastermind handles duplicates, ASCII punctuation, spaces and long resumed passwords',async()=>{
  for(const [password,format]of [['112233','numeric'],['000000','numeric'],['z9Y8x7W6','alphanumeric'],[' !~! ','ASCII'],['0123456789'.repeat(6),'numeric']]){
    const p=puzzle('DeepGreen',password,format);assert.equal((await finish(p)).password,password);assert.equal(new Set(p.guesses).size,p.guesses.length);
  }
});
test('Mastermind solves a deterministic sample of numeric passwords',async()=>{
  let seed=9173;
  for(let i=0;i<100;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const password=String(seed%1000000).padStart(6,'0'),p=puzzle('DeepGreen',password);
    assert.equal((await finish(p)).password,password);assert.equal(new Set(p.guesses).size,p.guesses.length);
  }
});
test('both solvers retain an in-flight guess when Heartbleed is temporarily unavailable',async()=>{
  for(const modelId of ['NIL','DeepGreen']){
    const p=puzzle(modelId,'98765'),state={};let reads=0;
    const first=await solveFeedbackPassword(p.details,p.auth,async()=>++reads===2?{success:false,code:451}:p.readLogs(),state);
    assert.equal(first.code,451);assert.equal(p.guesses.length,1);
    assert.equal((await finish(p,state)).password,'98765');assert.equal(new Set(p.guesses).size,p.guesses.length);
  }
});
test('both solvers wait for delayed feedback without submitting the same guess again',async()=>{
  for(const modelId of ['NIL','DeepGreen']){
    const p=puzzle(modelId,'98765'),state={};
    const first=await solveFeedbackPassword(p.details,p.auth,async()=>({success:true,logs:[]}),state);
    assert.match(first.reason,/not found/);assert.equal(p.guesses.length,1);
    assert.equal((await finish(p,state)).password,'98765');assert.equal(new Set(p.guesses).size,p.guesses.length);
  }
});
test('Mastermind rejects contradictory uniform feedback',async()=>{
  const p=puzzle('DeepGreen','98765');p.logs.push({code:401,passwordAttempted:'00000',data:'1,1'});
  const result=await solveFeedbackPassword(p.details,p.auth,p.readLogs,{});assert.equal(result.success,false);assert.match(result.reason,/contradictory/);assert.equal(p.guesses.length,0);
});

async function runBlankWorker(kind,saved,details) {
  const files=new Map(saved===undefined?[]:[['darknet-passwords.txt',`target=${saved}\n`]]),guesses=[],printed=[];
  let sleeps=0;const stop=new Error('end scout fixture');
  const script=kind==='manager'?'darknet-manager.js':'darknet-node.js';
  const ns={pid:991,getScriptName:()=>script,getHostname:()=>kind==='manager'?'home':'origin',disableLog(){},
    read:name=>files.get(name)||'',write:(name,value)=>files.set(name,value),
    ls:(host,pattern='')=>[...files.keys()].filter(name=>name.includes(pattern)),fileExists:()=>false,
    hasTorRouter:()=>true,getResetInfo:()=>({lastNodeReset:1}),getPlayer:()=>({skills:{charisma:0}}),
    print:line=>printed.push(String(line)),scp:async()=>true,ps:()=>[],getServerMaxRam:()=>16,getServerUsedRam:()=>16,getScriptRam:()=>0,
    sleep:async()=>{if(++sleeps>=2){if(kind==='scout')throw stop;files.set('remote-control/paused/'+script+'.txt','true');}},
    dnet:{probe:()=>['target'],getServerDetails:host=>host==='target'?{...details,blockedRam:0,hasSession:false,requiredCharismaSkill:1e9}:{depth:0,difficulty:0},
      authenticate:async(host,password)=>{guesses.push(password);return {success:true,code:200};},getStasisLinkedServers:()=>[],getStasisLinkLimit:()=>0}};
  if(kind==='manager')await manager(ns);else await assert.rejects(scout(ns),error=>error===stop);
  assert.deepEqual(guesses,['','']);
  assert.equal(printed.some(line=>/TypeError|ReferenceError/.test(line)),false,printed.join('\n'));
  return files;
}
test('home manager and remote scout discover, save and reuse blank passwords',async()=>{
  for(const kind of ['manager','scout']){
    const files=await runBlankWorker(kind,undefined,{modelId:'ZeroLogon',passwordLength:0,passwordFormat:'numeric'});
    const store=kind==='manager'?credentialBundle:'tasks/credentials-report-origin.json';
    assert.equal(decodeCredentials(files.get(store)).get('target').password,'');
    assert.equal(files.has('darknet-passwords-target.txt'),false);
    await runBlankWorker(kind,'',{modelId:'unknown',passwordLength:4,passwordFormat:'numeric'});
  }
});
test('both deployment lists include the feedback dependency',()=>{
  for(const file of ['darknet-manager.js','darknet-node.js'])assert.match(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/const codeFiles = \[[^\]]*"darknet-feedback\.js"/);
});

test('short feedback turns retain progress and solve without duplicate guesses',async()=>{
 for(const model of ['NIL','DeepGreen']) {
  const p=puzzle(model,'98765');p.details.probeBudget=3;
  const state={};let solved=false;
  for(let i=0;i<100;i++) {
   const before=p.guesses.length;
   const result=await solveFeedbackPassword(p.details,p.auth,p.readLogs,state);
   assert.ok(p.guesses.length-before<=3);
   if(result.success){assert.equal(result.password,'98765');solved=true;break;}
   assert.match(result.reason,/progress retained/);
  }
  assert.equal(solved,true);assert.equal(new Set(p.guesses).size,p.guesses.length);
 }
});
