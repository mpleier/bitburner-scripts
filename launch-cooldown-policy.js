/** Track persistent launch attempts separately from controllers that remain alive but stall. */
export function launchCooldown(previous,{now=Date.now(),reset,signature,alive=false,stableMs=60000,baseMs=30000,maxMs=300000}={}){
 let state=previous&&previous.reset===reset&&previous.signature===signature&&previous.at<=now?{...previous}:
  {reset,signature,pid:0,startedAt:0,strikes:0,retryAt:0,at:now};
 if(state.pid){
  if(alive){if(now-state.startedAt>=stableMs){state.strikes=0;state.retryAt=0;}}
  else{
   state.strikes=now-state.startedAt<stableMs?state.strikes+1:0;state.pid=0;
   state.retryAt=state.strikes>=2?now+Math.min(maxMs,baseMs*2**Math.min(20,state.strikes-2)):0;
  }
 }
 state.at=now;return state;
}
export function recordLaunch(state,pid,now=Date.now()){
 return {...state,pid:pid||0,startedAt:now,at:now,strikes:pid?state.strikes:state.strikes+1,
  retryAt:!pid&&state.strikes>=1?now+Math.min(300000,30000*2**Math.min(20,state.strikes-1)):state.retryAt};
}
export function launchCooldownKey(script,args=[]){return script.replace(/^\//,'')+' '+JSON.stringify(args);}
