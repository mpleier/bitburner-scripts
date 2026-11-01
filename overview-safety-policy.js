/** Interpret prerequisite names exactly; Installed is not an instruction to install. */
export function overviewHackingPhase(stage,redPill,hasRedPill){
 if(redPill==='install')return 'install TRP';if(redPill==='buy')return 'buy Red Pill';if(redPill==='favor-reset')return 'unlock donations';
 if(stage?.name==='Installed augmentation requirement')return 'need augmentations';
 if(stage?.name?.startsWith('Join Daedalus'))return 'Daedalus';
 if(stage?.name==='Install The Red Pill'||stage?.name==='Install and measure XP after reset')return 'install TRP';
 if(stage?.name==='Buy The Red Pill')return stage.cashMs===0&&stage.repMs!==0?'Red Pill rep':stage.repMs===0&&stage.cashMs!==0?'Red Pill cash':'Red Pill';
 return hasRedPill?'sample XP':'waiting';
}
export function overviewResetMatches(record,reset){
 if(!reset)return true;
 if(!Number.isFinite(record?.at)||record.at<Math.max(reset.lastNodeReset||0,reset.lastAugReset||0))return false;
 return (record.nodeReset===undefined||record.nodeReset===reset.lastNodeReset)&&(record.augReset===undefined||record.augReset===reset.lastAugReset);
}
export function overviewTooltipPlacement(anchor,size,viewport){
 const pad=8,w=Math.max(1,viewport.width),h=Math.max(1,viewport.height),width=Math.min(size.width,w-pad*2),height=Math.min(size.height,h-pad*2);
 const below=h-pad-anchor.bottom,above=anchor.top-pad;
 const top=below>=height?anchor.bottom:above>=height?anchor.top-height:Math.max(pad,Math.min(h-height-pad,anchor.bottom));
 return {left:Math.max(pad,Math.min(w-width-pad,anchor.right-width)),top:Math.max(pad,Math.min(h-height-pad,top)),maxWidth:Math.max(1,w-pad*2),maxHeight:Math.max(1,h-pad*2)};
}
export function positionOverviewTooltip(anchor,tooltip,document){
 const view=document.defaultView;if(!view||!anchor.getBoundingClientRect||!tooltip.getBoundingClientRect)return;
 tooltip.style.maxWidth=Math.max(1,view.innerWidth-16)+'px';tooltip.style.maxHeight=Math.max(1,view.innerHeight-16)+'px';
 const box=tooltip.getBoundingClientRect(),p=overviewTooltipPlacement(anchor.getBoundingClientRect(),box,{width:view.innerWidth,height:view.innerHeight});
 tooltip.style.left=p.left+'px';tooltip.style.top=p.top+'px';tooltip.style.right='auto';
}

export function overviewRoutePresentation(plan,formatDuration,now=Date.now()){
 const name=route=>route==='hacking'?'WD':'BB';
 const probe=plan?.policy==='milestone-probe';
 const remaining=probe&&Number.isFinite(plan.probe?.until)?Math.max(0,plan.probe.until-now):0;
 const label=probe?name(plan.selected)+' probe '+(remaining>0?formatDuration(remaining):'ended'):
  plan?.selected?name(plan.selected):plan?.candidate?'Comparing '+name(plan.candidate):'Parallel';
 const selected=plan?.routes?.[plan.selected];
 const finite=Number.isFinite(selected?.etaMs)&&selected.etaMs>=0;
 return {probe,label,note:probe?'Temporary evidence collection: '+(plan.probe?.target||'milestone')+'. Probe time remaining: '+(remaining>0?formatDuration(remaining):'ended')+'. This is not a completion forecast.':'',
  confidence:probe?'probe':finite&&selected.actionable===true?'actionable':finite?'provisional':'blocked'};
}
export function overviewCompletionHookNotice(record,reset,processes=[]){
 if(!record||!reset||record.nodeReset!==reset.lastNodeReset||record.status==='completed')return null;
 if(record.status==='started'&&Number.isSafeInteger(record.pid)&&processes.some(p=>p.pid===record.pid))return 'Departure held: completion hook is running'+(record.script?' ('+record.script+')':'')+'.';
 if(!['claimed','started','uncertain'].includes(record.status))return null;
 return 'Departure held: completion hook needs review. '+(record.reason||'Its completion is unconfirmed; it will not be replayed automatically.');
}
