import {achievementScriptBlocked} from './achievement-policy.js';
/** Persistent remote pause flags; one file per script avoids lost concurrent updates. */
export function pauseFile(script) { return 'remote-control/paused/' + String(script).split('/').pop() + '.txt'; }
/** Pauses are per-run intent: this companion records which node/aug install asked for the pause. */
export function pauseScopeFile(script) { return 'remote-control/paused/' + String(script).split('/').pop() + '.scope.json'; }
function pauseScope(ns, script) {
 try { const scope = JSON.parse(ns.read(pauseScopeFile(script))); return scope && Number.isFinite(scope.nodeReset) && Number.isFinite(scope.augReset) ? scope : null; }
 catch { return null; }
}
function clearPause(ns, script, reason) {
 try { if (typeof ns.rm === 'function') { ns.rm(pauseFile(script), 'home'); ns.rm(pauseScopeFile(script), 'home'); } } catch { }
 try { if (typeof ns.print === 'function') ns.print('Cleared the pause flag for ' + script + ' (' + reason + '); re-pause it if that was intended.'); } catch { }
}
export function isScriptPaused(ns, script) {
 if (achievementScriptBlocked(ns, script)) return true;
 if (ns.read(pauseFile(script)).trim() !== 'true') return false;
 const reset = typeof ns.getResetInfo === 'function' ? ns.getResetInfo() : null;
 if (!reset) return true; // Without reset metadata a flag can only be trusted as-is.
 const scope = pauseScope(ns, script);
 // A plain 'true' flag is authoritative (tests and remote control rely on it). A scoped flag only applies to the
 // run that wrote it, so a pause from an earlier node or augment install cannot suppress a script forever.
 if (!scope) return true;
 if (scope.nodeReset !== reset.lastNodeReset || scope.augReset !== reset.lastAugReset) { clearPause(ns, script, 'written before the current run'); return false; }
 return true;
}
export async function setScriptPaused(ns, script, paused) {
 if (paused) {
  await ns.write(pauseFile(script), 'true', 'w');
  const reset = typeof ns.getResetInfo === 'function' ? ns.getResetInfo() : null;
  await ns.write(pauseScopeFile(script), JSON.stringify({at: Date.now(), nodeReset: reset?.lastNodeReset ?? null, augReset: reset?.lastAugReset ?? null}), 'w');
 } else { ns.rm(pauseFile(script), 'home'); ns.rm(pauseScopeFile(script), 'home'); }
}
