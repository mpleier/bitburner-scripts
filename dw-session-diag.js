/** Try deterministic candidates on each darkweb neighbour; report mode/success only. */
import { modelCandidates, passwordHintCandidates, passwordLengthMatches, passwordFormatMatches } from './darknet-solvers.js';

export async function main(ns) {
  ns.disableLog('ALL');
  const out = [];
  for (const host of ns.dnet.probe()) {
    const entry = { host };
    try {
      const d = ns.dnet.getServerDetails(host) || {};
      entry.model = d.modelId;
      entry.pwdLen = d.passwordLength;
      entry.hasSession = d.hasSession;
      if (d.hasSession === true) { entry.ok = 'existing'; out.push(entry); continue; }
      const seen = new Set();
      const list = [...modelCandidates(d), ...passwordHintCandidates(d), ''].filter((v) => {
        if (typeof v !== 'string' || seen.has(v)) return false;
        seen.add(v);
        return passwordLengthMatches(d, v) && passwordFormatMatches(d, v);
      });
      entry.candidates = list.length;
      for (const pw of list.slice(0, 12)) {
        try {
          const r = ns.dnet.connectToSession(host, pw);
          if (r && r.success === true) { entry.ok = 'connect'; break; }
        } catch (e) { entry.lastError = String(e).slice(0, 120); }
      }
      if (!entry.ok) {
        for (const pw of list.slice(0, 3)) {
          try {
            const r = await ns.dnet.authenticate(host, pw);
            if (r && r.success === true) { entry.ok = 'authenticate'; break; }
          } catch (e) { entry.lastError = String(e).slice(0, 120); }
        }
      }
    } catch (e) { entry.error = String(e).slice(0, 200); }
    out.push(entry);
  }
  await ns.write('tasks/dw-session-diag.json', JSON.stringify(out), 'w');
}
