export const frontierFile = 'tasks/dnet-frontier.json';
/** Move a populated scout toward the next air gap, keeping stasis/story servers intact. */
export function chooseMigrationTarget(candidates, frontier, now = Date.now()) {
  if (!(frontier?.expiresAt > now) || !Number.isFinite(frontier.depth)) return null;
  return candidates.filter(server => server.scoutRunning && server.hasSession && !server.isStationary && !server.stasis &&
    server.depth >= frontier.depth - 2 && server.difficulty >= frontier.depth - 1 && server.difficulty <= frontier.depth + 1 &&
    server.difficulty % 8 >= 6 && server.difficulty < 38)
    .sort((a, b) => b.difficulty - a.difficulty || b.depth - a.depth)[0]?.host || null;
}
