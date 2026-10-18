// Import-free validation shared with the local listener; safe to reload independently.
export const commandFile = 'remote-control/request.json';
export const heartbeatFile = 'remote-control/heartbeat.json';
export const commandPolicyVersion = 21;
export const resultFile = id => 'remote-control/results/' + id + '.json';
export const managedScripts = ['reliability-manager.js','contract-validation.js','automation-dashboard.js','autopilot.js','corporation-manager.js','darknet-manager.js','casino.js','daemon.js','gangs.js','grafting-manager.js','sleeve.js','sleeve-expansion.js','health-manager.js','infiltration-manager.js','work-for-factions.js','bladeburner.js','stockmaster.js','soa-manager.js','go.js','optimize-stanek.js','achievement-manager.js'];
export const diagnosticScripts=[...managedScripts,'stats.js','remote-api-agent.js','hacknet-upgrade-manager.js','spend-hacknet-hashes.js','stanek.js'];
const queries = new Set(['getPlayer','getMoneySources','getResetInfo','ps','scan','getServer','getScriptRam','cloud.getServerNames','getPurchasedServers','ls','singularity.getCurrentWork','singularity.getOwnedAugmentations','corporation.hasCorporation','corporation.getCorporation','corporation.getDivision','corporation.getOffice','corporation.getWarehouse','corporation.getProduct','corporation.getInvestmentOffer','corporation.getMaterial','sleeve.getNumSleeves','sleeve.getSleeve','gang.inGang','gang.getGangInformation','gang.getMemberNames','bladeburner.inBladeburner','bladeburner.getCurrentAction']);
export function validateCommand(command, now = Date.now()) {
 if (!command || !/^[a-zA-Z0-9_-]{1,80}$/.test(command.id || '')) throw new Error('Invalid command ID');
 if (!Number.isFinite(command.expiresAt) || command.expiresAt <= now) throw new Error('Command expired');
 if (!Array.isArray(command.args) || command.args.length > 100) throw new Error('Invalid arguments');
 if (['start','stop'].includes(command.method)) {
  if (command.args.length !== 1 || !managedScripts.includes(command.args[0])) throw new Error('Choose a managed project script; custom arguments are not supported');
 } else if(command.method==='automation.preflight'){
  if(command.args.length>32||command.args.some(s=>!diagnosticScripts.includes(s)))throw new Error('Choose managed entrypoints for native preflight');
 } else if(command.method==='automation.logsFresh'){
  if(command.args.length!==1||!diagnosticScripts.includes(command.args[0]))throw new Error('Choose one managed script for fresh logs');
 } else if(command.method==='automation.logs'){
  if(command.args.length>1||command.args.length===1&&!['stats.js','remote-api-agent.js',...managedScripts].includes(command.args[0]))throw new Error('Choose a managed script log');
 } else if(command.method==='automation.files'){
  if(command.args.length>2||command.args.some((n,i)=>!Number.isSafeInteger(n)||n<(i===0?0:1)||i===1&&n>100))throw new Error('File audit requires a nonnegative offset and a limit of 1 through 100');
 } else if(command.method==='automation.status'){
  if(command.args.length)throw new Error('Automation status takes no arguments');
 } else if (command.method === 'measurement.xp') {
  if(command.args.length!==1||!Number.isInteger(command.args[0])||command.args[0]<60||command.args[0]>600)throw new Error('XP measurement requires 60 through 600 seconds');
 } else if (!['status','automation.status'].includes(command.method) && !queries.has(command.method)) throw new Error('Unsupported command');
 return command;
}
