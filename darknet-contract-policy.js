/** Reward amounts are hidden before solving. Unknown or validated contracts retain option value. */
export function darknetContractDisposition(reports,status,validation,reset,now=Date.now()) {
 const pending=reports.flatMap(r=>(r.contractFiles||[]).map(file=>({host:r.host,file})));
 if(!pending.length)return {allow:true,unsupported:0,protected:0,reason:'No surveyed contracts remain'};
 const fresh=x=>x&&Number.isFinite(x.at)&&x.at<=now&&now-x.at<=90000;
 const known=fresh(status)&&fresh(validation)&&validation.state!=='unavailable'&&status.nodeReset===reset.lastNodeReset&&status.augReset===reset.lastAugReset&&typeof validation.version==='string'&&validation.version.length>0&&status.validationVersion===validation.version&&Array.isArray(status.contracts);
 const unsupported=known?pending.filter(c=>{const rows=status.contracts.filter(x=>x.host===c.host&&x.file===c.file);return rows.length===1&&typeof rows[0].type==='string'&&validation.types?.[rows[0].type]?.state==='unsupported';}).length:0;
 return {allow:unsupported===pending.length,unsupported,protected:pending.length-unsupported,rewardValue:'unknown-until-solved',reason:unsupported===pending.length?'Only confirmed unsupported contracts remain':'Preserving solvable or unknown-value contracts'};
}
