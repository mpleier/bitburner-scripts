const names=['','Source Genesis','Rise of the Underworld','Corporatocracy','The Singularity','Artificial Intelligence','Bladeburners','Bladeburners 2079','Ghost of Wall Street','Hacktocracy','Digital Carbon','The Big Crash','The Recursion',"They're lunatics",'IPvGO Subnet Takeover','The Secrets of the Dark Net'];
const label=key=>key.replace(/Multiplier$/,'').replace(/([a-z0-9])([A-Z])/g,'$1 $2');
/** Native conditions are shown separately from persistent Source-File rewards. */
export function bitNodeTooltip(node,ownedLevel=0,multipliers=null){
 const level=Number.isFinite(ownedLevel)&&ownedLevel>=0?Math.floor(ownedLevel):0;
 const lines=[`BitNode ${node}.${level+1} — ${names[node]||'Unknown BitNode'}`,`Owned Source-File ${node}: level ${level}`,
  node!==12&&level>=3?'Source-File reward already at maximum level.':`Completion earns Source-File ${node} level ${level+1}.`];
 if(node===11)lines.push('The Big Crash: tougher money-making conditions. Its Source-File improves company work and reduces augmentation price scaling.');
 lines.push('','Current run conditions (native game values):');
 const rows=Object.entries(multipliers||{}).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)).sort(([a],[b])=>a.localeCompare(b));
 if(!rows.length)lines.push('Native multipliers are not available yet.');
 for(const [key,value]of rows){
  if(key==='DaedalusAugsRequirement'){lines.push(`Daedalus entry: ${value} augmentations`);continue;}
  if(key==='StaneksGiftExtraSize'){if(value!==0)lines.push(`Stanek extra grid size: ${value>0?'+':''}${value}`);continue;}
  if(key==='DarknetLabyrinthRewardsTheRedPill'){lines.push(`Labyrinth can reward The Red Pill: ${value>0?'yes':'no'}`);continue;}
  if(value!==1)lines.push(`${label(key)}: ×${Number(value.toPrecision(4))}`);
 }
 if(rows.length)lines.push('Unlisted multipliers are unchanged (×1).');
 return lines.join('\n');
}

/** Build text-only DOM: full-width summary, two columns of run conditions, footer. */
export function renderBitNodeTooltip(element,text,document){
 if(element.dataset.bbTooltipText===text)return;
 const lines=String(text||'').split('\n'),at=lines.findIndex(line=>line.startsWith('Current run conditions'));
 const summary=document.createElement('span');summary.className='bb-tooltip-summary';summary.textContent=(at<0?lines:lines.slice(0,at+1)).join('\n');
 const grid=document.createElement('span');grid.className='bb-tooltip-columns';
 const rows=at<0?[]:lines.slice(at+1),footer=rows.at(-1)?.startsWith('Unlisted multipliers')?rows.pop():null;
 for(const line of rows.filter(Boolean)){const item=document.createElement('span');item.textContent=line;grid.appendChild(item);}
 const tail=document.createElement('span');tail.className='bb-tooltip-footer';tail.textContent=footer||'';
 element.replaceChildren(summary,grid,tail);element.dataset.bbTooltipText=text;
}
