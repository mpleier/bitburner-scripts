import {cloudPurchaseSource,cloudCashBudget,cloudCandidates,cloudDemand} from '../cloud-server-policy.js';
import {claimSpending} from '../spending-policy.js';
import {homeRamHeadroom} from '../home-ram-policy.js';
export const ramBudgetGroups=[
 {parent:'host-manager.js',worker:[cloudPurchaseSource,claimSpending,cloudCashBudget,cloudCandidates,cloudDemand,homeRamHeadroom].map(f=>typeof f==='string'?f:f.toString()).join('\n')},
 {parent:'Tasks/contractor.js',worker:'ns.codingcontract.getData("example.cct","home"); ns.write("out","result","w");'}
];
