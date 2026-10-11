/** @param {NS} ns **/
export async function main(ns) {
    let target = ns.args.length > 0 ? ns.args[0] : '(unspecified server)';
    try {
        await ns.singularity.installBackdoor();
        ns.toast(`Backdoored ${target}`, 'success');
    }
    catch (err) {
        // A target can become ineligible between the manager scan and this
        // script running (for example, after a server purchase/reset). Report
        // the failure without throwing an error modal or killing the manager.
        ns.print(`WARN: Could not backdoor ${target}: ${String(err)}`);
        ns.toast(`Could not backdoor ${target}; will retry later.`, 'warning');
    }
}
