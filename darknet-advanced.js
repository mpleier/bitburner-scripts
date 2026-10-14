// Additional solvers for the game's password puzzles. All work is bounded per pass.
export const factorPrimes = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,
  1069,1409,1471,1567,1597,1601,1697,1747,1801,1889,1979,1999,2063,2207,2371,2503,2539,2693,2741,
  2753,2801,2819,2837,2909,2939,3169,3389,3571,3761,3881,4217,4289,4547,4729,4789,4877,4943,4951,
  4957,5393,5417,5419,5441,5519,5527,5647,5779,5881,6007,6089,6133,6389,6451,6469,6547,6661,6719,
  6841,7103,7549,7559,7573,7691,7753,7867,8053,8081,8221,8329,8599,8677,8761,8839,8963,9103,9199,
  9343,9467,9551,9601,9739,9749,9859];

export function packetCandidates(text, length, hostname = '') {
  const candidates = new Set();
  if (hostname) {
    const marker = hostname + ':', start = text.indexOf(marker);
    if (start >= 0) candidates.add(text.slice(start + marker.length, start + marker.length + length));
  }
  for (const match of text.matchAll(/Logging in with passcode:\s*(\S+)\s+\.\.\./g)) candidates.add(match[1]);
  for (let index = 0; index + length <= text.length; index++) {
    const word = text.slice(index, index + length);
    if (/^[a-z0-9]+$/i.test(word)) candidates.add(word);
  }
  return [...candidates].filter(word => word.length === length);
}

export async function solveAdvancedPassword(details, probe, readLogs, state, readLabReport) {
  const length = details.passwordLength;
  if (details.modelId === '(The Labyrinth)') return solveLabyrinth(probe, state, readLabReport);
  for (let tries = 0; tries < 64; tries++) {
    if (details.modelId === 'PHP 5.4') {
      if (length < 5 || length > 32) return { success: false, reason: 'unsupported RMS length' };
      const index = state.rmsDigits?.length || 0;
      const guess = state.rmsBaseline === undefined ? '0'.repeat(length) :
        index < length ? '0'.repeat(index) + '9' + '0'.repeat(length - index - 1) : state.rmsDigits.join('');
      const result = await probe(guess);
      if (!result.feedback) return result;
      const rms = Number(String(result.feedback.data).match(/RMS Deviation:\s*([\d.]+)$/)?.[1]);
      if (!Number.isFinite(rms)) return { success: false, reason: 'invalid RMS feedback' };
      const squared = Math.round(rms * rms * length);
      if (state.rmsBaseline === undefined) { state.rmsBaseline = squared; state.rmsDigits = []; }
      else if (index < length) {
        const digit = (state.rmsBaseline + 81 - squared) / 18;
        if (!Number.isInteger(digit) || digit < 0 || digit > 9) return { success: false, reason: 'inconsistent RMS feedback' };
        state.rmsDigits.push(String(digit));
      } else { state.signature = null; return { success: false, reason: 'RMS confirmation failed; resetting progress' }; }
    } else if (details.modelId === 'Factori-Os') {
      state.factorIndex ??= 0; state.factorPower ??= 1n; state.factorProduct ??= 1n;
      const prime = factorPrimes[state.factorIndex];
      if (!prime) {
        const result = await probe(String(state.factorProduct));
        if (result.feedback) { state.signature = null; return { success: false, reason: 'factor confirmation failed; resetting progress' }; }
        return result;
      }
      const divisor = state.factorPower * BigInt(prime);
      const result = await probe(String(divisor));
      if (!result.feedback) return result;
      if (result.feedback.data === 'true') { state.factorPower = divisor; state.factorProduct *= BigInt(prime); }
      else if (result.feedback.data === 'false') { state.factorIndex++; state.factorPower = 1n; }
      else return { success: false, reason: 'invalid divisibility feedback' };
    } else if (details.modelId === 'OpenWebAccessPoint') {
      state.packetGuesses ??= [];
      const guess = state.packetGuesses[0] || '■'.repeat(length);
      const result = await probe(guess);
      if (!result.feedback) return result;
      if (state.packetGuesses.length) state.packetGuesses.shift();
      const capture = String(result.feedback.data || '');
      const windows = packetCandidates(capture, length, details.hostname);
      if (!windows.length) return { success: false, reason: 'packet capture has no valid candidates' };
      const scraped = await readLogs();
      const direct = [];
      for (const line of scraped?.logs || []) {
        const text = typeof line === 'string' ? line : String(line?.message || '');
        const passcode = text.match(/Logging in with passcode:\s*(\S+)\s+\.\.\./)?.[1];
        if (passcode?.length === length) direct.push(passcode);
      }
      const marker = details.hostname ? capture.indexOf(details.hostname + ':') : -1;
      if (marker >= 0) direct.push(capture.slice(marker + details.hostname.length + 1, marker + details.hostname.length + 1 + length));
      state.packetWindows = state.packetWindows ? state.packetWindows.filter(word => windows.includes(word)) : windows;
      if (!state.packetWindows.length) state.packetWindows = windows;
      state.packetCaptures = (state.packetCaptures || 0) + 1;
      state.packetTried ??= new Set(); state.packetTried.add(guess);
      state.packetGuesses = [...new Set([...direct, ...state.packetGuesses,
        ...(state.packetCaptures >= 3 && state.packetWindows.length <= 20 ? state.packetWindows : [])])]
        .filter(word => !state.packetTried.has(word));
    } else if (details.modelId === 'KingOfTheHill') {
      if (length > 12) return { success: false, reason: 'unsupported hill range' };
      const width = 10 ** Math.max(length - 2, 0) + 1;
      const min = length === 1 ? 0 : 10 ** (length - 1), max = 10 ** length - 1;
      state.hill ??= { cursor: min, bestX: min, bestY: -Infinity, phase: 'scan' };
      const hill = state.hill;
      let guess;
      if (hill.phase === 'scan') guess = String(Math.round(Math.min(max, hill.cursor)));
      else if (hill.phase === 'refine') guess = String(Math.round(hill.left + (hill.right - hill.left) * (hill.sample === 0 ? 0.382 : 0.618)));
      else guess = String(Math.round(hill.bestX));
      const result = await probe(guess);
      if (!result.feedback) return result;
      const altitude = Number(result.feedback.data), x = Number(guess);
      if (!Number.isFinite(altitude)) return { success: false, reason: 'invalid altitude feedback' };
      if (altitude > hill.bestY) { hill.bestY = altitude; hill.bestX = x; }
      if (hill.phase === 'scan') {
        hill.cursor += Math.max(1, width / 2);
        if (x === max) { hill.phase = 'refine'; hill.left = Math.max(min, hill.bestX - width); hill.right = Math.min(max, hill.bestX + width); hill.sample = 0; }
      } else if (hill.phase === 'refine') {
        if (hill.sample === 0) { hill.first = { x, altitude }; hill.sample = 1; }
        else {
          if (hill.first.altitude < altitude) hill.left = hill.first.x;
          else hill.right = x;
          hill.sample = 0;
          if (hill.right - hill.left <= 3) { hill.phase = 'confirm'; hill.confirm = Math.floor(hill.left); }
        }
      } else {
        // Verify each integer in the final bracket; authentication requires an exact match.
        if (hill.confirm > Math.ceil(hill.right)) { state.signature = null; return { success: false, reason: 'hill confirmation failed; resetting progress' }; }
        hill.bestX = hill.confirm++;
      }
    } else return { success: false, reason: 'unsupported advanced model' };
  }
  return { success: false, reason: 'probe budget reached; progress retained' };
}

const directions = [{ name: 'north', dx: 0, dy: -2 }, { name: 'east', dx: 2, dy: 0 },
  { name: 'south', dx: 0, dy: 2 }, { name: 'west', dx: -2, dy: 0 }];
export async function solveLabyrinth(probe, state, readReport) {
  if (!readReport) return { success: false, reason: 'waiting for an adjacent Dark Net scout' };
  state.labVisited ??= new Set(); state.labPath ??= [];
  for (let moves = 0; moves < 64; moves++) {
    const report = await readReport();
    if (!report?.success || !Array.isArray(report.coords) || report.coords.length !== 2 || !report.coords.every(Number.isInteger))
      return { success: false, reason: 'labyrinth location unavailable' };
    const [x, y] = report.coords, key = `${x},${y}`;
    if (state.labPath.at(-1) !== key) {
      const previous = state.labPath.indexOf(key);
      if (previous >= 0) state.labPath.length = previous + 1;
      else state.labPath.push(key);
    }
    state.labVisited.add(key);
    let next = directions.find(direction => report[direction.name] === true && !state.labVisited.has(`${x + direction.dx},${y + direction.dy}`));
    if (!next && state.labPath.length > 1) {
      const [px, py] = state.labPath[state.labPath.length - 2].split(',').map(Number);
      next = directions.find(direction => x + direction.dx === px && y + direction.dy === py && report[direction.name] === true);
    }
    if (!next) { state.signature = null; return { success: false, reason: 'labyrinth exhausted; resetting progress' }; }
    const result = await probe(next.name);
    if (result?.success) return result;
    if (!result.feedback) return result;
  }
  return { success: false, reason: 'maze move budget reached; progress retained' };
}
