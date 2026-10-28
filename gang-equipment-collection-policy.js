/** Every native catalogue item is a goal for every member, regardless of stat type or ROI. */
export function planGangEquipmentCollection(members,equipment,{cash=0,equipmentFraction=.99,augmentationFraction=.99,skipTransient=[],maxOrders=64}={}) {
 const missing=[],blocked=new Set(skipTransient);
 for(const member of Object.values(members||{})){
  if(typeof member?.name!=='string'||!Array.isArray(member.upgrades)||!Array.isArray(member.augmentations))continue;
  const owned=new Set([...member.upgrades,...member.augmentations]);
  for(const item of equipment||[]){
   if(typeof item?.name!=='string'||typeof item.type!=='string'||!Number.isFinite(item.cost)||item.cost<=0||owned.has(item.name))continue;
   if(missing.some(o=>o.member===member.name&&o.equipmentName===item.name))continue;
   missing.push({member:member.name,equipmentName:item.name,type:item.type,cost:item.cost,reason:'priority'});
  }
 }
 missing.sort((a,b)=>a.cost-b.cost||a.equipmentName.localeCompare(b.equipmentName)||a.member.localeCompare(b.member));
 const valid=Number.isFinite(cash)&&cash>=0&&[equipmentFraction,augmentationFraction].every(v=>Number.isFinite(v)&&v>=0&&v<=1);
 let available=valid?cash*.99:0,equip=valid?cash*Math.min(.99,equipmentFraction):0,augs=valid?cash*Math.min(.99,augmentationFraction):0;
 const orders=[];
 for(const order of missing){
  if(orders.length>=Math.max(0,Math.min(64,maxOrders)))break;
  const aug=order.type==='Augmentation';
  if(!aug&&blocked.has(order.member)||order.cost>available||order.cost>(aug?augs:equip))continue;
  orders.push(order);available-=order.cost;if(aug)augs-=order.cost;else equip-=order.cost;
 }
 return {orders,remainingCount:missing.length,remainingCost:missing.reduce((sum,o)=>sum+o.cost,0)};
}
