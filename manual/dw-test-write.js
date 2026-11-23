export async function main(ns) { await ns.write('tasks/test-write.txt', 'hello-' + Date.now(), 'w'); }
