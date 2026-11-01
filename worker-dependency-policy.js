/**
 * Resolve the relative import graph of a script so remote hosts receive every module
 * a worker needs. Pure and dependency-free; daemon supplies the file reader.
 */
const importPattern = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g;

function directory(file) {
  return file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
}

function resolveRelative(specifier, base) {
  const parts = (specifier.startsWith('/') ? specifier.slice(1) : base + specifier).split('/');
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

/** @returns {string[]} relative imports of `entry`, then their imports, without duplicates. */
export function relativeWorkerDependencies(entry, read) {
  const seen = new Set([entry]);
  const result = [];
  const queue = [];
  const scan = file => {
    const source = read(file) || '';
    for (const match of source.matchAll(importPattern)) queue.push({specifier: match[1], base: directory(file)});
  };
  scan(entry);
  while (queue.length) {
    const {specifier, base} = queue.shift();
    const dependency = resolveRelative(specifier, base);
    if (seen.has(dependency)) continue;
    seen.add(dependency);
    result.push(dependency);
    scan(dependency);
  }
  return result;
}
