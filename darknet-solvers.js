// darknet-solvers.js — deterministic password solvers for darknet models.
// Mirrors the decode logic in DarknetServerOptions.ts.

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // numbers + lettersUppercase

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
  const [encrypted, masksStr] = String(data).split(";");
  if (encrypted === undefined || masksStr === undefined) return null;
  const masks = masksStr.trim().split(/\s+/);
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
    const start = pos;
    while (pos < s.length && /[\d.]/.test(s[pos])) pos++;
    return parseFloat(s.slice(start, pos));
  };
  const factor = () => {
    if (s[pos] === "(") { pos++; const v = expr_(); if (s[pos] === ")") pos++; return v; }
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