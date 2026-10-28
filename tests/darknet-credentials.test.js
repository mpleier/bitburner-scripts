import test from 'node:test';
import assert from 'node:assert/strict';
import {createDarknetCredentials,decodeCredentials,credentialBundle} from '../darknet-credentials.js';
function network(){
 const hosts=new Map(),events=[];let fail='',corrupt=false;
 const files=h=>{if(!hosts.has(h))hosts.set(h,new Map());return hosts.get(h);};
 const api=h=>({pid:1,getHostname:()=>h,read:f=>files(h).get(f)||'',
  ls:(host,prefix)=>[...files(host).keys()].filter(f=>f.includes(prefix)).sort(),
  write:async(f,t)=>{events.push(['write',h,f]);files(h).set(f,corrupt&&f.includes('archive')?'broken':t);},
  scp:async(f,to,from)=>{events.push(['scp',f,to,from]);if(f.includes(fail)&&fail)return false;if(!files(from).has(f))return false;files(to).set(f,files(from).get(f));return true;},
  rm:f=>{events.push(['rm',h,f]);return files(h).delete(f);},sleep:async()=>{},print:()=>{}});
 return {files,api,events,fail:s=>fail=s,corrupt:()=>corrupt=true};
}
test('migration archives exact legacy contents before removing files and preserves effective passwords',async()=>{
 const n=network(),f=n.files('darkweb');f.set('darknet-passwords.txt','a=manual');f.set('darknet-passwords-a.txt','a=old\nb=second\n# original');f.set('darknet-passwords-z.txt','a=latest');
 const store=createDarknetCredentials(n.api('darkweb'));const map=await store.refresh();
 assert.equal(map.get('a'),'latest');assert.equal(map.get('b'),'second');
 assert.ok(f.has('darknet-passwords.txt'));assert.ok(!f.has('darknet-passwords-a.txt'));
 assert.deepEqual(JSON.parse(n.files('home').get('tasks/credential-archive-darkweb.json')),[['darknet-passwords-a.txt','a=old\nb=second\n# original'],['darknet-passwords-z.txt','a=latest']]);
 const firstDelete=n.events.findIndex(e=>e[0]==='rm');assert.ok(n.events.slice(0,firstDelete).some(e=>e[0]==='scp'&&e[1].includes('report')));
});
test('failed archive verification or either upload retains every legacy file',async()=>{
 for(const failure of ['archive','report','corrupt']){
  const n=network();n.files('darkweb').set('darknet-passwords-a.txt','a=secret');if(failure==='corrupt')n.corrupt();else n.fail(failure);
  await assert.rejects(()=>createDarknetCredentials(n.api('darkweb')).refresh());assert.ok(n.files('darkweb').has('darknet-passwords-a.txt'));assert.ok(!n.events.some(e=>e[0]==='rm'));
 }
});
test('home merges scouts and scouts download bundle only when version changes',async()=>{
 const n=network(),home=createDarknetCredentials(n.api('home')),scout=createDarknetCredentials(n.api('darkweb')),other=createDarknetCredentials(n.api('other'));
 await scout.save('target','correct');await home.refresh();assert.equal((await other.refresh()).get('target'),'correct');
 n.events.length=0;await other.refresh();assert.ok(!n.events.some(e=>e[0]==='scp'&&e[1]===credentialBundle));
 assert.equal(decodeCredentials(n.files('home').get(credentialBundle)).get('target').password,'correct');
});
test('interrupted publish retries and verified credentials survive store restart',async()=>{
 const n=network(),scout=createDarknetCredentials(n.api('darkweb'));n.fail('report');await scout.save('a','verified');n.fail('');await scout.refresh();
 assert.equal((await createDarknetCredentials(n.api('home')).refresh()).get('a'),'verified');
 n.files('darkweb').set('darknet-passwords-a.txt','a=obsolete');assert.equal((await createDarknetCredentials(n.api('darkweb')).refresh()).get('a'),'verified');
});
test('manual edits are applied without creating legacy files',async()=>{
 const n=network(),store=createDarknetCredentials(n.api('home'));n.files('home').set('darknet-passwords.txt','a=first');await store.refresh();n.files('home').set('darknet-passwords.txt','a=edited');assert.equal((await store.refresh()).get('a'),'edited');
 assert.ok(![...n.files('home').keys()].some(f=>f.startsWith('darknet-passwords-')));
});
test('malformed durable store fails closed without deleting legacy data',async()=>{
 const n=network();n.files('home').set(credentialBundle,'{}');n.files('home').set('darknet-passwords-a.txt','a=value');await assert.rejects(()=>createDarknetCredentials(n.api('home')).refresh());assert.equal(n.events.length,0);
});
