const moves=[['north',0,-2],['east',2,0],['south',0,2],['west',-2,0]];
const key=(x,y)=>`${x},${y}`;
const validKey=s=>typeof s==='string'&&/^-?\d{1,3},-?\d{1,3}$/.test(s);
/** Store only bounded map data, not executable code or another solver's state. */
export function restoreLabyrinthProgress(saved,scope,now=Date.now()){
 if(!Array.isArray(scope)||scope.length<3||!scope.slice(0,2).every(Number.isFinite))return null;
 if(saved?.version!==1||JSON.stringify(saved.scope)!==JSON.stringify(scope)||!Number.isFinite(saved.at)||saved.at>now||now-saved.at>21600000||!Array.isArray(saved.map)||saved.map.length>4096||!Array.isArray(saved.visited)||saved.visited.length>4096||saved.map.some(r=>!Array.isArray(r)||r.length!==2||!validKey(r[0])||!Number.isInteger(r[1])||r[1]<0||r[1]>15)||saved.visited.some(s=>!validKey(s))||saved.end!==null&&!validKey(saved.end))return null;
 return {labMap:Object.fromEntries(saved.map),labVisited:new Set(saved.visited),labEnd:saved.end,signature:saved.signature};
}
export function packLabyrinthProgress(state,scope,now=Date.now()){
 if(!Array.isArray(scope)||scope.length<3||!scope.slice(0,2).every(Number.isFinite))return null;
 const map=Object.entries(state.labMap||{}),visited=[...(state.labVisited||[])];
 if(map.length>4096||visited.length>4096)return null;
 return {version:1,scope,at:now,signature:state.signature,map,visited,end:state.labEnd||null};
}
/** The report is authoritative; changed local geometry invalidates an old maze map. */
export function observeLabyrinth(state,report,radar=null){
 const [x,y]=report.coords,k=key(x,y),mask=moves.reduce((m,[d],i)=>m|(report[d]===true?1<<i:0),0);
 state.labMap??={};state.labVisited??=new Set();
 if(Object.hasOwn(state.labMap,k)&&state.labMap[k]!==mask){state.labMap={};state.labVisited=new Set();state.labEnd=null;}
 state.labMap[k]=mask;state.labVisited.add(k);
 const rows=radar?.success&&typeof radar.message==='string'?radar.message.replace(/\r/g,'').split('\n'):[];
 if(rows.length!==7||rows.some(r=>r.length!==7)||rows[3][3]!=='@')return;
 const walk=c=>[' ','@','X','S','E'].includes(c);
 for(let ry=1;ry<6;ry+=2)for(let rx=1;rx<6;rx+=2){
  if(!walk(rows[ry][rx]))continue;const px=x+rx-3,py=y+ry-3;
  let bits=0;for(let i=0;i<4;i++){const [,dx,dy]=moves[i];if(walk(rows[ry+dy/2]?.[rx+dx/2]))bits|=1<<i;}
  state.labMap[key(px,py)]=bits;if(rows[ry][rx]==='X')state.labEnd=key(px,py);
 }
 // Always retain the direct report even when radar and report disagree.
 state.labMap[k]=mask;
}
/** Shortest known route to the visible endpoint, otherwise to the nearest frontier. */
export function nextLabyrinthMove(state,coords){
 const start=key(...coords),queue=[{k:start,first:null}],seen=new Set([start]);let frontier=null;
 for(let i=0;i<queue.length&&i<4096;i++){
  const row=queue[i];if(row.first&&row.k===state.labEnd)return row.first;
  if(row.first&&!state.labVisited.has(row.k)&&!frontier)frontier=row.first;
  const [x,y]=row.k.split(',').map(Number),mask=state.labMap[row.k];if(!Number.isInteger(mask))continue;
  for(let d=0;d<4;d++)if(mask&(1<<d)){const [name,dx,dy]=moves[d],k=key(x+dx,y+dy);if(!seen.has(k)){seen.add(k);queue.push({k,first:row.first||name});}}
 }
 return frontier;
}
