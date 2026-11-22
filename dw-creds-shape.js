export async function main(ns) {
  const data = JSON.parse(ns.read('tasks/credentials-home.json'));
  const entries = data.entries || [];
  const shape = entries.slice(0, 6).map((e) => Array.isArray(e)
    ? { type: 'array', len: e.length, keyType: typeof e[0], key: String(e[0]).slice(0, 40), valueType: typeof e[1], valueLen: typeof e[1] === 'string' ? e[1].length : null }
    : { type: typeof e, keys: e && typeof e === 'object' ? Object.keys(e) : [] });
  const targets = ['7777777', 'blade&zenith-blade', 'crypto%matrix', 'suomynon4;mutn4uq', 'echocrack;genesis', 'smar7_d00rbell', 'zenith&com', 'cell_matrix'];
  const found = targets.map((h) => ({ host: h, exact: entries.some((e) => Array.isArray(e) && e[0] === h), partial: entries.filter((e) => Array.isArray(e) && String(e[0]).includes(h)).length }));
  const result = { schema: data.schema, count: entries.length, shape, found };
  await ns.write('tasks/dw-creds-shape.json', JSON.stringify(result), 'w');
  ns.tprint('CREDS_SHAPE ' + JSON.stringify(result));
}
