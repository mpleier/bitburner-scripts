import {writeFile} from 'node:fs/promises';
import * as actions from '../achievement-actions.js';
const sources=Object.fromEntries(Object.entries(actions).map(([name,fn])=>[name,fn.toString()]));
await writeFile(new URL('../achievement-worker-sources.js',import.meta.url),'// Generated from achievement-actions.js. Strings keep heavy APIs out of supervisor RAM.\nexport const achievementWorkerSources = '+JSON.stringify(sources,null,2)+';\n');
