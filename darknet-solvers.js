import {feedbackTurnBudget,isBlankPassword,authenticateEmptyPassword,feedbackModelId,nilFeedbackFromLogs,solveNilPassword,mastermindFeedbackFromLogs,solveMastermindPassword} from './darknet-feedback.js';
// darknet-solvers.js — deterministic password solvers for darknet models.
// Mirrors the native Dark Net authentication feedback and password formats.
import { solveAdvancedPassword } from './darknet-advanced.js';
import { defaultSettingsDictionary, dogNameDictionary, EUCountries, commonPasswordDictionary } from './darknet-dictionaries.js';

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // numbers + lettersUppercase

export { isBlankPassword, nilFeedbackFromLogs, solveNilPassword, mastermindFeedbackFromLogs, solveMastermindPassword };

export const romanNumeralDecoder = (input) => {
  if (!input || String(input).toLowerCase() === "nulla") return 0;
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0, prev = 0;
  for (let i = input.length - 1; i >= 0; i--) {
    const v = map[input[i]] ?? 0;
    total += v < prev ? -v : v;
    prev = v;
  }
  return total;
};

export const parseBaseN = (numberString, base) => {
  if (!Number.isFinite(base) || base < 2 || base > 36 || !/^[0-9A-Z]+(?:\.[0-9A-Z]+)?$/.test(numberString) ||
      [...numberString].some(char => char !== '.' && CHARS.indexOf(char) >= base)) return NaN;
  let result = 0, index = 0;
  let digit = numberString.split(".")[0].length - 1;
  while (index < numberString.length) {
    const c = numberString[index];
    if (c === ".") { index++; continue; }
    result += CHARS.indexOf(c) * base ** digit;
    index++; digit--;
  }
  return result;
};

export const decodeBinary = (encoded) =>
  encoded.trim().split(/\s+/)
    .map((b) => String.fromCharCode(parseInt(b, 2)))
    .join("");

export const decodeXor = (data) => {
  const text = String(data), separator = text.lastIndexOf(';');
  if (separator < 0) return null;
  const encrypted = text.slice(0, separator), masksStr = text.slice(separator + 1);
  const masks = masksStr.trim().split(/\s+/);
  if (masks.length !== encrypted.length || masks.some(mask => !/^[01]{1,8}$/.test(mask))) return null;
  let out = "";
  for (let i = 0; i < encrypted.length; i++) {
    const mask = parseInt(masks[i] ?? "0", 2);
    out += String.fromCharCode(encrypted.charCodeAt(i) ^ mask);
  }
  return out;
};

// Recursive-descent evaluator for the arithmetic model. The game's parser
// produces a plain float here, so a correct evaluation should match its string.
export const evalArithmetic = (expr) => {
  const s = String(expr)
    .replaceAll("ҳ", "*").replaceAll("÷", "/")
    .replaceAll("➕", "+").replaceAll("➖", "-")
    .replaceAll("ns.exit(),", "")
    .split(",")[0].replace(/\s+/g, "");
  if (!s || !/^[\d+\-*/().^]+$/.test(s)) return null;
  let pos = 0;
  const num = () => {
    const match = s.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) return NaN;
    pos += match[0].length;
    return Number(match[0]);
  };
  const factor = () => {
    if (s[pos] === "(") { pos++; const v = expr_(); if (s[pos] !== ")") return NaN; pos++; return v; }
    if (s[pos] === "-") { pos++; return -factor(); }
    if (s[pos] === "+") { pos++; return factor(); }
    return num();
  };
  const power = () => {
    const base = factor();
    if (s[pos] === "^" || s.startsWith("**", pos)) {
      pos += s[pos] === "^" ? 1 : 2;
      return Math.pow(base, power());
    }
    return base;
  };
  const term = () => {
    let v = power();
    while (s[pos] === "*" || s[pos] === "/") {
      const op = s[pos++]; const r = power();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const expr_ = () => {
    let v = term();
    while (s[pos] === "+" || s[pos] === "-") {
      const op = s[pos++]; const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = expr_();
  return pos === s.length && Number.isFinite(v) ? v : null;
};

// Trial-divide by all primes <= 97; the game multiplies exactly one largePrime
// (>= 1069) by a product of small primes, so whatever remains is the answer.
const SMALL_PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
export const largestPrimeFactor = (target) => {
  let n = Number(target);
  if (!Number.isFinite(n) || n < 2) return null;
  for (const p of SMALL_PRIMES) while (n % p === 0) n /= p;
  return n > 1 ? n : null;
};

// Permutations of a sorted digit string, skipping leading zeros (the game's
// getPassword returns Number(...).toString(), which strips them).
export const permutationsNoLeadingZero = (sorted) => {
  const out = new Set();
  const chars = sorted.split("");
  const recurse = (prefix, rest) => {
    if (rest.length === 0) {
      if (prefix.length > 0 && prefix[0] !== "0") out.add(prefix);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      if (i > 0 && rest[i] === rest[i - 1]) continue;
      recurse(prefix + rest[i], rest.slice(0, i).concat(rest.slice(i + 1)));
    }
  };
  recurse("", chars);
  return [...out];
};

/** Models whose native input can intentionally differ from passwordLength. */
export function acceptedPasswordLengths(details) {
  const length = details?.passwordLength;
  if (!Number.isInteger(length) || length < 0) return null;
  return details.modelId === 'Pr0verFl0' && length > 0 ? [length, length * 2] : [length];
}

export function passwordLengthMatches(details, password) {
  const lengths = acceptedPasswordLengths(details);
  return lengths === null || lengths.includes(String(password).length);
}

/** Conservative candidates explicitly revealed by native hint text. */
export function passwordHintCandidates(details) {
  const hint = String(details?.passwordHint ?? '').trim();
  if (!hint) return [];
  const found = new Set();
  const add = value => {
    const text = String(value ?? '').trim();
    if (text && text.length <= 64 && !/^(?:not|none|empty|unset|unknown|n['’]?t)$/i.test(text)) found.add(text);
  };
  for (const match of hint.matchAll(/["'`]([^"'`]{1,64})["'`]/g)) add(match[1]);
  for (const match of hint.matchAll(/\b(?:password|passcode|pass phrase|code|pin|key)\s*(?:is\b\s*:?|:)\s*["'`]?([^\s,.;"'`]+)/gi)) add(match[1]);
  if (/number|digit/i.test(hint)) add(hint.replace(/\D+/g, ''));
  return [...found];
}

export function modelCandidates(details) {
  if (isBlankPassword(details)) return [''];
  const data = String(details.data ?? '');
  const length = details.passwordLength;
  let value = null;
  switch (details.modelId) {
    case 'FreshInstall_1.0': return [...defaultSettingsDictionary];
    case 'Laika4': return [...dogNameDictionary];
    case 'EuroZone Free': return [...EUCountries];
    case 'TopPass': return [...commonPasswordDictionary];
    case 'ZeroLogon': return [''];
    case 'DeskMemo_3.1': {
      // EchoVuln hints end with the password ("The PIN is 85", "Remember to use 482", "It's set
      // to 71"), and the server ships no hint data, so the trailing token is the answer.
      value = data;
      if (!value) {
        const hint = String(details.passwordHint ?? '').trim();
        const token = hint.split(/\s+/).filter(Boolean).pop() ?? '';
        if (token) return [token];
      }
      break;
    }
    case 'CloudBlare(tm)': value = data.replace(/\D/g, ''); break;
    // BufferOverflow: sending the mask character twice the buffer length overwrites the expected
    // value, so received and expected buffers match. The mask must be the game's own "■" (U+25A0).
    case 'Pr0verFl0': return Number.isInteger(length) && length > 0 && length <= 64 ? ['■'.repeat(length * 2)] : [];
    case '110100100': if (/^[01]+(?:\s+[01]+)*$/.test(data.trim())) value = decodeBinary(data); break;
    case 'OrdoXenos': value = decodeXor(data); break;
    case 'PrimeTime 2': value = largestPrimeFactor(data); break;
    case 'MathML': value = evalArithmetic(data); break;
    case 'OctantVoxel': {
      const [base, encoded] = data.split(',');
      if (Number(base) >= 2 && Number(base) <= 36 && encoded) value = parseBaseN(encoded.trim().toUpperCase(), Number(base));
      break;
    }
    case 'BellaCuore': if (!data.includes(',') && /^(?:[IVXLCDM]+|nulla)$/i.test(data)) value = romanNumeralDecoder(data.toUpperCase()); break;
    // PHP 5.4 (SortedEchoVuln) leaks the sorted digits. Length-5 permutations are cheap; longer
    // puzzles are solved by the RMS-deviation solver, so generating them here would only burn memory.
    case 'PHP 5.4': if (/^\d{1,6}$/.test(data) && Number.isInteger(length) && length > 0 && length <= 5) return permutationsNoLeadingZero(data); break;
  }
  return value !== null && value !== '' && (typeof value !== 'number' || Number.isFinite(value)) ? [String(value)] : [];
}

export function dictionaryWords(ns) {
  const words = new Set();
  for (const file of ns.ls(ns.getHostname(), '.lit')) {
    try {
      const data = JSON.parse(ns.read(file));
      if (Array.isArray(data)) for (const word of data) {
        if (typeof word === 'string' && word.length <= 64) words.add(word);
        if (words.size >= 10000) return [...words];
      }
    } catch { /* Narrative literature is not a password dictionary. */ }
  }
  return [...words];
}

export function supportsFeedbackModel(details) {
  return ['NIL', 'DeepGreen'].includes(feedbackModelId(details)) || [ 'AccountsManager_4.2', '2G_cellular', 'RateMyPix.Auth', 'BigMo%od',
    'Factori-Os', 'KingOfTheHill', 'OpenWebAccessPoint', '(The Labyrinth)'].includes(details.modelId) ||
    (details.modelId === 'PHP 5.4' && details.passwordLength >= 5) ||
    (details.modelId === 'BellaCuore' && String(details.data).includes(','));
}

/** Models whose password is derived from the server's data or hint text, so a scraped log line can
 * supply the missing input. Dictionary and blank models never need one. */
export const puzzleInputModels = new Set(['CloudBlare(tm)', 'DeskMemo_3.1', '110100100', 'OrdoXenos',
  'PrimeTime 2', 'MathML', 'OctantVoxel', 'BellaCuore', 'Pr0verFl0', 'AccountsManager_4.2',
  '2G_cellular', 'RateMyPix.Auth', 'BigMo%od', 'Factori-Os', 'KingOfTheHill', 'OpenWebAccessPoint',
  '(The Labyrinth)', 'DeepGreen', 'NIL', 'PHP 5.4']);
export function modelUsesPuzzleInput(modelId) {
  return puzzleInputModels.has(String(modelId ?? ''));
}

export function isStalledScout(process, status, now = Date.now()) {
  return !!process && status?.pid === process.pid && Number.isFinite(status.at) && status.at > 0 &&
    now - status.at > 30 * 60_000;
}

/** Stateful bounded solver; feedback comes from the exact attempt's Heartbleed log. */
export async function solveFeedbackPassword(details, authenticate, readLogs, state = {}, readLabReport = null,readLabRadar=null,authenticateMany=null) {
  if (isBlankPassword(details)) return authenticateEmptyPassword(authenticate);
  if (feedbackModelId(details) === 'NIL') return solveNilPassword(details, authenticate, readLogs, state);
  if (feedbackModelId(details) === 'DeepGreen') return solveMastermindPassword(details, authenticate, readLogs, state);
  const length = details.passwordLength;
  if (!supportsFeedbackModel(details) || !Number.isInteger(length) || length < 1 || length > 64)
    return { success: false, reason: 'unsupported feedback details' };
  // For feedback models the server's data field carries the latest response ("Higher"/"Lower"),
  // not the puzzle, so including it in the signature would wipe the solver's bounds on every turn.
  const dataIsFeedback = supportsFeedbackModel(details);
  const signature = JSON.stringify([details.modelId, length, details.passwordFormat, dataIsFeedback ? null : details.data]);
  if (state.signature !== signature) {
    for (const key of Object.keys(state)) delete state[key];
    Object.assign(state, { signature, prefix: '', index: 0, low: 0, high: 10 ** Math.min(15, length) - 1,
      residue: 0n, modulus: 1n, primeIndex: 0 });
    if (details.modelId === 'BellaCuore') {
      const [low, high] = String(details.data).split(',').map(value => romanNumeralDecoder(value.trim().toUpperCase()));
      state.low = low; state.high = high;
    }
  }
  const alphabet = details.passwordFormat === 'numeric' ? '0123456789' :
    details.passwordFormat === 'alphabetic' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' :
    details.passwordFormat === 'alphanumeric' ? '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' :
    Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  // Numeric feedback solvers work with numbers, but the native password is a
  // fixed-length string. Normalize here so "5" becomes "05" for length 2.
  const normalizeNumeric = value => {
    const text = String(value);
    return details.passwordFormat === 'numeric' && text.length < length && /^\d+$/.test(text)
      ? text.padStart(length, '0') : value;
  };
  const probe = async rawPassword => {
    const password = normalizeNumeric(rawPassword);
    if(state.pendingPassword!==undefined && state.pendingPassword!==password)return {success:false,reason:'waiting for pending authentication feedback'};
    if(state.pendingPassword===undefined) {
      const result = await authenticate(password);
      if (result?.success) return { success: true, password: details.modelId === '(The Labyrinth)' && typeof result.data === 'string' ? result.data : password };
      if (Number(result?.code) !== 401) return { success: false, reason: 'authentication interrupted', code: result?.code };
      // Maze responses describe a move directly; never replay them as log feedback.
      if (details.modelId === '(The Labyrinth)') return { feedback: result };
      state.pendingPassword=password;state.pendingMisses=0;
    }
    const scraped = await readLogs();
    if (!scraped?.success) return { success: false, reason: 'Heartbleed unavailable', code: scraped?.code };
    for (const line of scraped.logs || []) {
      try {
        const record = typeof line === 'string' ? JSON.parse(line) : line;
        if (Number(record?.code) === 401 && record.passwordAttempted === password) { delete state.pendingPassword;delete state.pendingMisses;return { feedback: record }; }
      } catch { /* unrelated log */ }
    }
    if(++state.pendingMisses>=3)delete state.pendingPassword;
    return { success: false, reason: 'matching authentication feedback not found; progress retained' };
  };
  // One worker launch authenticates a batch of independent guesses, then a single Heartbleed
  // scrape yields the answer for every one of them. Only models whose probes do not depend on each
  // other's answers use this; adaptive searches stay sequential.
  const probeMany = authenticateMany ? async rawPasswords => {
    const passwords = rawPasswords.map(normalizeNumeric);
    if (!passwords.length) return [];
    const batch = await authenticateMany(passwords);
    if (batch?.success) return [{ success: true, password: batch.password ?? passwords[0] }];
    const scraped = await readLogs();
    const seen = new Map();
    for (const line of (scraped?.logs || [])) {
      try {
        const record = typeof line === 'string' ? JSON.parse(line) : line;
        if (Number(record?.code) === 401 && passwords.includes(record.passwordAttempted)) seen.set(record.passwordAttempted, record);
      } catch { /* unrelated log */ }
    }
    return passwords.map(password => seen.has(password)
      ? { feedback: seen.get(password) }
      : { success: false, reason: 'matching authentication feedback not found; progress retained' });
  } : null;
  if (['PHP 5.4', 'Factori-Os', 'KingOfTheHill', 'OpenWebAccessPoint', '(The Labyrinth)'].includes(details.modelId))
    return solveAdvancedPassword(details, probe, readLogs, state, readLabReport,readLabRadar,probeMany);
  for (let tries = 0; tries < feedbackTurnBudget(details); tries++) {
    if (['AccountsManager_4.2', 'BellaCuore'].includes(details.modelId)) {
      if (length > 15 || state.low > state.high) return { success: false, reason: 'numeric range exhausted' };
      const guess = String(Math.floor(state.low + (state.high - state.low) / 2));
      const result = await probe(guess);
      if (!result.feedback) return result;
      const direction = String(result.feedback.data);
      if (direction === 'Higher' || direction === 'PARUM BREVIS') state.low = Number(guess) + 1;
      else if (direction === 'Lower' || direction === 'ALTUS NIMIS') state.high = Number(guess) - 1;
      else return { success: false, reason: 'invalid range feedback' };
    } else if (details.modelId === 'BigMo%od') {
      // Coprime divisors <=32 expose password % divisor directly. Combine residues.
      const divisors = [32, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
      const bound = 10n ** BigInt(length);
      const divisor = divisors[state.primeIndex];
        if (state.modulus >= bound) {
          const final = await probe(String(state.residue));
          if (final.feedback) { state.signature = null; return { success: false, reason: 'modular confirmation failed; resetting progress' }; }
          return final;
        }
      if (!divisor || length > 15) return { success: false, reason: 'modular range exceeds available divisors' };
      // Each divisor's residue is independent, so the opening round resolves a batch at once and
      // combines them with the same coprime accumulation used for single probes.
      if (probeMany && state.primeIndex === 0) {
        const batch = divisors.slice(0, 8);
        const results = await probeMany(batch.map(String));
        const residues = results.map(item => Number(item?.feedback?.data));
        if (residues.every((value, index) => Number.isInteger(value) && value >= 0 && value < batch[index])) {
          for (let index = 0; index < batch.length; index++) {
            const p = BigInt(batch[index]);
            let multiplier = 0n;
            while (multiplier < p && (state.residue + state.modulus * multiplier) % p !== BigInt(residues[index])) multiplier++;
            if (multiplier === p) return { success: false, reason: 'inconsistent modular feedback' };
            state.residue += state.modulus * multiplier;
            state.modulus *= p;
            state.primeIndex++;
          }
          continue;
        }
      }
      const result = await probe(String(divisor));
      if (!result.feedback) return result;
      const residue = Number(result.feedback.data);
      if (!Number.isInteger(residue) || residue < 0 || residue >= divisor) return { success: false, reason: 'invalid modular feedback' };
      const p = BigInt(divisor);
      let multiplier = 0n;
      while (multiplier < p && (state.residue + state.modulus * multiplier) % p !== BigInt(residue)) multiplier++;
      if (multiplier === p) return { success: false, reason: 'inconsistent modular feedback' };
      state.residue += state.modulus * multiplier;
      state.modulus *= p; state.primeIndex++;
    } else {
      if (state.prefix.length === length) return probe(state.prefix);
      if (state.index >= alphabet.length) { state.signature = null; return { success: false, reason: 'character alphabet exhausted' }; }
      const position = state.prefix.length;
      const guess = state.prefix + alphabet[state.index] + (details.modelId === '2G_cellular' ? alphabet[0] : '■').repeat(length - position - 1);
      const result = await probe(guess);
      if (!result.feedback) return result;
      if (details.modelId === '2G_cellular') {
        const mismatch = Number(String(result.feedback.message).match(/mismatch.*\((\d+)\)/i)?.[1]);
        if (!Number.isInteger(mismatch) || mismatch < position || mismatch >= length) return { success: false, reason: 'invalid timing feedback' };
        if (mismatch > position) { state.prefix = guess.slice(0, mismatch); state.index = 1; }
        else state.index++;
      } else {
        if (details.modelId === 'RateMyPix.Auth' && !new RegExp(`^(?:0|(?:🌶️)+)/${length}$`, 'u').test(String(result.feedback.data)))
          return { success: false, reason: 'invalid spice feedback' };
        const exact = (String(result.feedback.data).match(/🌶️/gu) || []).length;
        if (!Number.isInteger(exact) || exact < position || exact > position + 1) return { success: false, reason: 'invalid positional feedback' };
        if (exact === position + 1) { state.prefix += alphabet[state.index]; state.index = 0; }
        else state.index++;
      }
    }
  }
  return { success: false, reason: 'probe budget reached; progress retained' };
}

/** Parse hostname=password records without discarding empty or whitespace credentials. */
export function parsePasswordEntries(text) {
  const entries = new Map();
  for (const row of String(text || '').split(/\r\n|\n|\r/)) {
    if (!row.trim() || row.trimStart().startsWith('#')) continue;
    const separator = row.indexOf('=');
    if (separator < 1) continue;
    const host = row.slice(0, separator).trim();
    if (host) entries.set(host, row.slice(separator + 1));
  }
  return entries;
}

/** Resume exact guesses; only a definitive wrong-password response advances the cursor. */
export async function candidatePasswordTurn(details, saved, candidates, state, authenticate, reconnect=authenticate, now=Date.now(), budget=8, retryAfter=600000, authenticateMany=null) {
  const signature=JSON.stringify([details.hostname,details.modelId,details.passwordLength,details.passwordFormat,details.passwordHint,details.data,typeof saved==='string'?saved:null,candidates]);
  if(state.signature!==signature || Number.isFinite(state.completedAt) && (now<state.completedAt || now-state.completedAt>=retryAfter)) {
    for(const key of Object.keys(state))delete state[key];
    Object.assign(state,{signature,cursor:0,savedRejected:false});
  }
  if(Number.isFinite(state.completedAt))return {success:false,reason:'cooldown'};
  const matchesLength=password=>passwordLengthMatches(details,password);
  // An empty guessed password is only legitimate on a server that documents having none. A stale
  // saved credential, or a permissive length filter while the details are still sparse, otherwise
  // sends "" to hosts whose real password is a normal hint-derived value.
  const blankAllowed=isBlankPassword(details);
  const acceptable=password=>matchesLength(password)&&(password!==''||blankAllowed);
  let used=0;
  if(typeof saved==='string'&&!state.savedRejected) {
    if(!acceptable(saved))state.savedRejected=true;
    else {
      const result=await reconnect(saved);used++;
      if(result?.success)return {success:true,password:saved,saved:true};
      if(Number(result?.code)!==401)return {success:false,reason:'interrupted',code:result?.code};
      state.savedRejected=true;
    }
  }
  const limit=feedbackTurnBudget({probeBudget:budget});
  while(state.cursor<candidates.length&&used<limit) {
    // Try several contiguous candidates in one worker launch when the caller supports it.
    if(authenticateMany&&used+1<limit){
      const batch=[];
      for(let i=state.cursor;i<candidates.length&&batch.length<8&&used+batch.length<limit;i++){
        const candidate=candidates[i];
        if(candidate===saved||!acceptable(candidate))break;
        batch.push(candidate);
      }
      if(batch.length>1){
        const outcome=await authenticateMany(batch);
        if(outcome){
          used+=batch.length;
          if(outcome.success)return {success:true,password:outcome.password??batch[0]};
          if(Number(outcome.code)!==401)return {success:false,reason:'interrupted',code:outcome.code};
          state.cursor+=batch.length;
          continue;
        }
      }
    }
    const password=candidates[state.cursor];
    if(password===saved||!acceptable(password)){state.cursor++;continue;}
    const result=await authenticate(password);used++;
    if(result?.success)return {success:true,password,index:state.cursor};
    if(Number(result?.code)!==401)return {success:false,reason:'interrupted',code:result?.code};
    state.cursor++;
  }
  if(state.cursor>=candidates.length){state.completedAt=now;return {success:false,reason:'exhausted'};}
  return {success:false,reason:'budget'};
}
