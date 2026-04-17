const box = document.getElementById("detectionBox");
const label = document.querySelector(".detection-label");
const debugBase = document.getElementById("debugBase");
const debugBaseDetails = document.getElementById("debugBaseDetails");
const debugMotion = document.getElementById("debugMotion");
const debugTyping = document.getElementById("debugTyping");
const debugScroll = document.getElementById("debugScroll");
const debugClick = document.getElementById("debugClick");
const debugFinal = document.getElementById("debugFinal");
const debugOverrideToggle = document.getElementById("debugOverrideToggle");
const debugOverrideRange = document.getElementById("debugOverrideRange");
const debugOverrideValue = document.getElementById("debugOverrideValue");
const achievementToasts = document.querySelector(".achievement-toasts");
const BOX_WIDTH = 120;
const BOX_HEIGHT = 150;
const MOTION_WINDOW_MS = 5000;
const MOTION_SAMPLE_LIMIT = 18;
const TYPE_SAMPLE_LIMIT = 20;
const SCROLL_WINDOW_MS = 4000;
const SCROLL_SAMPLE_LIMIT = 15;
const CLICK_SAMPLE_LIMIT = 20;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const standardDeviation = (values) => {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

const formatSigned = (value) => `${value > 0 ? "+" : ""}${value}`;

const showAchievement = (message) => {
  if (!achievementToasts) return;

  const [title, subtitle] = message;
  const toast = document.createElement("div");
  toast.className = "achievement-toast panel";
  toast.innerHTML = `<div class="achievement-toast-title">${title}</div><div class="achievement-toast-subtitle">${subtitle}</div>`;
  achievementToasts.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add("is-settling");
  });

  window.setTimeout(() => {
    const beforeRects = new Map(
      Array.from(achievementToasts.children)
        .filter((node) => node !== toast)
        .map((node) => [node, node.getBoundingClientRect()])
    );

    toast.addEventListener(
      "animationend",
      () => {
        toast.remove();
        requestAnimationFrame(() => {
          Array.from(achievementToasts.children).forEach((node) => {
            const first = beforeRects.get(node);
            if (!first) return;

            const last = node.getBoundingClientRect();
            const dx = first.left - last.left;
            const dy = first.top - last.top;

            if (!dx && !dy) return;

            node.style.transition = "none";
            node.style.transform = `translate(${dx}px, ${dy}px)`;
            node.getBoundingClientRect();
            node.style.transition = "transform 420ms cubic-bezier(0.4, 0, 0.2, 1)";
            node.style.transform = "translate(0, 0)";
          });
        });
      },
      { once: true }
    );
    toast.classList.add("is-exiting");
  }, 3400);
};

const setDebugOverrideState = (enabled) => {
  state.debugOverride.enabled = enabled;
  debugOverrideToggle.textContent = enabled ? "override on" : "override off";
  debugOverrideToggle.classList.toggle("is-active", enabled);
  state.labelDirty = true;
  updateLabel();
};

const setDebugOverrideValue = (value) => {
  state.debugOverride.value = value;
  debugOverrideValue.textContent = `${value}%`;
  state.labelDirty = true;
  if (state.debugOverride.enabled) {
    updateLabel();
  }
};

const getBaseBreakdown = () => {
  const ua = navigator.userAgent;
  const details = [];
  let score = 78;

  if (/headless|phantom|selenium|puppeteer|playwright/i.test(ua)) {
    score -= 40;
    details.push("ua:-40");
  }

  if (navigator.webdriver) {
    score -= 35;
    details.push("webdriver:-35");
  } else {
    score += 10;
    details.push("webdriver:+10");
  }

  if ((navigator.plugins?.length ?? 0) > 0) {
    score += 4;
    details.push("plugins:+4");
  }

  if ((navigator.languages?.length ?? 0) > 0) {
    score += 4;
    details.push("languages:+4");
  }

  if ((navigator.hardwareConcurrency ?? 0) >= 4) {
    score += 2;
    details.push("multi-core:+2");
  }

  if ((navigator.deviceMemory ?? 0) >= 4) {
    score += 2;
    details.push("memory:+2");
  }

  if (navigator.maxTouchPoints > 0) {
    score += 1;
    details.push("touch:+1");
  }

  return {
    score: clamp(Math.round(score), 1, 99),
    details,
  };
};

const state = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  targetX: window.innerWidth / 2,
  targetY: window.innerHeight / 2,
  visible: false,
  trail: [],
  keydowns: [],
  keyHolds: [],
  scrolls: [],
  clicks: [],
  activeKeys: new Map(),
  lastPointerMove: null,
  scores: {
    motion: 0,
    typing: 0,
    scroll: 0,
    click: 0,
  },
  dirty: {
    motion: true,
    typing: true,
    scroll: true,
    click: true,
  },
  labelDirty: true,
  achievements: {
    robot: false,
    robot75: false,
    robot90: false,
    robot99: false,
  },
  debugOverride: {
    enabled: false,
    value: 50,
  },
};

const getBaseConfidence = () => {
  return getBaseBreakdown().score;
};

const getMouseAdjustment = () => {
  const now = performance.now();
  const trail = state.trail.filter((point) => now - point.t <= MOTION_WINDOW_MS);

  if (trail.length < 2) return 0;

  const segmentSpeeds = [];
  let path = 0;
  let turning = 0;
  let previousAngle = null;

  for (let index = 1; index < trail.length; index += 1) {
    const previous = trail[index - 1];
    const current = trail[index];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    const deltaTime = Math.max(current.t - previous.t, 1);
    const speed = distance / deltaTime;

    path += distance;
    segmentSpeeds.push(speed);

    if (distance > 0) {
      const angle = Math.atan2(dy, dx);
      if (previousAngle !== null) {
        let delta = Math.abs(angle - previousAngle);
        delta = Math.min(delta, Math.PI * 2 - delta);
        turning += delta;
      }
      previousAngle = angle;
    }
  }

  const first = trail[0];
  const last = trail[trail.length - 1];
  const displacement = Math.hypot(last.x - first.x, last.y - first.y);
  const straightness = path > 0 ? clamp(displacement / path, 0, 1) : 0;
  const velocityMean = average(segmentSpeeds);
  const velocityDeviation = standardDeviation(segmentSpeeds);
  const velocityVariance = velocityMean > 0 ? clamp(velocityDeviation / velocityMean, 0, 1) : 0;
  const curvature = trail.length > 2 ? clamp(turning / ((trail.length - 2) * Math.PI), 0, 1) : 0;
  const jerk = segmentSpeeds.length > 2
    ? clamp(
        average(segmentSpeeds.slice(1).map((speed, index) => Math.abs(speed - segmentSpeeds[index]))) / 0.9,
        0,
        1
      )
    : 0;
  const teleport = segmentSpeeds.some((speed) => speed > 1.8);
  const straightBotness = clamp((straightness - 0.85) / 0.15, 0, 1);
  const speedBotness = clamp((0.28 - velocityVariance) / 0.28, 0, 1);
  const jerkBotness = clamp((0.18 - jerk) / 0.18, 0, 1);
  const botness = clamp(straightBotness * 0.45 + speedBotness * 0.35 + jerkBotness * 0.2, 0, 1);

  let adjustment = Math.round((1 - botness) * 14 - botness * 30);

  if (teleport) adjustment -= 12;
  if (straightness > 0.92 && velocityVariance < 0.18 && trail.length > 6) adjustment -= 8;

  return clamp(adjustment, -40, 14);
};

const getTypingAdjustment = () => {
  const keydowns = state.keydowns.slice(-TYPE_SAMPLE_LIMIT);
  const holds = state.keyHolds.slice(-TYPE_SAMPLE_LIMIT);

  if (keydowns.length < 3) return 0;

  const intervals = [];
  for (let index = 1; index < keydowns.length; index += 1) {
    intervals.push(keydowns[index].t - keydowns[index - 1].t);
  }

  const holdDurations = holds.map((entry) => entry.duration);
  const intervalMean = average(intervals);
  const holdMean = average(holdDurations);
  const holdVariation = holdMean > 0 ? standardDeviation(holdDurations) / holdMean : 0;
  const pauses = intervals.filter((interval) => interval > 500).length;
  const backspaces = keydowns.filter((entry) => entry.key === "Backspace").length;
  const organicHolds = clamp((holdVariation - 0.08) / 0.2, 0, 1);

  const binSize = 25;
  const maxBinIndex = 20;
  const bins = new Map();

  for (const interval of intervals) {
    const binIndex = Math.min(Math.floor(interval / binSize), maxBinIndex);
    bins.set(binIndex, (bins.get(binIndex) ?? 0) + 1);
  }

  const binCounts = Array.from(bins.values()).sort((a, b) => b - a);
  const dominantShare = binCounts[0] / intervals.length;
  const topTwoShare = ((binCounts[0] ?? 0) + (binCounts[1] ?? 0)) / intervals.length;
  const occupiedBins = bins.size;
  const spreadSpan = Math.max(...bins.keys()) - Math.min(...bins.keys()) + 1;
  const histogramConcentration = clamp((dominantShare - 0.28) / 0.32, 0, 1);
  const pairedConcentration = clamp((topTwoShare - 0.5) / 0.3, 0, 1);
  const histogramSpread = clamp((occupiedBins - 2) / 5, 0, 1);
  const spanSpread = clamp((spreadSpan - 2) / 6, 0, 1);

  let adjustment = 0;
  adjustment += Math.round(histogramSpread * 16);
  adjustment += Math.round(spanSpread * 6);
  adjustment += Math.round(organicHolds * 8);
  adjustment += Math.min(pauses * 3, 9);

  if (backspaces > 0) adjustment += Math.min(backspaces * 3, 9);
  adjustment -= Math.round(histogramConcentration * 30);
  adjustment -= Math.round(pairedConcentration * 14);
  adjustment -= Math.round(clamp((0.12 - holdVariation) / 0.12, 0, 1) * 12);

  if (intervals.length >= 5 && dominantShare > 0.5) adjustment -= 12;
  if (intervals.length >= 6 && dominantShare > 0.65) adjustment -= 10;
  if (dominantShare < 0.4 && occupiedBins >= 4) adjustment += 4;
  if (topTwoShare < 0.65 && spreadSpan >= 5) adjustment += 4;
  if (holdVariation > 0.1 && keydowns.length >= 5) adjustment += 4;

  return clamp(adjustment, -45, 28);
};

const getScrollAdjustment = () => {
  const now = performance.now();
  const scrolls = state.scrolls.filter((entry) => now - entry.t <= SCROLL_WINDOW_MS);

  if (scrolls.length < 3) return 0;

  const deltas = scrolls.map((entry) => Math.abs(entry.deltaY));
  const intervals = [];
  let directionChanges = 0;

  for (let index = 1; index < scrolls.length; index += 1) {
    intervals.push(scrolls[index].t - scrolls[index - 1].t);

    const previousDirection = Math.sign(scrolls[index - 1].deltaY);
    const currentDirection = Math.sign(scrolls[index].deltaY);
    if (previousDirection !== 0 && currentDirection !== 0 && previousDirection !== currentDirection) {
      directionChanges += 1;
    }
  }

  const deltaMean = average(deltas);
  const intervalMean = average(intervals);
  const deltaVariation = deltaMean > 0 ? standardDeviation(deltas) / deltaMean : 0;
  const intervalVariation = intervalMean > 0 ? standardDeviation(intervals) / intervalMean : 0;
  const constantScroll = directionChanges === 0 && deltaVariation < 0.25 && intervalVariation < 0.25;

  let adjustment = 0;
  adjustment += directionChanges * 4;
  adjustment += Math.round(clamp(deltaVariation, 0, 1) * 8);
  adjustment += Math.round(clamp(intervalVariation, 0, 1) * 8);

  if (constantScroll) adjustment -= 18;
  if (deltas.some((delta) => delta > 600)) adjustment -= 6;

  return clamp(adjustment, -30, 14);
};

const getClickAdjustment = () => {
  const clicks = state.clicks.slice(-CLICK_SAMPLE_LIMIT);

  if (clicks.length < 3) return 0;

  const intervals = [];
  for (let index = 1; index < clicks.length; index += 1) {
    intervals.push(clicks[index].t - clicks[index - 1].t);
  }

  const delays = clicks.map((entry) => entry.hoverDelay);
  const distances = clicks.map((entry) => entry.hoverDistance);
  const intervalMean = average(intervals);
  const intervalVariation = intervalMean > 0 ? standardDeviation(intervals) / intervalMean : 0;
  const delayMean = average(delays);
  const delayVariation = delayMean > 0 ? standardDeviation(delays) / delayMean : 0;
  const distanceMean = average(distances);
  const organicCadence = clamp((intervalVariation - 0.1) / 0.18, 0, 1);
  const organicDelay = clamp((delayVariation - 0.08) / 0.16, 0, 1);
  const organicDistance = clamp((distanceMean - 10) / 35, 0, 1);
  const fixedCadence = clamp((0.12 - intervalVariation) / 0.12, 0, 1);
  const fixedDelay = clamp((0.12 - delayVariation) / 0.12, 0, 1);

  let adjustment = 0;
  adjustment += Math.round(organicCadence * 18);
  adjustment += Math.round(organicDelay * 10);
  adjustment += Math.round(organicDistance * 6);
  adjustment += Math.round(clamp((delayMean - 90) / 60, 0, 4) * 2);
  adjustment += Math.round(clamp((distanceMean - 8) / 30, 0, 3) * 2);
  adjustment -= Math.round(fixedCadence * 34);
  adjustment -= Math.round(fixedDelay * 12);

  if (intervals.length >= 5 && intervalVariation < 0.06) adjustment -= 18;
  if (delayMean < 90 && delayVariation < 0.08 && clicks.length >= 5) adjustment -= 8;
  if (organicCadence > 0.4 && organicDelay > 0.25 && clicks.length >= 4) adjustment += 6;
  if (organicCadence > 0.55 && delayVariation > 0.12 && clicks.length >= 4) adjustment += 4;
  if (organicDistance > 0.4 && clicks.length >= 4) adjustment += 2;

  if (delayMean > 240) adjustment += 5;

  return clamp(adjustment, -45, 24);
};

const updateLabel = () => {
  if (!state.labelDirty) {
    return;
  }

  const baseConfidence = getBaseConfidence();
  const baseBreakdown = getBaseBreakdown();
  if (state.dirty.motion) {
    state.scores.motion = getMouseAdjustment();
    state.dirty.motion = false;
  }

  if (state.dirty.typing) {
    state.scores.typing = getTypingAdjustment();
    state.dirty.typing = false;
  }

  if (state.dirty.scroll) {
    state.scores.scroll = getScrollAdjustment();
    state.dirty.scroll = false;
  }

  if (state.dirty.click) {
    state.scores.click = getClickAdjustment();
    state.dirty.click = false;
  }

  const totalAdjustment = state.scores.motion + state.scores.typing + state.scores.scroll + state.scores.click;
  const calculatedConfidence = clamp(baseConfidence + totalAdjustment, 1, baseConfidence);
  const confidence = state.debugOverride.enabled ? clamp(state.debugOverride.value, 1, 99) : calculatedConfidence;

  const isRobot = confidence < 50;

  label.textContent = isRobot ? `Robot: ${100 - confidence}%` : `Human: ${confidence}%`;
  box.classList.toggle("is-robot", isRobot);
  document.body.classList.toggle("is-robot", isRobot);
  debugBase.textContent = `${baseConfidence}%`;
  debugBaseDetails.innerHTML = baseBreakdown.details.length
    ? baseBreakdown.details.map((detail) => `<div>${detail}</div>`).join("")
    : "<div>baseline</div>";
  debugMotion.textContent = formatSigned(state.scores.motion);
  debugTyping.textContent = formatSigned(state.scores.typing);
  debugScroll.textContent = formatSigned(state.scores.scroll);
  debugClick.textContent = formatSigned(state.scores.click);
  debugFinal.textContent = state.debugOverride.enabled ? `${confidence}% override` : `${confidence}% human`;

  if (isRobot) {
    if (!state.achievements.robot) {
      state.achievements.robot = true;
      showAchievement(["Did you just...failed the Turing Test?", "Reaching 50% confidence of being a robot."]);
    }

    if (!state.achievements.robot75 && confidence <= 25) {
      state.achievements.robot75 = true;
      showAchievement(["Haraway would be proud", "Reaching 75% confidence of being a robot."]);
    }
    
    if (!state.achievements.robot90 && confidence <= 10) {
      state.achievements.robot90 = true;
      showAchievement(["The last of us", "Reaching 90% confidence of being a robot."]);
    }

    if (!state.achievements.robot99 && confidence <= 1) {
      state.achievements.robot99 = true;
      showAchievement(["24K Silicon", "Reaching 99% confidence of being a robot."]);
    }
  }

  state.labelDirty = false;
};

const setTarget = (event) => {
  const sample = { x: event.clientX, y: event.clientY, t: performance.now() };

  state.targetX = event.clientX;
  state.targetY = event.clientY;
  state.visible = true;
  state.trail.push(sample);
  state.trail = state.trail.filter((point) => sample.t - point.t <= MOTION_WINDOW_MS).slice(-MOTION_SAMPLE_LIMIT);
  state.lastPointerMove = sample;
  state.dirty.motion = true;
  state.labelDirty = true;
};

const recordKeydown = (event) => {
  const sample = { key: event.key, t: performance.now() };

  state.keydowns.push(sample);
  state.keydowns = state.keydowns.slice(-TYPE_SAMPLE_LIMIT);
  state.dirty.typing = true;
  state.labelDirty = true;

  if (!event.repeat) {
    state.activeKeys.set(event.code, sample.t);
  }
};

const recordKeyup = (event) => {
  const startedAt = state.activeKeys.get(event.code);
  if (startedAt === undefined) return;

  const now = performance.now();
  const sample = { key: event.key, duration: Math.max(now - startedAt, 0), t: now };

  state.keyHolds.push(sample);
  state.keyHolds = state.keyHolds.slice(-TYPE_SAMPLE_LIMIT);
  state.activeKeys.delete(event.code);
  state.dirty.typing = true;
  state.labelDirty = true;
};

const recordScroll = (event) => {
  const sample = { deltaY: event.deltaY, t: performance.now() };

  state.scrolls.push(sample);
  state.scrolls = state.scrolls.filter((entry) => sample.t - entry.t <= SCROLL_WINDOW_MS).slice(-SCROLL_SAMPLE_LIMIT);
  state.dirty.scroll = true;
  state.labelDirty = true;
};

const recordClick = (event) => {
  const now = performance.now();
  const hoverDelay = state.lastPointerMove ? now - state.lastPointerMove.t : 0;
  const hoverDistance = state.lastPointerMove
    ? Math.hypot(event.clientX - state.lastPointerMove.x, event.clientY - state.lastPointerMove.y)
    : 0;

  state.clicks.push({ hoverDelay, hoverDistance, t: now });
  state.clicks = state.clicks.slice(-CLICK_SAMPLE_LIMIT);
  state.dirty.click = true;
  state.labelDirty = true;
};

const hideBox = () => {
  state.visible = false;
};

const animate = () => {
  const halfWidth = BOX_WIDTH / 2;
  const halfHeight = BOX_HEIGHT / 2;

  const left = Math.max(0, state.targetX - halfWidth);
  const right = Math.min(window.innerWidth, state.targetX + halfWidth);
  const top = Math.max(0, state.targetY - halfHeight);
  const bottom = Math.min(window.innerHeight, state.targetY + halfHeight);

  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);

  state.x = left + width / 2;
  state.y = top + height / 2;

  box.style.width = `${width}px`;
  box.style.height = `${height}px`;
  box.style.transform = `translate(${state.x}px, ${state.y}px) translate(-50%, -50%)`;
  box.classList.toggle("is-visible", state.visible);
  updateLabel();
  box.classList.toggle("is-left-edge", left <= 0 && width < label.scrollWidth + 12);

  requestAnimationFrame(animate);
};

window.addEventListener("pointermove", setTarget, { passive: true });
window.addEventListener("pointerdown", setTarget, { passive: true });
window.addEventListener("keydown", recordKeydown, { passive: true });
window.addEventListener("keyup", recordKeyup, { passive: true });
window.addEventListener("wheel", recordScroll, { passive: true });
window.addEventListener("click", recordClick, { passive: true });
debugOverrideToggle.addEventListener("click", () => {
  setDebugOverrideState(!state.debugOverride.enabled);
});

debugOverrideRange.addEventListener("input", (event) => {
  setDebugOverrideValue(Number(event.target.value));
});
document.documentElement.addEventListener("mouseleave", hideBox);
window.addEventListener("blur", hideBox);

setDebugOverrideValue(Number(debugOverrideRange.value));
setDebugOverrideState(false);
updateLabel();
animate();
