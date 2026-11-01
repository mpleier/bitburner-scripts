const moves=[['north',0,-2],['east',2,0],['south',0,2],['west',-2,0]];
const key=(x,y)=>`${x},${y}`;
const validEdge=s=>typeof s==='string'&&/^-?\d{1,3},-?\d{1,3}:(north|east|south|west)$/.test(s);
const validKey=s=>typeof s==='string'&&/^-?\d{1,3},-?\d{1,3}$/.test(s);
/** Store only bounded map data, not executable code or another solver's state. */
export function restoreLabyrinthProgress(saved,scope,now=Date.now()){
 if(!Array.isArray(scope)||scope.length<3||!scope.slice(0,2).every(Number.isFinite))return null;
 if(saved?.version!==1||JSON.stringify(saved.scope)!==JSON.stringify(scope)||!Number.isFinite(saved.at)||saved.at>now||now-saved.at>21600000||!Array.isArray(saved.map)||saved.map.length>4096||!Array.isArray(saved.visited)||saved.visited.length>4096||saved.map.some(r=>!Array.isArray(r)||r.length!==2||!validKey(r[0])||!Number.isInteger(r[1])||r[1]<0||r[1]>15)||saved.visited.some(s=>!validKey(s))||saved.end!==null&&!validKey(saved.end)||saved.edges!==undefined&&(!Array.isArray(saved.edges)||saved.edges.length>1024||saved.edges.some(r=>!Array.isArray(r)||r.length!==2||!validEdge(r[0])||!Number.isSafeInteger(r[1])||r[1]<1||r[1]>1000000))||saved.recent!==undefined&&(!Array.isArray(saved.recent)||saved.recent.length>16||saved.recent.some(r=>!validEdge(r?.k)||typeof r.moved!=='boolean'))||saved.entrance!==undefined&&saved.entrance!==null&&!validKey(saved.entrance))return null;
 return {labMap:Object.fromEntries(saved.map),labVisited:new Set(saved.visited),labEnd:saved.end,signature:saved.signature,labEdgeCounts:Object.fromEntries(saved.edges||[]),labRecentEdges:saved.recent||[],labEntrance:saved.entrance||null};
}
export function packLabyrinthProgress(state,scope,now=Date.now()){
 if(!Array.isArray(scope)||scope.length<3||!scope.slice(0,2).every(Number.isFinite))return null;
 const map=Object.entries(state.labMap||{}),visited=[...(state.labVisited||[])];
 if(map.length>4096||visited.length>4096)return null;
 return {version:1,scope,at:now,signature:state.signature,map,visited,end:state.labEnd||null,entrance:state.labEntrance||null,edges:Object.entries(state.labEdgeCounts||{}).filter(([k,v])=>validEdge(k)&&Number.isSafeInteger(v)&&v>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,1024).map(([k,v])=>[k,Math.min(1000000,v)]),recent:(state.labRecentEdges||[]).filter(r=>validEdge(r?.k)&&typeof r.moved==='boolean').slice(-16)};
}
/** The report is authoritative; changed local geometry invalidates an old maze map. */
export function observeLabyrinth(state,report,radar=null){
 const [x,y]=report.coords,k=key(x,y),mask=moves.reduce((m,[d],i)=>m|(report[d]===true?1<<i:0),0);
 state.labMap??={};state.labVisited??=new Set();
 if(Object.hasOwn(state.labMap,k)&&state.labMap[k]!==mask){state.labMap={};state.labVisited=new Set();state.labEnd=null;state.labEdgeCounts={};state.labRecentEdges=[];state.labEntrance=null;}
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
 const start=key(...coords),queue=[{k:start,first:null}],seen=new Set([start]);let frontier=null,unknown=null;
 for(let i=0;i<queue.length&&i<4096;i++){
  const row=queue[i];if(row.first&&row.k===state.labEnd)return row.first;
  if(row.first&&!Object.hasOwn(state.labMap,row.k)&&!unknown)unknown=row.first;
  if(row.first&&!state.labVisited.has(row.k)&&!frontier)frontier=row.first;
  const [x,y]=row.k.split(',').map(Number),mask=state.labMap[row.k];if(!Number.isInteger(mask))continue;
  for(const d of [0,1,2,3].sort((a,b)=>(state.labEdgeCounts?.[row.k+':'+moves[a][0]]||0)-(state.labEdgeCounts?.[row.k+':'+moves[b][0]]||0)))if(mask&(1<<d)){const [name,dx,dy]=moves[d],k=key(x+dx,y+dy);if(!seen.has(k)){seen.add(k);queue.push({k,first:row.first||name});}}
 }
 return unknown||frontier;
}

/** Radar is useful only while nearby rooms remain unmapped, with a bounded cooldown. */
export function labyrinthRadarDue(state,coords,now,lastRadar,movesSinceRadar=Infinity,cost={}){
 if(state.labEnd||now-lastRadar<30000||movesSinceRadar<3)return false;
 let unknown=0;for(let dx=-2;dx<=2;dx+=2)for(let dy=-2;dy<=2;dy+=2)if(!Object.hasOwn(state.labMap||{},key(coords[0]+dx,coords[1]+dy)))unknown++;
 if(Number.isInteger(state.labMap?.[key(...coords)])){
  const queue=[coords],seen=new Set([key(...coords)]);let reachable=0;
  for(let i=0;i<queue.length&&i<9;i++){
   const [x,y]=queue[i],mask=state.labMap[key(x,y)];
   if(!Number.isInteger(mask)){reachable++;continue;}
   for(let d=0;d<4;d++)if(mask&(1<<d)){
    const [,dx,dy]=moves[d],nx=x+dx,ny=y+dy,k=key(nx,ny);
    if(Math.abs(nx-coords[0])<=2&&Math.abs(ny-coords[1])<=2&&!seen.has(k)){seen.add(k);queue.push([nx,ny]);}
   }
  }
  unknown=Math.min(unknown,reachable);
 }
 const moveMs=Number(cost.moveMs),radarMs=Number(cost.radarMs);
 if(moveMs>0&&radarMs>0&&radarMs>moveMs*Math.max(1,unknown-1))return false;
 if(cost.samples>=2&&cost.cellsPerScan<1&&movesSinceRadar<12)return false;
 return unknown>=2;
}
/** Count only confirmed native movement edges. Repeated non-progress requests refresh position. */
export function recordLabyrinthEdge(state,from,to,direction){
 state.labEdgeCounts??={};const k=key(...from)+':'+direction;state.labEdgeCounts[k]=Math.min(1000000,(state.labEdgeCounts[k]||0)+1);
 const history=state.labRecentEdges??=[];history.push({k,moved:from.some((n,i)=>n!==to[i])});if(history.length>16)history.shift();
 const repeated=history.filter(r=>r.k===k).length,stuck=history.slice(-2).length===2&&history.slice(-2).every(r=>r.k===k&&!r.moved);
 return {refresh:stuck||repeated>=4,repeated};
}

/** Known retracing distance; unknown geometry never justifies a speculative resize. */
export function labyrinthRouteDistance(state,from,to){
 if(!validKey(from)||!validKey(to))return null;
 const queue=[{k:from,d:0}],seen=new Set([from]);
 for(let i=0;i<queue.length&&i<4096;i++){
  const r=queue[i];if(r.k===to)return r.d;
  const mask=state.labMap?.[r.k];if(!Number.isInteger(mask))continue;
  const [x,y]=r.k.split(',').map(Number);
  for(let d=0;d<4;d++)if(mask&(1<<d)){const k=key(x+moves[d][1],y+moves[d][2]);if(!seen.has(k)){seen.add(k);queue.push({k,d:r.d+1});}}
 }
 return null;
}

/** Independent failure streaks reset only when the worker makes real progress. */
export function mazeRecoveryTransition(previous,event){
 const state={noRoute:previous?.noRoute||0,loop:previous?.loop||0};
 if(event==='progress')return {noRoute:0,loop:0,stop:false};
 if(event==='no-route')return {...state,noRoute:state.noRoute+1,stop:state.noRoute+1>=3};
 if(event==='loop')return {...state,loop:state.loop+1,stop:state.loop+1>=8};
 return {...state,stop:false};
}
