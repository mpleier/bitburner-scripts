/** Call the game's own handlers on specifically identified controls. */
export function achievementButton(document,pattern) {
 const node=[...document.querySelectorAll('button,[role="button"]')].find(n=>!n.disabled&&pattern.test(n.textContent.trim()));
 if(!node)return false;
 const key=Object.keys(node).find(k=>k.startsWith('__reactProps$'));
 const props=key?node[key]:null;
 if(typeof props?.onClick!=='function')return false;
 props.onClick({isTrusted:true,target:node,currentTarget:node,preventDefault(){},stopPropagation(){}});return true;
}
export function unclickablePuzzle(document) {
 const node=document.getElementById('unclickable');if(!node)return false;
 const key=Object.keys(node).find(k=>k.startsWith('__reactProps$')),props=key?node[key]:null;
 if(typeof props?.onClick!=='function')return false;
 props.onClick({target:node,currentTarget:node,isTrusted:true});return true;
}


export function readAchievementCatalog(document) {
 const seen=new Set(),result=new Map();let visits=0;
 for(const node of document.querySelectorAll('*')){
  const key=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));let fiber=key?node[key]:null;
  for(let depth=0;fiber&&depth<30&&visits<10000;depth++,fiber=fiber.return){if(seen.has(fiber))continue;seen.add(fiber);visits++;
   const values=fiber.memoizedProps?.achievements;
   if(Array.isArray(values))for(const entry of values){const a=entry?.achievement||entry;
    if(a&&typeof a.ID==='string'&&typeof a.Condition==='function')result.set(a.ID,{ID:a.ID,Name:a.Name||a.ID,Description:a.Description||'',NotInSteam:!!a.NotInSteam});}
  }
 }
 return [...result.values()];
}

