let options;
const argsSchema = [
    ['github', 'mpleier'],
    ['repository', 'bitburner-scripts'],
    ['branch', 'main'],
    ['download', []], // By default, all supported files in the repository will be downloaded. Override with just a subset of files here
    ['new-file', []], // If a repository listing fails, only files returned by ns.ls() will be downloaded. You can add additional files to seek out here.
    ['subfolder', ''], // Can be set to download to a sub-folder that is not part of the remote repository structure
    ['extension', ['.js', '.ns', '.txt', '.script']], // Files to download by extension
    ['omit-folder', ['Temp/','tasks/','remote-control/','tests/','scripts/','node_modules/','.git/']], // Folders to omit when getting a list of files to update (TODO: This may be obsolete now that we get a list of files from github itself.)
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--download", "--subfolder", "--omit-folder"].includes(lastFlag))
        return data.scripts;
    return [];
}

/** @param {NS} ns
 * Will try to download a fresh version of every file on the current server.
 * You are responsible for:
 * - Backing up your save / scripts first (try `download *` in the terminal)
 * - Ensuring you have no local changes that you don't mind getting overwritten **/
export async function main(ns) {
    options = ns.flags(argsSchema);
    // Once upon a time, the game API required folders to have a leading slash
    // As of 2.3.1, not only is this no longer needed, but it can break the game.
    options.subfolder = options.subfolder ? trimSlash(options.subfolder) : // Remove leading slash from any user-specified folder
        ns.getScriptName().substring(0, ns.getScriptName().lastIndexOf('/')); // Default to the current folder
    let revision;
    try { revision = await resolveUpdateRevision(options); }
    catch (error) { ns.tprint('ERROR: Cannot pin update to a commit: ' + String(error) + '. No files changed. Retry later or pass a full commit SHA with --branch.'); return; }
    ns.print('Updating from commit ' + revision);
    const baseUrl = `raw.githubusercontent.com/${options.github}/${options.repository}/${revision}/`;
    const filesToDownload = [...new Set(options['new-file'].concat(options.download.length > 0 ? options.download : await repositoryListing(ns, revision)).map(trimSlash))];
    const safePath = path => typeof path === 'string' && path.length > 0 &&
        !path.split('/').some(part => !part || part === '.' || part === '..') && !/[\\:?#[\]\x00-\x1f]/.test(path);
    if ((options.subfolder && !safePath(options.subfolder)) || filesToDownload.some(path => !safePath(path))) {
        ns.tprint('ERROR: Unsafe update path. No files changed.');
        return;
    }
    const stageRoot = pathJoin('Temp', 'git-pull-' + ns.pid + '-' + Date.now());
    const staged = [], temporary = [], originals = new Map(), attempted = [];
    const cleanStaging = () => { for (const file of temporary) { try { ns.rm(file); } catch {} } };
    ns.atExit?.(cleanStaging);
    try {
        for (const localFilePath of filesToDownload) {
            const target = pathJoin(options.subfolder, localFilePath);
            const stage = pathJoin(stageRoot, localFilePath);
            const url = 'https://' + pathJoin(baseUrl, localFilePath);
            temporary.push(stage);
            try {
                ns.print('Staging "' + target + '" from ' + url);
                if (!await ns.wget(url + '?ts=' + Date.now(), stage)) throw new Error('download failed');
                const source = ns.read(stage);
                // Empty text files are legitimate; an empty executable or an HTML error page is not.
                if ((/\.(js|ns|script)$/.test(target) && !source.trim()) || /^\s*(<!doctype html|<html[\s>])/i.test(source))
                    throw new Error('invalid downloaded content');
                staged.push({target, contents: rewriteContentsForSubfolder(source, target)});
            } catch (error) { ns.print('WARNING: Cannot stage "' + target + '": ' + String(error)); }
        }
        if (staged.length !== filesToDownload.length || !staged.length) {
            ns.tprint('WARNING: Pull incomplete: ' + staged.length + '/' + filesToDownload.length + ' files staged. Live files unchanged; cleanup skipped.');
            return;
        }
        // Snapshot before the first write. Promotion and restoration deliberately contain no awaits.
        for (const {target} of staged)
            originals.set(target, {exists: ns.fileExists(target), contents: ns.read(target)});
        try {
            for (const {target, contents} of staged) {
                attempted.push(target);
                ns.write(target, contents, 'w');
                if (!ns.fileExists(target) || ns.read(target) !== contents) throw new Error('write verification failed: ' + target);
            }
        } catch (error) {
            const failures = [];
            for (const target of attempted.reverse()) {
                const old = originals.get(target);
                try {
                    if (old.exists) ns.write(target, old.contents, 'w');
                    else ns.rm(target);
                    if (ns.fileExists(target) !== old.exists || (old.exists && ns.read(target) !== old.contents))
                        throw new Error('restoration verification failed');
                } catch { failures.push(target); }
            }
            ns.tprint('ERROR: Update failed: ' + String(error) + (failures.length ? '. RESTORATION FAILED for: ' + failures.join(', ') : '. Previous files restored.') + ' Cleanup skipped.');
            return;
        }
        ns.tprint('INFO: Pull complete. Updated ' + staged.length + ' files from commit ' + revision + '.');
        ns.run(pathJoin(options.subfolder, 'cleanup.js'));
    } finally { cleanStaging(); }
}

/** Removes leading and trailing slashes from the specified string */
function trimSlash(s) {
    // Once upon a time, the game API required folders to have a leading slash
    // As of 2.3.1, not only is this no longer needed, but it can break the game.
    return s.replace(/^\/+|\/+$/g,'');
}

/** Joins all arguments as components in a path, e.g. pathJoin("foo", "bar", "/baz") = "foo/bar/baz" **/
function pathJoin(...args) {
    return trimSlash(args.filter(s => !!s).join('/').replace(/\/\/+/g, '/'));
}

/** @param {NS} ns
 * Rewrites a file with path substitions to handle downloading to a subfolder. **/
export function rewriteFileForSubfolder(ns, path) {
    ns.write(path, rewriteContentsForSubfolder(ns.read(path), path), 'w');
    return true;
}

function rewriteContentsForSubfolder(contents, path) {
    if (!options.subfolder || path.split('/').pop() === 'git-pull.js') return contents;
    contents = contents.replace(`const subfolder = ''`, `const subfolder = ${JSON.stringify(options.subfolder+'/')}`);
    return contents.replace(/from\s+(['"])(\.\/)?([^'"\n]+)\1/g,
        (match, quote, dot, file) => file.startsWith('../') ? match : 'from ' + JSON.stringify(pathJoin(options.subfolder, file)));
}

/** @param {NS} ns
 * Gets a list of files to download, either from the github repository (if supported), or using a local directory listing **/
async function repositoryListing(ns, revision, folder = '') {
    // Note: Unauthenticated GitHub API requests are rate-limited; keep recursive listings infrequent.
    const listUrl = `https://api.github.com/repos/${options.github}/${options.repository}/contents/${folder}?ref=${encodeURIComponent(revision)}`
    let response = null;
    try {
        response = await fetch(listUrl); // Raw response
        // Expect an array of objects: [{path:"", type:"[file|dir]" },{...},...]
        if(!response.ok)throw new Error('GitHub listing returned HTTP '+response.status);
        response = await response.json();
        if(!Array.isArray(response))throw new Error('GitHub listing did not return a file array'); // Deserialized
        // Sadly, we must recursively retrieve folders, which eats into our 60 free API requests per day.
        const folders = response.filter(f => f.type == "dir"&&!options['omit-folder'].some(dir=>(f.path+'/').startsWith(trimSlash(dir)+'/'))).map(f => f.path);
        let files = response.filter(f => f.type == "file").map(f => f.path)
            .filter(f => options.extension.some(ext => f.endsWith(ext))&&!options['omit-folder'].some(dir=>f.startsWith(trimSlash(dir)+'/')));
        ns.print(`The following files exist at ${listUrl}\n${files.join(", ")}`);
        for (const folder of folders)
            files = files.concat(await repositoryListing(ns, revision, folder));
        return files;
    } catch (error) {
        if (folder !== '') throw error; // Propagate the error if this was a recursive call.
        ns.tprint(`WARNING: Failed to get a repository listing (GitHub API request limit of 60 reached?): ${listUrl}` +
            `\nResponse Contents (if available): ${JSON.stringify(response ?? '(N/A)')}\nError: ${String(error)}`);
        // Fallback, assume the user already has a copy of all files in the repo, and use it as a directory listing
        return ns.ls('home').filter(name => options.extension.some(ext => name.endsWith(ext)) &&
            !name.endsWith('.config.txt')&&!options['omit-folder'].some(dir => trimSlash(name).startsWith(trimSlash(dir)+'/')));
    }
}
/** Resolve once; every listing and download must use this same immutable commit. */
export async function resolveUpdateRevision(settings, request = fetch) {
    if (/^[a-f0-9]{40}$/i.test(settings.branch)) return settings.branch.toLowerCase();
    const url = 'https://api.github.com/repos/' + encodeURIComponent(settings.github) + '/' +
        encodeURIComponent(settings.repository) + '/commits/' + encodeURIComponent(settings.branch);
    const response = await request(url);
    if (!response.ok) throw new Error('GitHub commit lookup returned HTTP ' + response.status);
    const result = await response.json();
    if (typeof result?.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(result.sha)) throw new Error('GitHub returned an invalid commit SHA');
    return result.sha.toLowerCase();
}
