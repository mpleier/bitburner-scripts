import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const ignoredDirectories = new Set(['node_modules', '.git']);
const files = [];

async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) await collect(join(directory, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(join(directory, entry.name));
        }
    }
}

await collect(process.cwd());
let failed = false;
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        failed = true;
        process.stderr.write(`\nSyntax check failed: ${relative(process.cwd(), file)}\n`);
        process.stderr.write(result.stderr || result.stdout);
    }
}

if (failed) process.exitCode = 1;
else console.log(`Syntax check passed for ${files.length} JavaScript files.`);
