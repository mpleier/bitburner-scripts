// One durable store per scout; home merges reports and publishes one shared bundle.
// Legacy files are archived and verified before removal. Credentials never enter code deployment lists.
import {parsePasswordEntries} from './darknet-solvers.js';
export const credentialBundle='tasks/credentials-home.json';
export const credentialVersion='tasks/credentials-version.txt';
const reportPrefix='tasks/credentials-report-';
export function decodeCredentials(text) {
 if(!text)return new Map();
 const data=JSON.parse(text);
 if(data?.schema!==1||typeof data.version!=='string'||!Array.isArray(data.entries))throw Error('Invalid credential store');
 const out=new Map();
 for(const row of data.entries){if(!Array.isArray(row)||row.length!==3||typeof row[0]!=='string'||!row[0]||typeof row[1]!=='string'||!Number.isFinite(row[2])||row[2]<0)throw Error('Invalid credential record');out.set(row[0],{password:row[1],at:row[2]});}
 return out;
}
export function mergeCredentials(target,source) {
 let changed=false;
 for(const [host,r]of source){const prior=target.get(host);if(!prior||r.at>prior.at){target.set(host,r);changed=true;}}
 return changed;
}
export function createDarknetCredentials(ns) {
 const self=ns.getHostname(),home=self==='home',report=reportPrefix+encodeURIComponent(self)+'.json';
 const file=home?credentialBundle:report,archive='tasks/credential-archive-'+encodeURIComponent(self)+'.json';
 let local=null,shared=new Map(),view=new Map(),dirty=true,serial=0,lastLegacy=-Infinity,lastBase=null,lastVersion='',sent='',localVersion='',lastMap=null;
 const reports=new Map();
 const load=()=>{if(local===null){const text=ns.read(file);local=decodeCredentials(text);localVersion=text?JSON.parse(text).version:'';}};
 const payload=()=>JSON.stringify({schema:1,version:Date.now()+':'+ns.pid+':'+(++serial),entries:[...local].map(([h,r])=>[h,r.password,r.at])});
 const commit=async()=>{
  const text=payload();await ns.write(file,text,'w');if(ns.read(file)!==text)throw Error('Credential write verification failed');
  localVersion=JSON.parse(text).version;
  if(home)await ns.write(credentialVersion,localVersion,'w');
  dirty=true;return text;
 };
 const migrate=async()=>{
  if(Date.now()-lastLegacy<60000)return;
  const files=ns.ls(self,'darknet-passwords-').filter(f=>f.startsWith('darknet-passwords-')&&f.endsWith('.txt'));
  if(!files.length){lastLegacy=Date.now();return;}
  const records=[];const imported=new Map();
  for(let i=0;i<files.length;i++){
   const text=ns.read(files[i]);records.push([files[i],text]);
   for(const [h,password]of parsePasswordEntries(text))imported.set(h,{password,at:0});
   if((i+1)%64===0)await ns.sleep(1);
  }
  let prior=[];const old=ns.read(archive);if(old){prior=JSON.parse(old);if(!Array.isArray(prior)||prior.some(r=>!Array.isArray(r)||r.length!==2||r.some(v=>typeof v!=='string')))throw Error('Invalid credential archive');}
  const seen=new Set(prior.map(r=>JSON.stringify(r)));for(const r of records)if(!seen.has(JSON.stringify(r)))prior.push(r);
  const backup=JSON.stringify(prior);await ns.write(archive,backup,'w');if(ns.read(archive)!==backup)throw Error('Credential archive verification failed');
  // Home retains a recoverable archive even when the remote server disappears.
  if(!home&&!await ns.scp(archive,'home',self))throw Error('Credential archive upload failed');
  // Legacy files were read after the manual file; preserve that precedence.
  for(const [h,r] of imported)if(!local.has(h)||local.get(h).at===0)local.set(h,r);
  await commit();
  if(!home&&!await ns.scp(file,'home',self))throw Error('Credential migration upload failed');
  for(let i=0;i<records.length;i++){const [name,text]=records[i];if(ns.read(name)===text)ns.rm(name,self);if((i+1)%64===0)await ns.sleep(1);}
  lastLegacy=Date.now();ns.print('Credentials consolidated: archived '+records.length+' legacy files on '+self+'.');
 };
 const publish=async()=>{if(home)return;const text=ns.read(file);if(text&&text!==sent&&await ns.scp(file,'home',self))sent=text;};
 return {
  async refresh(){
   load();
   // Keep supporting the single user-edited credentials file without broadcasting it.
   const base=ns.read('darknet-passwords.txt');if(base!==lastBase){const at=lastBase===null?0:Date.now();const entries=new Map([...parsePasswordEntries(base)].map(([h,password])=>[h,{password,at}]));if(mergeCredentials(local,entries))await commit();lastBase=base;}
   await migrate();
   if(home){
    let changed=false;
    for(const name of ns.ls('home',reportPrefix).filter(f=>f.endsWith('.json'))){const text=ns.read(name);if(reports.get(name)===text)continue;try{changed=mergeCredentials(local,decodeCredentials(text))||changed;reports.set(name,text);}catch(error){ns.print('Credential report deferred: '+name+': '+String(error));}}
    if(changed||!localVersion)await commit();
    // Recover a version publication interrupted after a successful bundle commit.
    if(ns.read(credentialVersion)!==localVersion)await ns.write(credentialVersion,localVersion,'w');
   }else{
    await publish();
    if(await ns.scp(credentialVersion,self,'home')){const version=ns.read(credentialVersion);if(version&&version!==lastVersion&&await ns.scp(credentialBundle,self,'home')){
     const text=ns.read(credentialBundle);const parsed=JSON.parse(text);if(parsed.version===version){shared=decodeCredentials(text);lastVersion=version;dirty=true;}
    }}
   }
   if(dirty){view=new Map(shared);mergeCredentials(view,local);lastMap=new Map([...view].map(([h,r])=>[h,r.password]));dirty=false;}
   return lastMap;
  },
  async save(host,password){load();local.set(host,{password,at:Date.now()});await commit();await publish();},
 };
}
