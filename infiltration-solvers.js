const arrows = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
const closers = { '[': ']', '<': '>', '(': ')', '{': '}' };
function moveTo(stage, x, y, width, height) {
  const dx = (x - stage.x + width) % width, dy = (y - stage.y + height) % height;
  if (dx) return dx <= width / 2 ? 'ArrowRight' : 'ArrowLeft';
  if (dy) return dy <= height / 2 ? 'ArrowDown' : 'ArrowUp';
  return ' ';
}
/** Derive one correct input from the current stage without changing puzzle state. */
export function infiltrationInput(stage) {
  if (!stage || typeof stage.onKey !== 'function') return { unsupported: true };
  if (typeof stage.answer === 'string' && typeof stage.guess === 'string') {
    if (!stage.answer.startsWith(stage.guess)) return { unsupported: true };
    return { key: stage.answer[stage.guess.length] };
  }
  if (typeof stage.left === 'string' && typeof stage.right === 'string')
    return { key: closers[stage.left[stage.left.length - stage.right.length - 1]] };
  if (Array.isArray(stage.choices) && Number.isInteger(stage.correctIndex))
    return { key: stage.index === stage.correctIndex ? ' ' : 'ArrowRight' };
  if (Array.isArray(stage.code)) return { key: arrows[stage.code[stage.index]] };
  if (Array.isArray(stage.grid) && Array.isArray(stage.answers)) {
    const target = stage.answers[stage.currentAnswerIndex];
    for (let y = 0; y < stage.grid.length; y++) {
      const x = stage.grid[y].indexOf(target);
      if (x >= 0) return { key: moveTo(stage, x, y, stage.grid[0].length, stage.grid.length) };
    }
    return { unsupported: true };
  }
  if (Array.isArray(stage.minefield) && Array.isArray(stage.answer)) {
    if (stage.memoryPhase) return { wait: true };
    for (let y = 0; y < stage.minefield.length; y++) for (let x = 0; x < stage.minefield[y].length; x++)
      if (stage.minefield[y][x] && !stage.answer[y][x])
        return { key: moveTo(stage, x, y, stage.minefield[0].length, stage.minefield.length) };
    return { unsupported: true };
  }
  if (Number.isFinite(stage.guardingEndTime) && Number.isInteger(stage.phase))
    return stage.phase === 1 ? { key: ' ' } : stage.phase === 0 ? { wait: true } : { unsupported: true, missedWindow: true };
  if (stage.wiresToCut instanceof Set && Array.isArray(stage.cutWires)) {
    const index = [...stage.wiresToCut].find(i => !stage.cutWires[i]);
    return Number.isInteger(index) ? { key: String(index + 1) } : { unsupported: true };
  }
  if (Number.isInteger(stage.count) && stage.count >= 0 && stage.count <= 3) return { wait: true };
  return { unsupported: true };
}

export function chooseInfiltration(locations, city, maxDifficulty = 1.5, { history = {}, reputation = false, now = Date.now(), interval = 20000, canTravel = true } = {}) {
  const rewardKey = reputation ? 'tradeRep' : 'sellCash';
  const score = info => {
    const record = history[info.location.name] || {};
    const reliability = ((record.successes || 0) + 2) / ((record.successes || 0) + (record.failures || 0) + 2);
    const seconds = (record.durationMs > 0 ? record.durationMs : (info.maxClearanceLevel + 5) * 3000) / 1000;
    return info.reward[rewardKey] * reliability / (seconds + interval / 1000 + (info.location.city === city ? 0 : 5));
  };
  return locations.filter(info => info.difficulty <= maxDifficulty && info.reward?.[rewardKey] > 0 &&
    (canTravel || info.location.city === city) && !(history[info.location.name]?.retryAt > now))
    .sort((a, b) => score(b) - score(a) ||
      Number(b.location.city === city) - Number(a.location.city === city))[0] || null;
}

/** Demand recovery follows the game's exponential decay. A clamped zero needs another observation. */
export function marketRecoveryDelay(demand, target = 2 / 3) {
  if (!Number.isFinite(demand) || demand >= target) return 0;
  if (demand <= 0) return 60000;
  return Math.max(1000, Math.ceil(Math.log((1 - demand) / (1 - target)) / 0.00004));
}
export function recordInfiltrationOutcome(previous = {}, result, now = Date.now()) {
  if (result.status === 'completed') return { ...previous, successes: (previous.successes || 0) + 1,
    failureStreak: 0, retryAt: 0, durationMs: result.durationMs > 0 ?
      (previous.durationMs > 0 ? previous.durationMs * 0.7 + result.durationMs * 0.3 : result.durationMs) : previous.durationMs };
  if (!['failed', 'missed-window', 'unsupported-ui', 'stage-timeout', 'unsupported-entry-ui', 'entry-ui-unavailable', 'error'].includes(result.status)) return previous;
  const failureStreak = (previous.failureStreak || 0) + 1;
  return { ...previous, failures: (previous.failures || 0) + 1, failureStreak,
    retryAt: now + Math.min(600000, 30000 * 2 ** Math.min(5, failureStreak - 1)) };
}

/** React passes the current infiltration state to its stage component. */
export function findInfiltrationState(document) {
  for (const node of document.querySelectorAll('h4,h5,button')) {
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    for (let fiber = fiberKey && node[fiberKey], depth = 0; fiber && depth < 40; fiber = fiber.return, depth++) {
      const state = fiber.memoizedProps?.state;
      if (typeof state?.startInfiltration === 'function' && typeof state.cancel === 'function' &&
          typeof state.stage?.onKey === 'function' && Number.isInteger(state.maxLevel)) return state;
    }
  }
  return null;
}

export function selectRewardFaction(document, faction) {
  for (const node of document.querySelectorAll('[role="combobox"]')) {
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    for (let fiber = fiberKey && node[fiberKey], depth = 0; fiber && depth < 12; fiber = fiber.return, depth++) {
      const props = fiber.memoizedProps;
      if (props && typeof props.onChange === 'function' && typeof props.value === 'string') {
        const choices = [];
        const collect = child => {
          if (Array.isArray(child)) child.forEach(collect);
          else if (child?.props) { if (typeof child.props.value === 'string') choices.push(child.props.value); collect(child.props.children); }
        };
        collect(props.children);
        if (choices.length && !choices.includes(faction)) continue;
        props.onChange({ target: { value: faction } });
        return true;
      }
    }
  }
  return false;
}

export function selectedRewardFaction(document, faction) {
  for (const node of document.querySelectorAll('[role="combobox"]')) {
    const fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    for (let fiber = fiberKey && node[fiberKey], depth = 0; fiber && depth < 12; fiber = fiber.return, depth++)
      if (fiber.memoizedProps?.value === faction && typeof fiber.memoizedProps.onChange === 'function') return true;
  }
  return false;
}

/** Invoke the game's company-entry callback; native scripted clicks are ignored there. */
export function enterInfiltration(button) {
  if (!button || button.disabled || !/^Infiltrate Company$/i.test(button.textContent.trim())) return false;
  const propsKey = Object.keys(button).find(key => key.startsWith('__reactProps$'));
  const fiberKey = Object.keys(button).find(key => key.startsWith('__reactFiber$'));
  const onClick = button[propsKey]?.onClick || button[fiberKey]?.memoizedProps?.onClick;
  if (typeof onClick !== 'function') return false;
  onClick({ isTrusted: true, target: button, currentTarget: button, preventDefault() {}, stopPropagation() {} });
  return true;
}

/** Limited game UI diagnostics for compatibility failures; omit model values and event handlers. */
export function infiltrationUiDetails(document) {
  const nodes = [...document.querySelectorAll('h4,h5,button')];
  const samples = [];
  for (const node of nodes.filter(value => /infiltrat|start|cancel/i.test(value.textContent || '')).slice(0, 8)) {
    const keys = Object.keys(node).filter(key => /react/i.test(key));
    const ancestry = [];
    const fiberKey = keys.find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    for (let fiber = fiberKey && node[fiberKey], depth = 0; fiber && depth < 30; fiber = fiber.return, depth++) {
      const props = fiber.memoizedProps;
      if (props?.state || props?.stage) ancestry.push({ component: fiber.type?.name || String(fiber.type).slice(0,40),
        props: Object.keys(props).slice(0,20), stateKeys: props.state ? Object.keys(props.state).slice(0,30) : null,
        stateType: props.state?.constructor?.name, maxLevel: props.state?.maxLevel,
        startType: typeof props.state?.startInfiltration, cancelType: typeof props.state?.cancel, onKeyType: typeof props.state?.stage?.onKey });
    }
    samples.push({ text: (node.textContent || '').slice(0,120), keys, ancestry });
  }
  return { headings: [...document.querySelectorAll('h2,h3,h4,h5')].map(node => node.textContent.slice(0,100)).slice(0,20),
    buttons: [...document.querySelectorAll('button')].map(node => ({ text: node.textContent.trim().slice(0,100), disabled: !!node.disabled })).slice(-30), samples };
}

/** Self-contained so delayed workers recheck control before moving the player's UI. */
export function infiltrationEntryAllowed(ns,ownerPid,respectRoute=false){
 if(!Number.isInteger(ownerPid)||ownerPid<=0||!ns.isRunning(ownerPid)||ns.read('remote-control/paused/infiltration-manager.js.txt').trim()==='true')return false;
 const now=Date.now();
 const record=file=>{try{return JSON.parse(ns.read(file));}catch{return null;}};
 const lease=record('tasks/activity-lock.json');
 if(lease?.ownerPid!==ownerPid||!(lease.expiresAt>now))return false;
 if(respectRoute){
  const route=record('tasks/node-route-plan.json'),reset=ns.getResetInfo();
  if(route?.selected==='bladeburner'&&route.simulacrum!==true&&Number.isFinite(route.at)&&route.at<=now&&now-route.at<=45000&&
   route.augReset===reset.lastAugReset&&route.nodeReset===reset.lastNodeReset&&
   ns.ps('home').some(p=>p.pid===route.ownerPid&&p.filename.replace(/^\//,'')==='autopilot.js'))return false;
 }
 const maintenance=record('tasks/automation-maintenance.json'),transition=record('tasks/progression-transition.json');
 if(maintenance?.expiresAt>now&&ns.isRunning(maintenance.ownerPid)||transition?.expiresAt>now&&ns.isRunning(transition.ownerPid))return false;
 return !ns.ps('home').some(p=>/(^|\/)(casino|ascend)\.js$/.test(p.filename));
}
