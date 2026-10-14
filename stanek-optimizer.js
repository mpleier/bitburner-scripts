/** Bounded beam search; no live grid mutations. */
export function fragmentCells(f,definition) {
 if(!definition||!Number.isInteger(f.rotation)||f.rotation<0||f.rotation>3)return [];
 let shape=definition.shape;
 for(let r=0;r<f.rotation;r++)shape=shape[0].map((_,x)=>shape.map((_,y)=>shape[shape.length-1-y][x]));
 return shape.flatMap((row,y)=>row.flatMap((filled,x)=>filled?[[f.x+x,f.y+y]]:[]));
}
export function layoutScore(fragments,definitions,width,height,node=1) {
 const defs=new Map(definitions.map(d=>[d.id,d])),occupied=new Set(),counts=new Map(),parts=[];
 const weights={0:[6,7].includes(node)?2:12,1:11,25:13,5:3,20:2,21:2,6:2,7:2,30:[6,7].includes(node)?14:1.5,16:1,14:1,18:1,10:0.5,12:0.5,27:0.5,28:0.5};
 for(const f of fragments){const d=defs.get(f.id),cells=fragmentCells(f,d);if(!cells.length)return -Infinity;
  counts.set(f.id,(counts.get(f.id)||0)+1);if(counts.get(f.id)>(d.limit??(f.id<100?1:Infinity)))return -Infinity;
  for(const [x,y]of cells){const k=x+','+y;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=width||y>=height||occupied.has(k))return -Infinity;occupied.add(k);}
  parts.push({f,cells,weight:weights[f.id]||0});
 }
 let score=0;
 for(const p of parts.filter(p=>p.f.id<100)){
  const touching=parts.filter(b=>b.f.id>=100&&b.cells.some(([x,y])=>p.cells.some(([a,c])=>Math.abs(a-x)+Math.abs(c-y)===1))).length;
  score+=p.weight*(1+0.1*touching);
 }return score;
}
export async function optimizeLayout(definitions,width,height,node=1,yieldWork=async()=>{},beamWidth=40) {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>20||height>20)throw new Error('Invalid Stanek dimensions');
 beamWidth=Math.max(1,Math.min(80,Math.trunc(beamWidth)||40));
 const defs=new Map(definitions.map(d=>[d.id,d])),ids=[25,...([6,7].includes(node)?[30,1,0]:[0,1]),5,20,21,7,6,30,16,14,18,10,12,27,28];
 const placements=new Map();
 for(const d of definitions){const list=[];for(let r=0;r<4;r++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const f={id:d.id,x,y,rotation:r},cells=fragmentCells(f,d);
  if(cells.length&&cells.every(([a,b])=>a>=0&&b>=0&&a<width&&b<height))list.push({f,mask:cells.reduce((m,[a,b])=>m|(1n<<BigInt(b*width+a)),0n)});
 }placements.set(d.id,list);await yieldWork();}
 let beam=[{fragments:[],mask:0n,score:0}],steps=0;
 const prune=candidates=>{const unique=new Map();for(const c of candidates){const key=c.mask.toString()+':'+c.fragments.map(f=>f.id).sort((a,b)=>a-b).join(',');if(!unique.has(key)||unique.get(key).score<c.score)unique.set(key,c);}
  return [...unique.values()].sort((a,b)=>b.score-a.score).slice(0,beamWidth);};
 for(const id of [...new Set(ids)].filter(id=>defs.has(id))){const next=[...beam];for(const state of beam)for(const p of placements.get(id)){
  if(!(state.mask&p.mask)){const fragments=[...state.fragments,p.f];next.push({fragments,mask:state.mask|p.mask,score:layoutScore(fragments,definitions,width,height,node)});}
  if(++steps%2048===0)await yieldWork();
 }beam=prune(next);await yieldWork();}
 // Add up to four useful boosters. The bounded width also caps storage and search time.
 const boosters=definitions.filter(d=>d.id>=100).flatMap(d=>placements.get(d.id));
 for(let round=0;round<4;round++){const next=[...beam];for(const state of beam)for(const p of boosters){
  if(!(state.mask&p.mask)){const fragments=[...state.fragments,p.f],score=layoutScore(fragments,definitions,width,height,node);if(score>state.score)next.push({fragments,mask:state.mask|p.mask,score});}
  if(++steps%2048===0)await yieldWork();
 }beam=prune(next);await yieldWork();}
 return {version:1,width,height,node,score:beam[0].score,fragments:beam[0].fragments,steps};
}
