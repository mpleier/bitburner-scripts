/** Shared Dark Net cracking policy.
 *  The scout (darknet-node.js) and the coordinator (darknet-manager.js) used to carry their own copy of
 *  the candidate ordering, the response-code constants and the deploy list, which drifted apart. Both now
 *  call this module so a change lands in one place. Keep it free of `ns` calls: it must stay testable and
 *  cheap to import on the 16 GB darknet hosts. */
import {isBlankPassword, modelCandidates, passwordHintCandidates, passwordLengthMatches, passwordFormatMatches} from './darknet-solvers.js';

// DarknetResponseCodeType: 401 = wrong password, 408 = request timed out (the password may have been right).
export const AUTH_FAILURE = 401;
export const TIMED_OUT = 408;
export const RETRY_AFTER_MS = 10 * 60_000;

/** Files a remote Dark Net worker needs on its own host. Both entrypoints sync exactly this list, so a new
 *  policy module has to be added here or the workers deploy with a stale import. */
export const DARKNET_CODE_FILES = Object.freeze([
  'darknet-node.js', 'darknet-loot.js', 'darknet-auth.js', 'darknet-bleed.js', 'darknet-stasis.js',
  'darknet-cache.js', 'darknet-cache-watch.js', 'darknet-solvers.js', 'darknet-crack-policy.js',
  'darknet-throughput-policy.js', 'darknet-charisma-policy.js', 'darknet-ram-policy.js', 'darknet-ram.js',
  'darknet-credentials.js', 'darknet-feedback.js', 'darknet-advanced.js', 'darknet-labyrinth-policy.js',
  'darknet-navigator-policy.js', 'darknet-maze.js', 'darknet-anchor-policy.js', 'darknet-development-policy.js',
  'darknet-dictionaries.js', 'darknet-promote.js', 'darknet-stock-policy.js', 'darknet-migrate.js',
  'darknet-migration-policy.js', 'darknet-storm-policy.js', 'darknet-storm.js', 'darknet-contract-policy.js',
  'darknet-reward-policy.js', 'tasks/dnet-cache-context.json',
]);

/** Ordered password candidates for one host.
 *  A password stated in a log leaks first (the server is telling us the answer), then the model's own guess,
 *  then digits mined from the hint/data — those lead for "type the numbers" hosts because they are the
 *  deterministic answer, not a guess — then the clue, the caller's words and finally short numeric enumeration. */
export function candidatePasswords(details, words, { stated = null } = {}) {
  const matches = value => passwordLengthMatches(details, value) && passwordFormatMatches(details, value);
  // Servers with no password (hint "There is no password", length 0, or the ZeroLogon model) accept the empty
  // string. The length filter below would otherwise discard every candidate and leave nothing to try.
  if (isBlankPassword(details)) return [''];
  const clue = typeof details.data === 'string' ? details.data.trim() : '';
  // "Type the numbers to prove you are human": the clue is the password with other characters mixed in, so the
  // password is the clue's digits alone.
  const digitsOf = text => String(text ?? '').replace(/\D+/g, '');
  const wantsDigits = details.passwordFormat === 'numeric' || /number|digit/i.test(String(details.passwordHint ?? ''));
  const derived = wantsDigits ? [digitsOf(details.data), digitsOf(details.passwordHint)].filter(x => x.length > 0) : [];
  // Very short numeric passwords are cheap to enumerate (at most 999 tries).
  const counted = details.passwordFormat === 'numeric' && details.passwordLength >= 1 && details.passwordLength <= 3
    ? Array.from({ length: 10 ** details.passwordLength }, (_, n) => String(n).padStart(details.passwordLength, '0'))
    : [];
  const modelled = modelCandidates(details);
  const ordered = wantsDigits ? [...derived, ...modelled] : [...modelled, ...derived];
  return [...new Set([
    ...(stated ? [stated] : []),
    ...ordered.filter(matches),
    ...passwordHintCandidates(details).filter(matches),
    ...(clue && matches(clue) ? [clue] : []),
    ...words.filter(matches),
    ...counted,
  ])];
}
