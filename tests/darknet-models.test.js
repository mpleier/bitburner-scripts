import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { modelCandidates, solveFeedbackPassword, evalArithmetic, isStalledScout, passwordLengthMatches, passwordHintCandidates } from '../darknet-solvers.js';

function simulation(modelId, password, feedback, format = 'numeric') {
  const logs = [], guesses = [];
  return {
    details: { modelId, passwordLength: password.length, passwordFormat: format }, guesses,
    attempt: async guess => {
      guesses.push(guess);
      if (guess === password) return { success: true, code: 200 };
      logs.unshift(JSON.stringify({ code: 401, passwordAttempted: guess, ...feedback(guess, password) }));
      return { success: false, code: 401 };
    },
    readLogs: async () => ({ success: true, logs }),
  };
}

test('CloudBlare derives its numbers-only password from the mixed source data', () => {
  // "Type the numbers to prove you are human": the data carries the password digits mixed with noise.
  assert.deepEqual(modelCandidates({modelId: 'CloudBlare(tm)', data: '6╸:[8.6]>\\7', passwordLength: 4, passwordFormat: 'numeric'}), ['6867']);
  assert.deepEqual(modelCandidates({modelId: 'CloudBlare(tm)', data: 'no digits here'}), []);
});

test('a hint-only key still yields an exact numeric candidate', () => {
  const candidates = passwordHintCandidates({passwordHint: 'The key is 253', passwordLength: 3, passwordFormat: 'numeric'});
  assert.ok(candidates.includes('253'));
});

test('log-only hint and data are mined once and shared by both solver paths', () => {
  const src = readFileSync(new URL('../darknet-node.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!modelUsesPuzzleInput\(info\?\.modelId\)\) return info;/);
  assert.match(src, /if \(!hint && typeof record\?\.message === 'string' && record\.message\.trim\(\)\) hint = record\.message;/);
  assert.match(src, /return \{ \.\.\.info, data: needData \? cached\.data : info\.data, passwordHint: needHint \? cached\.hint : info\.passwordHint \};/);
  assert.match(src, /const informed=await mineDetails\(host,info\);\s*\n\s*if\(informed!==info\)\{info=informed;candidates=candidatesFor\(info,candidates\);\}/);
});

test('the feedback branch tries a model-derived password before probing for hints', () => {
  const src = readFileSync(new URL('../darknet-node.js', import.meta.url), 'utf8');
  assert.match(src, /const minedDigits = String\(info\.data \?\? ''\)\.replace\(\/\\D\+\/g, ''\);/);
  assert.match(src, /for \(const candidate of preferred\.slice\(0, 4\)\)/);
  assert.match(src, /derived password matched; saved in credential store\./);
  assert.match(src, /const ordered = wantsDigits \? \[\.\.\.derived, \.\.\.modelCandidates\(info\)\]/);
});

test('saved passwords are rejected when they cannot match the server format', () => {
  const src = readFileSync(new URL('../darknet-node.js', import.meta.url), 'utf8');
  assert.match(src, /const formatOk = !password \|\| \(\(\) => \{/);
  assert.match(src, /if \(!passwordLengthMatches\(info, password\) \|\| !formatOk\)/);
});

test('static decoders are integrated without evaluating injected game hints', () => {
  assert.deepEqual(modelCandidates({ modelId: '110100100', data: '01000001 00110001' }), ['A1']);
  assert.deepEqual(modelCandidates({ modelId: 'BellaCuore', data: 'XIV' }), ['14']);
  assert.deepEqual(modelCandidates({ modelId: 'OctantVoxel', data: '16,FF' }), ['255']);
  assert.deepEqual(modelCandidates({ modelId: 'Pr0verFl0', passwordLength: 4 }), ['■■■■■■■■']);
  assert.equal(passwordLengthMatches({ modelId: 'Pr0verFl0', passwordLength: 4 }, 'AAAA'), true);
  assert.equal(passwordLengthMatches({ modelId: 'Pr0verFl0', passwordLength: 4 }, 'AAAAAAAA'), true);
  assert.equal(passwordLengthMatches({ modelId: 'Pr0verFl0', passwordLength: 4 }, 'AAA'), false);
  assert.equal(passwordLengthMatches({ modelId: 'FreshInstall_1.0', passwordLength: 4 }, 'AAAAAAAA'), false);
  assert.equal(evalArithmetic('(2+3)*4'), 20);
  assert.equal(evalArithmetic('2^3+1'), 9);
  assert.equal(evalArithmetic('2**3+1'), 9);
  assert.equal(evalArithmetic('(2+3'), null);
  assert.equal(evalArithmetic('2.3.4'), null);
  assert.equal(evalArithmetic('globalThis.process.exit()'), null);
});

test('password hints only supply explicit candidates', () => {
  assert.deepEqual(passwordHintCandidates({passwordHint: 'The password is "hunter2"'}), ['hunter2']);
  assert.deepEqual(passwordHintCandidates({passwordHint: 'Your PIN is: 0421'}), ['0421']);
  assert.deepEqual(passwordHintCandidates({passwordHint: 'The code is 73'}), ['73']);
  assert.deepEqual(passwordHintCandidates({passwordHint: "The password isn't set"}), []);
  assert.deepEqual(passwordHintCandidates({passwordHint: 'There is no password'}), []);
});

test('number feedback uses logarithmic search', async () => {
  const f = simulation('AccountsManager_4.2', '48753', (guess, password) => ({ data: Number(guess) > Number(password) ? 'Lower' : 'Higher' }));
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, '48753');
  assert.ok(f.guesses.length <= 18);
});

test('number feedback keeps its bounds when the server reports new feedback data each turn', async () => {
  const password = '42';
  const logs = [];
  const details = {modelId: 'AccountsManager_4.2', passwordLength: 2, passwordFormat: 'numeric', data: 'Higher'};
  const attempt = async guess => {
    if (Number(guess) === Number(password)) return {success: true};
    logs.push(JSON.stringify({code: 401, passwordAttempted: guess, data: Number(guess) > Number(password) ? 'Lower' : 'Higher'}));
    return {success: false, code: 401};
  };
  const readLogs = async () => ({success: true, logs});
  const state = {};
  let solved = null;
  for (let turn = 0; turn < 12 && !solved; turn++) {
    details.data = logs.length ? (Number(logs[logs.length - 1].passwordAttempted) > Number(password) ? 'Lower' : 'Higher') : 'Higher';
    const result = await solveFeedbackPassword(details, attempt, readLogs, state);
    if (result.success) solved = result.password;
  }
  assert.equal(solved, password, 'bounds must survive the per-attempt feedback echoed in details.data');
});

function mastermindFeedback(guess, password) {
  const exact = [...guess].filter((char, i) => char === password[i]).length;
  const remaining = [...password].filter((char, i) => char !== guess[i]);
  let misplaced = 0;
  for (const [i, char] of [...guess].entries()) {
    if (char === password[i]) continue;
    const at = remaining.indexOf(char);
    if (at >= 0) { remaining.splice(at, 1); misplaced++; }
  }
  return {data:`${exact},${misplaced}`};
}

test('DeepGreen uses native exact and misplaced counts', async () => {
  const f = simulation('DeepGreen', '506', mastermindFeedback);
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, '506');
  assert.equal(new Set(f.guesses).size, f.guesses.length);
});

test('timing model advances the confirmed prefix from mismatch indices', async () => {
  const f = simulation('2G_cellular', 'A9', (guess, password) => ({ message: `Found a mismatch while checking each character (${[...password].findIndex((char, i) => char !== guess[i])})` }), 'alphanumeric');
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, 'A9');
  assert.equal(new Set(f.guesses).size, f.guesses.length);
});

test('longer character searches resume after their bounded probe allowance', async () => {
  const f = simulation('DeepGreen', 'z9Y8x7W6', mastermindFeedback, 'alphanumeric');
  const state = {};
  const first = await solveFeedbackPassword(f.details, f.attempt, f.readLogs, state);
  assert.equal(first.success, false);
  assert.match(first.reason, /progress retained/);
  const second = await solveFeedbackPassword(f.details, f.attempt, f.readLogs, state);
  assert.equal(second.password, 'z9Y8x7W6');
  assert.equal(new Set(f.guesses).size, f.guesses.length);
});

test('modulo model reconstructs the password from coprime residues', async () => {
  const f = simulation('BigMo%od', '98765', (guess, password) => ({ data: String((Number(password) % Number(guess)) % (((Number(guess) - 1) % 32) + 1)) }));
  const result = await solveFeedbackPassword(f.details, f.attempt, f.readLogs);
  assert.equal(result.password, '98765');
});

test('scout recovery requires a stale heartbeat from the same PID', () => {
  const now = 4e6;
  assert.equal(isStalledScout({ pid: 42 }, { pid: 42, at: 1e6 }, now), true);
  assert.equal(isStalledScout({ pid: 42 }, { pid: 41, at: 1e6 }, now), false);
  assert.equal(isStalledScout({ pid: 42 }, { pid: 42, at: now }, now), false);
  assert.equal(isStalledScout({ pid: 42 }, {}, now), false);
});

test('numeric range solver resumes across short turns without repeating guesses',async()=>{
 const f=simulation('AccountsManager_4.2','48753',(guess,password)=>({data:Number(guess)>Number(password)?'Lower':'Higher'}));
 f.details.probeBudget=2;const state={};let result;
 for(let turn=0;turn<20;turn++){
  const before=f.guesses.length;result=await solveFeedbackPassword(f.details,f.attempt,f.readLogs,state);
  assert.ok(f.guesses.length-before<=2);if(result.success)break;
  assert.match(result.reason,/progress retained/);
 }
 assert.equal(result.password,'48753');assert.equal(new Set(f.guesses).size,f.guesses.length);
});
