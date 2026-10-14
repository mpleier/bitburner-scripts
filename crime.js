import { getActiveSourceFiles, getNsDataThroughFile } from './helpers.js';
import { isScriptPaused } from './automation-control.js';
import { markActivitySupport } from './activity-coordination.js';
import { crimeNames, parseCrimeOptions, crimeTick, guardedCommitCrime, guardedStopCrime } from './crime-policy.js';

export function autocomplete() { return [...crimeNames,'--fast-crimes-only','--focus','--goal']; }

/** Standalone player crime automation. Never opens a tail or interrupts protected work. */
export async function main(ns) {
    if (isScriptPaused(ns, ns.getScriptName())) return;
    if (ns.ps('home').some(p=>p.filename===ns.getScriptName()&&p.pid!==ns.pid))return;
    let options;
    try { options=parseCrimeOptions(ns.args); }
    catch(error) { ns.tprint(String(error));return; }
    let sources;
    try { sources=await getActiveSourceFiles(ns); }
    catch(error) { ns.tprint('Crime automation cannot read Source File access: '+String(error));return; }
    if (!(4 in sources)) { ns.tprint('Crime automation requires BitNode 4 or Source-File 4 (Singularity).');return; }
    ns.disableLog('sleep');
    await markActivitySupport(ns);
    const checkBladeburner=7 in sources||6 in sources;
    let stats=null,lastStatsAt=0;
    const state={};let lastReport='';
    try { while(!isScriptPaused(ns,ns.getScriptName())) {
        try {
            if(!stats||Date.now()-lastStatsAt>=60000){stats=await getNsDataThroughFile(ns,'Object.fromEntries(ns.args.map(name=>[name,ns.singularity.getCrimeStats(name)]))','/Temp/player-crime-stats.txt',crimeNames);lastStatsAt=Date.now();}
            const work=await getNsDataThroughFile(ns,'ns.singularity.getCurrentWork()','/Temp/player-crime-work.txt');
            const chances=options.crime?{}:await getNsDataThroughFile(ns,'Object.fromEntries(ns.args.map(name=>[name,ns.singularity.getCrimeChance(name)]))','/Temp/player-crime-chances.txt',crimeNames);
            const readLive=path=>{try{const record=JSON.parse(ns.read(path));return {...record,alive:ns.isRunning(record.ownerPid)};}catch{return null;}};
            let bladeburnerBlocked=false;
            if(checkBladeburner)bladeburnerBlocked=await getNsDataThroughFile(ns,
                `(() => {if(!ns.bladeburner.inBladeburner())return false;const a=ns.bladeburner.getCurrentAction();return !!a?.type&&!/^(idle|none)$/i.test(a.type)&&(/black/i.test(a.type)||!ns.singularity.getOwnedAugmentations(false).includes("The Blade's Simulacrum"));})()`, '/Temp/player-crime-bladeburner.txt');
            const snapshot={work,stats,chances,processes:ns.ps('home'),activity:readLive('tasks/activity-lock.json'),transition:readLive('tasks/progression-transition.json'),bladeburnerBlocked};
            const result=await crimeTick(state,snapshot,options,(crime,focus,expected,cycles)=>getNsDataThroughFile(ns,
                `(${guardedCommitCrime.toString()})(ns,ns.args[0],ns.args[1],ns.args[2],ns.args[3],ns.args[4]<0?null:ns.args[4])`, '/Temp/player-crime-commit.txt', [crime,focus,expected || '',checkBladeburner,cycles??-1]), Date.now(), (crime,cycles)=>getNsDataThroughFile(ns,
                `(${guardedStopCrime.toString()})(ns,ns.args[0],ns.args[1])`, '/Temp/player-crime-stop.txt', [crime,cycles]));
            const report=JSON.stringify(result);
            if(report!==lastReport) { ns.print(report);lastReport=report; }
            await ns.write('tasks/crime-status.json',JSON.stringify({at:Date.now(),pid:ns.pid,...result,karma:ns.heart.break()}),'w');
        } catch(error) { ns.print('Crime automation waiting: '+String(error)); }
        await ns.sleep(1000);
    }} finally {
        if(state.ownedCrime)try{await getNsDataThroughFile(ns,`(${guardedStopCrime.toString()})(ns,ns.args[0],ns.args[1])`,'/Temp/player-crime-stop.txt',[state.ownedCrime,state.lastCycles||0]);}catch(error){ns.print('Crime cleanup waiting: '+String(error));}
    }
}
