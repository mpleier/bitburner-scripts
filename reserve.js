import { parseShortNumber } from './helpers.js'
/** Accept only a finite, non-negative reserve; a typo must not silently clear the guard. */
export function parseReserve(text){if(typeof text==='number')return Number.isFinite(text)&&text>=0?text:null;if(typeof text!=='string'||text.trim()==='')return null;const value=parseShortNumber(text);return Number.isFinite(value)&&value>=0?value:null;}
/** @param {NS} ns **/
export async function main(ns) {
    const parsed = parseReserve(ns.args[0]);
    if(parsed===null)return ns.tprint(`ERROR: Could not parse "${ns.args[0]}" as a non-negative amount. Reserve unchanged; try e.g. 200k or 5b.`);
    await ns.write('reserve.txt', parsed, "w");
    ns.tprint(`Set to reserve ${parsed.toLocaleString('en')}`);
}
