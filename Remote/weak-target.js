/** @param {NS} ns
 * Wait until an appointed time and then execute a weaken. */
export async function main(ns) {
    // Destructure the arguments (default values should never be used and should just provide type hints)
    const [
        /*args[0]*/ target = "",
        /*args[1]*/ start_time = 0,
        /*args[2]*/ duration = 0,
        /*args[3]*/ description = "",
        // Note, unlike Grow / Hack, no stock manipulation arg here.
        /*args[4]*/ silentMisfires = false,
        /*args[5]*/ loopingMode = false
    ] = ns.args;

    const owner=ns.args[6]||0;
    if(!target||!Number.isFinite(start_time)||!Number.isFinite(duration)||duration<0)return ns.print('Invalid hacking schedule.');
    // We may need to sleep before we start the operation to align ourselves properly with other batch cycle (HGW) operations
    let sleepDuration = start_time - Date.now();
    if (sleepDuration < 0) {
        if (!silentMisfires)
            ns.toast(`Misfire: Weaken started ${-sleepDuration} ms too late. ${JSON.stringify(ns.args)}`, 'warning');
        sleepDuration = 0;
    }
    // We use the "additionalMsec" option to bundle the initial sleep time we require with the built-in operation timer
    const hgwOptions = {
        additionalMsec: sleepDuration
    }

    let firstLoop = true;
    do {
        if(owner&&!ns.isRunning(owner))return;
        // Keep the requested finish time / loop period as skill and security change.
        if(duration>0)hgwOptions.additionalMsec=Math.max(0,(firstLoop?start_time-Date.now():0)+(loopingMode?duration*1:duration)-ns.getWeakenTime(target));
        const weakAmt = await ns.weaken(target, hgwOptions);
        // If enabled, warn of any misfires
        if (weakAmt == 0 && !silentMisfires)
            ns.toast(`Misfire: Weaken achieved no security reduction. ${JSON.stringify(ns.args)}`, 'warning');
        // (looping mode only) After the first loop, remove the initial sleep time used to align our start with other HGW operations
        if (firstLoop) {
            firstLoop = false;
        }
    } while (loopingMode); // Keep going only if we were started in "looping mode"
}