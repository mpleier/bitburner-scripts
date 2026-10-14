import {achievementScriptBlocked} from './achievement-policy.js';
/** Persistent remote pause flags; one file per script avoids lost concurrent updates. */
export function pauseFile(script) { return 'remote-control/paused/' + String(script).split('/').pop() + '.txt'; }
export function isScriptPaused(ns, script) { return ns.read(pauseFile(script)).trim() === 'true'||achievementScriptBlocked(ns,script); }
export async function setScriptPaused(ns, script, paused) {
 if (paused) await ns.write(pauseFile(script), 'true', 'w');
 else ns.rm(pauseFile(script), 'home');
}
