import {isBlankPassword,authenticateEmptyPassword,feedbackModelId,nilFeedbackFromLogs,solveNilPassword,mastermindFeedbackFromLogs,solveMastermindPassword} from './darknet-feedback.js';
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
  if (!s || !/^[\d+\-*/().]+$/.test(s)) return null;
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
  const term = () => {
    let v = factor();
    while (s[pos] === "*" || s[pos] === "/") {
      const op = s[pos++]; const r = factor();
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
    case 'DeskMemo_3.1': value = data; break;
    case 'CloudBlare(tm)': value = data.replace(/\D/g, ''); break;
    case 'Pr0verFl0': return Number.isInteger(length) && length > 0 && length <= 64 ? ['A'.repeat(length * 2)] : [];
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
    case 'PHP 5.4': if (/^\d{1,6}$/.test(data)) return permutationsNoLeadingZero(data); break;
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

export function isStalledScout(process, status, now = Date.now()) {
  return !!process && status?.pid === process.pid && Number.isFinite(status.at) && status.at > 0 &&
    now - status.at > 30 * 60_000;
}

/** Stateful bounded solver; feedback comes from the exact attempt's Heartbleed log. */
export async function solveFeedbackPassword(details, authenticate, readLogs, state = {}, readLabReport = null) {
  if (isBlankPassword(details)) return authenticateEmptyPassword(authenticate);
  if (feedbackModelId(details) === 'NIL') return solveNilPassword(details, authenticate, readLogs, state);
  if (feedbackModelId(details) === 'DeepGreen') return solveMastermindPassword(details, authenticate, readLogs, state);
  const length = details.passwordLength;
  if (!supportsFeedbackModel(details) || !Number.isInteger(length) || length < 1 || length > 64)
    return { success: false, reason: 'unsupported feedback details' };
  const signature = JSON.stringify([details.modelId, length, details.passwordFormat, details.data]);
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
  const probe = async password => {
    const result = await authenticate(password);
    if (result?.success) return { success: true, password: details.modelId === '(The Labyrinth)' && typeof result.data === 'string' ? result.data : password };
    if (Number(result?.code) !== 401) return { success: false, reason: 'authentication interrupted', code: result?.code };
    if (details.modelId === '(The Labyrinth)') return { feedback: result };
    const scraped = await readLogs();
    if (!scraped?.success) return { success: false, reason: 'Heartbleed unavailable', code: scraped?.code };
    for (const line of scraped.logs || []) {
      try {
        const record = typeof line === 'string' ? JSON.parse(line) : line;
        if (Number(record?.code) === 401 && record.passwordAttempted === password) return { feedback: record };
      } catch { /* unrelated log */ }
    }
    return { success: false, reason: 'matching authentication feedback not found' };
  };
  if (['PHP 5.4', 'Factori-Os', 'KingOfTheHill', 'OpenWebAccessPoint', '(The Labyrinth)'].includes(details.modelId))
    return solveAdvancedPassword(details, probe, readLogs, state, readLabReport);
  for (let tries = 0; tries < 64; tries++) {
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
