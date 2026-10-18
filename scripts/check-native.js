import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseNativeQc} from './native-qc-core.js';
const directory=process.env.BITBURNER_REMOTE_API_DIR||join(homedir(),'Documents','Codex','bitburner-remote-api'),control=join(directory,'control.cjs');
if(!existsSync(control)){console.error('Set BITBURNER_REMOTE_API_DIR to the local Remote API tools folder.');process.exitCode=1;}
else{
 const result=spawnSync(process.execPath,[control,'automation.preflight',JSON.stringify(process.argv.slice(2)),'--wait','20'],{encoding:'utf8',timeout:30000,maxBuffer:512*1024});
 const checked=parseNativeQc(result.stdout);
 if(result.error||result.status!==0||!checked.ok){console.error(result.error?.message||checked.message||result.stderr);for(const row of checked.failures||[])console.error(row.script+': '+row.status+' '+(row.reason||''));process.exitCode=1;}
 else console.log('Native RAM preflight passed for '+checked.scripts.length+' managed entrypoints. Scripts were not executed.');
}
