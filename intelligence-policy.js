export function intelligenceUnlocked(reset) {
 const level=Number(reset.ownedSF?.get?.(5)??reset.ownedSF?.[5])||0;
 return reset.currentNode===5||level>0;
}
export function intelligenceSessionDecision({state,reset,intelligence,target,maxResets,maxMinutes,now=Date.now(),invites=0,queued=false,busy=false}) {
 if(!Number.isFinite(target)||target<=0||!Number.isInteger(maxResets)||maxResets<1||!Number.isFinite(maxMinutes)||maxMinutes<=0)return 'invalid-options';
 if(state?.nodeReset===reset.lastNodeReset&&state.status==='complete')return 'complete';
 if(intelligence>=target||(state?.nodeReset===reset.lastNodeReset&&(state.resets>=maxResets||now-state.startedAt>=maxMinutes*60000)))return 'complete';
 if(queued||busy)return 'protected-progress';
 if(now-reset.lastAugReset>20*60000)return 'requires-fresh-reset';
 if(invites<10)return 'requires-faction-invitations';
 return 'farm';
}
