export const feedbackTurnBudget = details => Number.isInteger(details?.probeBudget) && details.probeBudget > 0 ? Math.min(64, details.probeBudget) : 64;
/** Empty is a real credential, distinct from a missing saved password. */
export function isBlankPassword(details) {
  if (details.passwordLength === 0 || String(details.modelId || '').toLowerCase() === 'zerologon') return true;
  if (Number.isInteger(details.passwordLength) && details.passwordLength > 0) return false;
  return /\bno password\b|\bpassword is not set\b|\b(?:password|pin) is empty\b|\bi didn['\u2019]t set a password\b|\bdid i set a code\b/i.test(String(details.passwordHint || ''));
}

export async function authenticateEmptyPassword(authenticate) {
  const result = await authenticate('');
  return result?.success ? {success:true, password:''} :
    {success:false, reason:Number(result?.code) === 401 ? 'blank password rejected' : 'authentication interrupted', code:result?.code};
}

/** Names shown in hints and the model IDs exposed by the native API. */
export function feedbackModelId(details) {
  const name = String(details.modelId || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  if (['nil', "yesn't", "yes'nt"].includes(name)) return 'NIL';
  if (['deepgreen', 'mastermind'].includes(name)) return 'DeepGreen';
  return details.modelId;
}

function feedbackAlphabet(details) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  switch (String(details.passwordFormat || '').toLowerCase()) {
    case 'numeric': return '0123456789';
    case 'alphabetic': return letters;
    case 'alphanumeric': return '0123456789' + letters;
    default: return Array.from({length:95}, (_, i) => String.fromCharCode(32+i)).join('');
  }
}

function feedbackRecords(logs, length) {
  const result = [];
  for (const line of logs || []) try {
    const record = typeof line === 'string' ? JSON.parse(line) : line;
    if (Number(record?.code) === 401 && typeof record.passwordAttempted === 'string' &&
        record.passwordAttempted.length === length && typeof record.data === 'string') result.push(record);
  } catch { /* Lore and heartbeats are not authentication feedback. */ }
  return result;
}

/** Parse only structured feedback; both spellings of yes'nt mean an incorrect position. */
export function nilFeedbackFromLogs(logs, length) {
  return feedbackRecords(logs, length).flatMap(record => {
    const tokens = record.data.split(',').map(token => token.trim().toLowerCase().replace(/[\u2018\u2019]/g, "'"));
    return tokens.length === length && tokens.every(token => token === 'yes' || ["yesn't", "yes'nt"].includes(token))
      ? [{password:record.passwordAttempted, tokens:tokens.map(token => token === 'yes' ? 'yes' : "yesn't")}] : [];
  });
}

export function mastermindFeedbackFromLogs(logs, length) {
  return feedbackRecords(logs, length).flatMap(record => {
    const match = record.data.trim().match(/^(\d+)\s*,\s*(\d+)$/);
    if (!match) return [];
    const exact = Number(match[1]), misplaced = Number(match[2]);
    return exact + misplaced <= length ? [{password:record.passwordAttempted, exact, misplaced}] : [];
  });
}

function feedbackSignature(details) {
  return JSON.stringify([feedbackModelId(details), details.hostname, details.ip, details.passwordLength,
    String(details.passwordFormat || '').toLowerCase(), details.passwordHint, details.data]);
}

/** Retain an unprocessed guess across Heartbleed/network failures instead of authenticating it repeatedly. */
async function feedbackProbe(password, authenticate, readLogs, parse, length, state) {
  if (state.pendingPassword !== undefined && state.pendingPassword !== password)
    return {success:false, reason:'waiting for pending authentication feedback'};
  if (state.pendingPassword === undefined) {
    const response = await authenticate(password);
    if (response?.success) return {success:true, password};
    if (Number(response?.code) !== 401) return {success:false, reason:'authentication interrupted', code:response?.code};
    state.pendingPassword = password;
    state.pendingMisses = 0;
    const direct = parse([{...response, passwordAttempted:password}], length)[0];
    if (direct) { delete state.pendingPassword; return {feedback:direct}; }
  }
  const scraped = await readLogs();
  if (!scraped?.success) return {success:false, reason:'Heartbleed unavailable', code:scraped?.code};
  const feedback = parse(scraped.logs, length).find(record => record.password === password);
  if (!feedback) {
    // A lost packet can disappear from the bounded native log. Allow a later re-probe after three reads.
    if (++state.pendingMisses >= 3) delete state.pendingPassword;
    return {success:false, reason:'matching authentication feedback not found; progress retained'};
  }
  delete state.pendingPassword;
  return {feedback};
}

/** Test every unknown position in parallel; numeric passwords take at most eleven authentications. */
export async function solveNilPassword(details, authenticate, readLogs, state = {}) {
  const length = details.passwordLength;
  if (feedbackModelId(details) !== 'NIL' || !Number.isInteger(length) || length < 0 || length > 64)
    return {success:false, reason:'unsupported NIL details'};
  if (length === 0) return authenticateEmptyPassword(authenticate);
  const alphabet = feedbackAlphabet(details), signature = feedbackSignature(details);
  if (state.signature !== signature || !Array.isArray(state.choices)) {
    state.signature = signature;
    state.choices = Array.from({length}, () => [...alphabet]);
    delete state.pendingPassword;
  }
  const apply = record => {
    const next = state.choices.map((choices, i) => record.tokens[i] === 'yes'
      ? choices.filter(char => char === record.password[i]) : choices.filter(char => char !== record.password[i]));
    if (next.some(choices => !choices.length)) return false;
    state.choices = next;
    return true;
  };
  const scraped = await readLogs();
  if (!scraped?.success) return {success:false, reason:'Heartbleed unavailable', code:scraped?.code};
  for (const record of nilFeedbackFromLogs(scraped.logs, length)) if (!apply(record)) {
    state.signature = null;
    return {success:false, reason:'contradictory feedback; resetting progress'};
  }
  for (let attempts = 0; attempts < feedbackTurnBudget(details); attempts++) {
    const password = state.pendingPassword ?? state.choices.map(choices => choices[0]).join('');
    const result = await feedbackProbe(password, authenticate, readLogs, nilFeedbackFromLogs, length, state);
    if (!result.feedback) return result;
    if (!apply(result.feedback)) {
      state.signature = null;
      return {success:false, reason:'contradictory feedback; resetting progress'};
    }
  }
  return {success:false, reason:'NIL probe budget reached; progress retained'};
}

/** Mastermind: determine multiplicities, then bisect positions. No exponential candidate list. */
export async function solveMastermindPassword(details, authenticate, readLogs, state = {}) {
  const length = details.passwordLength;
  if (feedbackModelId(details) !== 'DeepGreen' || !Number.isInteger(length) || length < 0 || length > 64)
    return {success:false, reason:'unsupported Mastermind details'};
  if (length === 0) return authenticateEmptyPassword(authenticate);
  const alphabet = feedbackAlphabet(details), signature = feedbackSignature(details);
  if (state.signature !== signature || !Array.isArray(state.known)) {
    Object.assign(state, {signature, phase:'counts', counts:{}, charIndex:0, known:Array(length).fill(null), groups:[]});
    delete state.pendingPassword;
  }
  const reset = reason => { state.signature = null; return {success:false, reason:reason+'; resetting progress'}; };
  const scraped = await readLogs();
  if (!scraped?.success) return {success:false, reason:'Heartbleed unavailable', code:scraped?.code};
  // Uniform manual guesses reveal multiplicities and can save new network requests.
  for (const record of mastermindFeedbackFromLogs(scraped.logs, length)) {
    const char = record.password[0];
    if (!alphabet.includes(char) || record.password !== char.repeat(length)) continue;
    if (record.misplaced !== 0 || state.counts[char] !== undefined && state.counts[char] !== record.exact)
      return reset('contradictory Mastermind feedback');
    state.counts[char] = record.exact;
    if (state.pendingPassword === record.password) delete state.pendingPassword;
  }
  for (let attempts = 0; attempts < feedbackTurnBudget(details); attempts++) {
    if (state.phase === 'counts') {
      const total = Object.values(state.counts).reduce((sum, count) => sum+count, 0);
      if (total > length) return reset('invalid character counts');
      if (total === length) {
        const positions = Array.from({length}, (_, i) => i);
        state.groups = Object.entries(state.counts).filter(([,count]) => count > 0)
          .map(([char,count]) => ({char,count,positions}));
        state.phase = 'positions';
        continue;
      }
      while (state.charIndex < alphabet.length && state.counts[alphabet[state.charIndex]] !== undefined) state.charIndex++;
      if (state.charIndex >= alphabet.length) return reset('character alphabet exhausted');
      const char = alphabet[state.charIndex], password = char.repeat(length);
      // If Heartbleed supplied the pending uniform guess, consume it before moving to the next character.
      if (state.pendingPassword !== undefined && state.pendingPassword !== password) delete state.pendingPassword;
      const result = await feedbackProbe(password, authenticate, readLogs, mastermindFeedbackFromLogs, length, state);
      if (!result.feedback) return result;
      if (result.feedback.misplaced !== 0) return reset('invalid uniform feedback');
      state.counts[char] = result.feedback.exact;
      state.charIndex++;
      continue;
    }
    const group = state.groups[0];
    if (!group) {
      if (state.known.some(char => char === null)) return reset('unresolved positions');
      const result = await feedbackProbe(state.known.join(''), authenticate, readLogs, mastermindFeedbackFromLogs, length, state);
      return result.feedback ? reset('Mastermind confirmation failed') : result;
    }
    const positions = group.positions.filter(i => state.known[i] === null);
    if (group.count < 0 || group.count > positions.length) return reset('inconsistent position counts');
    if (group.count === 0 || group.count === positions.length) {
      if (group.count) for (const i of positions) state.known[i] = group.char;
      state.groups.shift();
      continue;
    }
    const half = Math.ceil(positions.length/2), left = positions.slice(0, half), right = positions.slice(half);
    // The game's supported alphabets exclude this marker; every match comes from known positions or the probe.
    const guess = state.known.map(char => char ?? '\u25a0');
    for (const i of left) guess[i] = group.char;
    const result = await feedbackProbe(guess.join(''), authenticate, readLogs, mastermindFeedbackFromLogs, length, state);
    if (!result.feedback) return result;
    const guessedCounts = {};
    for (const char of guess) guessedCounts[char] = (guessedCounts[char] || 0)+1;
    const expectedMatches = Object.entries(guessedCounts).reduce((sum,[char,count]) => sum+Math.min(count,state.counts[char]||0),0);
    const inLeft = result.feedback.exact-state.known.filter(char => char !== null).length;
    const inRight = group.count-inLeft;
    if (result.feedback.exact+result.feedback.misplaced !== expectedMatches || inLeft < 0 || inLeft > left.length || inRight < 0 || inRight > right.length)
      return reset('inconsistent Mastermind feedback');
    state.groups.splice(0, 1, {char:group.char,count:inLeft,positions:left}, {char:group.char,count:inRight,positions:right});
  }
  return {success:false, reason:'Mastermind probe budget reached; progress retained'};
}
