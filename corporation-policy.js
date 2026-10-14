import { officeJobCounts } from './automation-policy.js';
export function treasuryPolicy(info, cycleSeconds = 10) {
 const cash = Math.max(0, Number(info.funds) || 0);
 const expenses = Math.max(0, Number(info.expenses) || 0);
 const reserve = Math.max(1e6, Math.min(5e9, cash * 0.1), expenses * cycleSeconds * 2);
 const recovering = cash < Math.max(10e6, reserve * 1.5);
 const spendable = Math.max(0, cash - reserve);
 const profitBudget = Math.max(0, (Number(info.revenue) || 0) - expenses) * cycleSeconds * 0.25;
 return { reserve, recovering, upkeepBudget: recovering ? 0 : Math.min(spendable, cash * 0.02, profitBudget) };
}
export function recoveryJobCounts(employees, products, recovering) {
 const interns = recovering && employees >= 6 ? Math.min(employees - 5, Math.ceil(employees * 0.25)) : 0;
 const productive = employees - interns;
 const jobs = interns > 0 ? officeJobCounts(productive - 5, products).map(count => count + 1) : officeJobCounts(productive, products);
 return [...jobs, interns];
}
export function priorSaleMultiplier(price) {
 const match = String(price ?? '').match(/^MP\s*\*\s*(\d+(?:\.\d+)?)$/);
 const value = Number(match?.[1]);
 return value > 0 && Number.isFinite(value) ? Math.max(1, Math.min(1e6, value)) : 1;
}
export function partySpendPerEmployee(morale, target, employees, budget) {
 if (!(employees > 0) || !(budget > 0) || !(morale > 0) || morale >= target - 1) return 0;
 // The game applies (morale + (multiplier-1)*10) * multiplier next START.
 const multiplier = (-(morale - 10) + Math.sqrt((morale - 10) ** 2 + 40 * target)) / 20;
 const needed = Math.max(0, multiplier - 1) * 1e7;
 const spend = Math.min(needed, budget / employees);
 // Tiny parties cannot offset natural decay and waste scarce operating cash.
 return spend >= 100000 ? spend : 0;
}
