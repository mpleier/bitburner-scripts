import { runCommand } from './helpers.js'

const escapeChars = ['"', "'", "`"];

/** @param {NS} ns
 * The argument can consist of multiple commands to run. The output of the first command will automatically be printed
 * unless a subsequent command includes '; output = ...' - in which case that result will be printed instead. **/
export async function main(ns) {
    const { args, silent, escaped } = parseCommandArgs(ns.args);
    if (!args.length) return ns.tprint('You must provide a command.');
    let command = escaped ? String(args[0]) : args.join(' ');
    // To avoid confusion, strip out any trailing spaces / semicolons
    command = command.trim();
    if (command.endsWith(';')) command = command.slice(0, -1);
    // If the command appears to contian multiple statements, cleverly (and perhaps perilously)
    // see if we can inject a return statement so that we can get the return value of the last statement
    if (command.includes(';')) {
        const lastStatement = command.lastIndexOf(';');
        if (!command.slice(lastStatement + 1).trim().startsWith('return'))
            command = command.slice(0, lastStatement + 1) + `return ` + command.slice(lastStatement + 1);
        // Create a scope around multi-statement commands so they can be used in a lambda
        command = `{ ${command} }`;
    }
    // Wrapping the command in a lambda that can capture and print its output.
    command = `ns.tprint(JSON.stringify(await (async () => ${command})() ?? "(no output)", jsonReplacer, 2)` +
        // While we're using pretty formatting, "condence" formatting for any objects nested more than 2 layers deep
        `.replaceAll(/\\n      +/gi,""))`;
    await ns.write(`/Temp/terminal-command.js`, "", "w"); // Clear the previous command file to avoid a warning about re-using temp script names. This is the one exception.
    return await runCommand(ns, command, `/Temp/terminal-command.js`, (escaped ? args.slice(1) : undefined), !silent);
}
export function parseCommandArgs(input) {
 const args = [...input];
 const flagIndex = args.indexOf('-s');
 const silent = flagIndex >= 0;
 if (silent) args.splice(flagIndex, 1);
 const first = String(args[0] ?? '');
 const escaped = escapeChars.some(char => first.startsWith(char) && first.endsWith(char));
 return { args, silent, escaped };
}
