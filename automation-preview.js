import {collectAutomationPreview,printAutomationPreview} from './automation-preview-policy.js';
/** Interactive inspection only. Does not start autopilot or change configuration. */
export async function main(ns){
 const options=ns.flags([['json',false]]);
 let settings={};const saved=ns.read('autopilot.js.config.txt');if(saved){settings=JSON.parse(saved);if(Array.isArray(settings))settings=Object.fromEntries(settings);if(!settings||typeof settings!=='object')throw Error('Invalid autopilot configuration');}
 const preview=collectAutomationPreview(ns,settings);
 if(options.json)ns.tprint(JSON.stringify(preview));else printAutomationPreview(ns,preview);
}
