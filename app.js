(() => {
  "use strict";

  const controls = ["left", "down", "right", "up", "lp", "mp", "hp", "p4", "lk", "mk", "hk", "k4"];
  const labels = {
    left: "左", down: "下", right: "右", up: "上",
    lp: "轻拳", mp: "中拳", hp: "重拳", p4: "P4",
    lk: "轻脚", mk: "中脚", hk: "重脚", k4: "K4"
  };
  const shortLabels = {
    left: "←", down: "↓", right: "→", up: "↑",
    lp: "LP", mp: "MP", hp: "HP", p4: "P4",
    lk: "LK", mk: "MK", hk: "HK", k4: "K4"
  };
  const keyboardMap = {
    KeyA: "left", KeyS: "down", KeyD: "right", Space: "up",
    KeyU: "lp", KeyI: "mp", KeyO: "hp", KeyP: "p4",
    KeyJ: "lk", KeyK: "mk", KeyL: "hk", Semicolon: "k4"
  };
  const defaultMapping = {
    left: { type: "button", index: 14 }, down: { type: "button", index: 13 },
    right: { type: "button", index: 15 }, up: { type: "button", index: 12 },
    lp: { type: "button", index: 2 }, mp: { type: "button", index: 3 },
    hp: { type: "button", index: 5 }, p4: { type: "button", index: 4 },
    lk: { type: "button", index: 0 }, mk: { type: "button", index: 1 },
    hk: { type: "button", index: 7 }, k4: { type: "button", index: 6 }
  };

  const els = {
    connectionBadge: document.getElementById("connectionBadge"),
    connectionText: document.getElementById("connectionText"),
    gamepadSelect: document.getElementById("gamepadSelect"),
    scanButton: document.getElementById("scanButton"),
    mapButton: document.getElementById("mapButton"),
    resetButton: document.getElementById("resetButton"),
    testedCount: document.getElementById("testedCount"),
    completionBar: document.getElementById("completionBar"),
    liveReadout: document.getElementById("liveReadout"),
    currentInput: document.getElementById("currentInput"),
    holdTime: document.getElementById("holdTime"),
    socdState: document.getElementById("socdState"),
    signalState: document.getElementById("signalState"),
    signalDetail: document.getElementById("signalDetail"),
    historyList: document.getElementById("historyList"),
    pauseButton: document.getElementById("pauseButton"),
    clearHistoryButton: document.getElementById("clearHistoryButton"),
    mappingDialog: document.getElementById("mappingDialog"),
    mappingTarget: document.getElementById("mappingTarget"),
    mappingHint: document.getElementById("mappingHint"),
    mappingProgressBar: document.getElementById("mappingProgressBar"),
    mappingSteps: document.getElementById("mappingSteps"),
    closeMappingButton: document.getElementById("closeMappingButton"),
    restoreMappingButton: document.getElementById("restoreMappingButton"),
    skipMappingButton: document.getElementById("skipMappingButton"),
    toast: document.getElementById("toast")
  };

  const state = {
    active: Object.fromEntries(controls.map(key => [key, false])),
    pressedAt: Object.fromEntries(controls.map(key => [key, 0])),
    counts: Object.fromEntries(controls.map(key => [key, 0])),
    tested: new Set(),
    history: [],
    paused: false,
    selectedGamepad: "keyboard",
    mapping: loadMapping(),
    mappingIndex: -1,
    mappingDraft: null,
    mappingBaseline: [],
    lastFrame: performance.now(),
    frameSamples: [],
    toastTimer: null
  };

  const nodes = Object.fromEntries(controls.map(key => [key, document.querySelector(`[data-control="${key}"]`)]));

  function loadMapping() {
    try {
      const saved = JSON.parse(localStorage.getItem("hitbox-mapping-v1"));
      if (saved && controls.every(key => saved[key])) return saved;
    } catch (_) {}
    return structuredClone(defaultMapping);
  }

  function saveMapping() {
    localStorage.setItem("hitbox-mapping-v1", JSON.stringify(state.mapping));
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function getGamepads() {
    if (!navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads()).filter(Boolean);
  }

  function refreshDevices(preferLatest = false) {
    const pads = getGamepads();
    const previous = state.selectedGamepad;
    els.gamepadSelect.replaceChildren(new Option("键盘模拟", "keyboard"));
    pads.forEach(pad => {
      const name = pad.id.length > 52 ? `${pad.id.slice(0, 49)}…` : pad.id;
      els.gamepadSelect.add(new Option(`${name} · ${pad.buttons.length} 键`, String(pad.index)));
    });

    const available = pads.map(pad => String(pad.index));
    if (available.includes(previous)) state.selectedGamepad = previous;
    else if (preferLatest && pads.length) state.selectedGamepad = String(pads[pads.length - 1].index);
    else if (pads.length) state.selectedGamepad = String(pads[0].index);
    else state.selectedGamepad = "keyboard";

    els.gamepadSelect.value = state.selectedGamepad;
    updateConnection();
  }

  function updateConnection() {
    const pad = currentPad();
    const connected = Boolean(pad);
    els.connectionBadge.classList.toggle("connected", connected);
    els.connectionText.textContent = connected ? "控制器已连接" : "键盘模式";
    els.signalState.textContent = connected ? "在线" : "待机";
    els.signalDetail.textContent = connected ? `${pad.buttons.length} 个按钮 · ${pad.axes.length} 个轴` : "等待设备输入";
    els.mapButton.disabled = !connected;
  }

  function currentPad() {
    if (state.selectedGamepad === "keyboard") return null;
    return getGamepads().find(pad => String(pad.index) === state.selectedGamepad) || null;
  }

  function isBindingActive(pad, binding) {
    if (!binding || !pad) return false;
    if (binding.type === "button") return Boolean(pad.buttons[binding.index]?.pressed || pad.buttons[binding.index]?.value > 0.55);
    if (binding.type === "axis") {
      const value = pad.axes[binding.index] || 0;
      return binding.direction < 0 ? value < -0.55 : value > 0.55;
    }
    return false;
  }

  function pollGamepad(now) {
    const pad = currentPad();
    if (!pad) return;

    if (state.mappingIndex >= 0) {
      pollMapping(pad);
      return;
    }

    controls.forEach(control => setControl(control, isBindingActive(pad, state.mapping[control]), now, "手柄"));
  }

  function setControl(control, nextActive, now = performance.now(), source = "输入") {
    const wasActive = state.active[control];
    if (wasActive === nextActive) return;
    state.active[control] = nextActive;

    if (nextActive) {
      state.pressedAt[control] = now;
      state.counts[control] += 1;
      state.tested.add(control);
      addHistory("down", control, now, source);
    } else {
      const duration = Math.max(0, now - state.pressedAt[control]);
      addHistory("up", control, now, source, duration);
      state.pressedAt[control] = 0;
    }
    renderNode(control, now);
    renderSummary(now);
  }

  function renderNode(control, now) {
    const node = nodes[control];
    const active = state.active[control];
    const held = active ? now - state.pressedAt[control] : 0;
    node.classList.toggle("active", active);
    node.classList.toggle("stuck", held > 1500);
    node.querySelector(".node-meta").textContent = String(state.counts[control]);
    node.setAttribute("aria-label", `${labels[control]}，触发 ${state.counts[control]} 次${active ? "，正在按下" : ""}`);
  }

  function renderSummary(now) {
    const active = controls.filter(control => state.active[control]);
    els.currentInput.textContent = active.length ? active.map(control => shortLabels[control]).join(" + ") : "—";
    els.liveReadout.textContent = active.length ? active.map(control => shortLabels[control]).join("  ") : "没有输入";

    if (active.length) {
      const longest = Math.max(...active.map(control => now - state.pressedAt[control]));
      els.holdTime.textContent = `最长按住 ${formatDuration(longest)}`;
    } else {
      els.holdTime.textContent = "等待输入";
    }

    const horizontal = state.active.left && state.active.right;
    const vertical = state.active.up && state.active.down;
    const socdMetric = els.socdState.closest(".metric");
    if (horizontal && vertical) els.socdState.textContent = "← + → / ↑ + ↓ → 中立";
    else if (horizontal) els.socdState.textContent = "← + → → 中立";
    else if (vertical) els.socdState.textContent = "↑ + ↓ → 中立";
    else els.socdState.textContent = "无冲突";
    socdMetric.classList.toggle("alert", horizontal || vertical);

    els.testedCount.textContent = `${state.tested.size} / ${controls.length}`;
    els.completionBar.style.width = `${state.tested.size / controls.length * 100}%`;

    if (active.length) {
      els.signalState.textContent = active.some(control => now - state.pressedAt[control] > 1500) ? "持续按下" : "输入正常";
      els.signalDetail.textContent = `${active.length} 个信号正在触发`;
    } else {
      updateConnection();
    }
  }

  function formatDuration(ms) {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
  }

  function addHistory(type, control, now, source, duration = 0) {
    if (state.paused) return;

    if (type === "down") {
      const last = state.history[0];
      if (last && last.type === "press" && now - last.time < 55) {
        last.controls.push(control);
        renderHistory();
        return;
      }
      state.history.unshift({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, type: "press", controls: [control], time: now, wallTime: new Date(), source, duration: null });
    } else {
      const press = state.history.find(item => item.type === "press" && item.controls.includes(control) && item.duration == null);
      if (press) {
        press.released = press.released || [];
        press.released.push(control);
        press.durations = press.durations || [];
        press.durations.push(duration);
        if (press.released.length >= press.controls.length) press.duration = Math.max(...press.durations);
      }
    }

    state.history = state.history.slice(0, 30);
    renderHistory();
  }

  function renderHistory() {
    els.historyList.replaceChildren();
    if (!state.history.length) {
      const empty = document.createElement("li");
      empty.className = "empty-history";
      empty.textContent = "按下任意键后，输入会出现在这里。";
      els.historyList.append(empty);
      return;
    }

    state.history.forEach(item => {
      const li = document.createElement("li");
      li.className = "history-item";
      const time = document.createElement("time");
      time.className = "history-time";
      time.dateTime = item.wallTime.toISOString();
      time.textContent = item.wallTime.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const keys = document.createElement("div");
      keys.className = "history-keys";
      item.controls.forEach(control => {
        const chip = document.createElement("span");
        chip.className = `key-chip ${["left", "right", "up", "down"].includes(control) ? "direction-chip" : ""}`;
        chip.textContent = shortLabels[control];
        chip.setAttribute("aria-label", labels[control]);
        keys.append(chip);
      });
      const duration = document.createElement("span");
      duration.className = "history-duration";
      duration.textContent = item.duration == null ? "按住中" : formatDuration(item.duration);
      li.append(time, keys, duration);
      els.historyList.append(li);
    });
  }

  function openMapping() {
    const pad = currentPad();
    if (!pad) return showToast("请先连接并选择 Hit Box");
    state.mappingDraft = structuredClone(state.mapping);
    state.mappingIndex = 0;
    state.mappingBaseline = captureRawPad(pad);
    renderMapping();
    els.mappingDialog.showModal();
  }

  function captureRawPad(pad) {
    return {
      buttons: pad.buttons.map(button => button.pressed || button.value > .55),
      axes: pad.axes.map(value => Math.abs(value) > .55 ? Math.sign(value) : 0)
    };
  }

  function pollMapping(pad) {
    const baseline = state.mappingBaseline;
    for (let i = 0; i < pad.buttons.length; i += 1) {
      const pressed = pad.buttons[i].pressed || pad.buttons[i].value > .55;
      if (pressed && !baseline.buttons[i]) return acceptMapping({ type: "button", index: i }, pad);
    }
    for (let i = 0; i < pad.axes.length; i += 1) {
      const direction = Math.abs(pad.axes[i]) > .7 ? Math.sign(pad.axes[i]) : 0;
      if (direction && direction !== baseline.axes[i]) return acceptMapping({ type: "axis", index: i, direction }, pad);
    }
  }

  function acceptMapping(binding, pad) {
    const control = controls[state.mappingIndex];
    state.mappingDraft[control] = binding;
    state.mappingIndex += 1;
    state.mappingBaseline = captureRawPad(pad);
    if (state.mappingIndex >= controls.length) finishMapping();
    else renderMapping();
  }

  function renderMapping() {
    const control = controls[state.mappingIndex];
    els.mappingTarget.textContent = labels[control];
    els.mappingHint.textContent = `第 ${state.mappingIndex + 1} / ${controls.length} 项 · 等待手柄输入…`;
    els.mappingProgressBar.style.width = `${state.mappingIndex / controls.length * 100}%`;
    els.mappingSteps.replaceChildren(...controls.map((_, index) => {
      const step = document.createElement("span");
      step.className = `mapping-step${index < state.mappingIndex ? " done" : index === state.mappingIndex ? " current" : ""}`;
      return step;
    }));
  }

  function finishMapping() {
    state.mapping = state.mappingDraft;
    saveMapping();
    state.mappingIndex = -1;
    state.mappingDraft = null;
    els.mappingProgressBar.style.width = "100%";
    els.mappingDialog.close("complete");
    showToast("校准完成，映射已保存在此浏览器");
    updateBindingLabels();
  }

  function cancelMapping() {
    state.mappingIndex = -1;
    state.mappingDraft = null;
  }

  function updateBindingLabels() {
    if (state.selectedGamepad === "keyboard") {
      const keys = { left: "A", down: "S", right: "D", up: "空格", lp: "U", mp: "I", hp: "O", p4: "P", lk: "J", mk: "K", hk: "L", k4: ";" };
      controls.forEach(control => nodes[control].querySelector(".node-meta").textContent = state.counts[control] || keys[control]);
      return;
    }
    controls.forEach(control => {
      const binding = state.mapping[control];
      nodes[control].querySelector(".node-meta").textContent = state.counts[control] || (binding.type === "button" ? `B${binding.index}` : `A${binding.index}`);
    });
  }

  function resetStats() {
    controls.forEach(control => {
      state.counts[control] = 0;
      state.active[control] = false;
      state.pressedAt[control] = 0;
      nodes[control].classList.remove("active", "stuck");
    });
    state.tested.clear();
    state.history = [];
    renderHistory();
    renderSummary(performance.now());
    updateBindingLabels();
    showToast("本次检测统计已重置");
  }

  function onKey(event, active) {
    if (els.mappingDialog.open) return;
    const control = keyboardMap[event.code];
    if (!control) return;
    event.preventDefault();
    if (event.repeat) return;
    setControl(control, active, performance.now(), "键盘");
  }

  function tick(now) {
    pollGamepad(now);
    controls.forEach(control => {
      if (state.active[control]) renderNode(control, now);
    });
    if (controls.some(control => state.active[control])) renderSummary(now);

    const delta = now - state.lastFrame;
    state.lastFrame = now;
    state.frameSamples.push(delta);
    if (state.frameSamples.length > 60) state.frameSamples.shift();
    requestAnimationFrame(tick);
  }

  window.addEventListener("gamepadconnected", () => {
    refreshDevices(true);
    showToast("检测到控制器，可以开始测试");
  });
  window.addEventListener("gamepaddisconnected", () => {
    refreshDevices();
    showToast("控制器已断开");
  });
  window.addEventListener("keydown", event => onKey(event, true));
  window.addEventListener("keyup", event => onKey(event, false));
  window.addEventListener("blur", () => controls.forEach(control => state.active[control] && setControl(control, false)));

  els.gamepadSelect.addEventListener("change", () => {
    controls.forEach(control => state.active[control] && setControl(control, false));
    state.selectedGamepad = els.gamepadSelect.value;
    updateConnection();
    updateBindingLabels();
  });
  els.scanButton.addEventListener("click", () => {
    refreshDevices();
    showToast(getGamepads().length ? `发现 ${getGamepads().length} 个控制器` : "未发现控制器，请按一下 Hit Box 按键后重试");
  });
  els.mapButton.addEventListener("click", openMapping);
  els.resetButton.addEventListener("click", resetStats);
  els.clearHistoryButton.addEventListener("click", () => { state.history = []; renderHistory(); });
  els.pauseButton.addEventListener("click", () => {
    state.paused = !state.paused;
    els.pauseButton.textContent = state.paused ? "▶" : "Ⅱ";
    els.pauseButton.setAttribute("aria-label", state.paused ? "继续记录" : "暂停记录");
    els.pauseButton.title = state.paused ? "继续记录" : "暂停记录";
    showToast(state.paused ? "输入记录已暂停" : "输入记录已继续");
  });
  els.closeMappingButton.addEventListener("click", cancelMapping);
  els.mappingDialog.addEventListener("cancel", cancelMapping);
  els.mappingDialog.addEventListener("close", () => {
    if (state.mappingIndex >= 0) cancelMapping();
  });
  els.skipMappingButton.addEventListener("click", () => {
    const pad = currentPad();
    if (!pad) return;
    state.mappingIndex += 1;
    state.mappingBaseline = captureRawPad(pad);
    if (state.mappingIndex >= controls.length) finishMapping();
    else renderMapping();
  });
  els.restoreMappingButton.addEventListener("click", () => {
    state.mappingDraft = structuredClone(defaultMapping);
    state.mappingIndex = 0;
    state.mappingBaseline = captureRawPad(currentPad());
    renderMapping();
    showToast("已载入默认映射，请继续确认每个键");
  });

  if (!navigator.getGamepads) {
    els.connectionText.textContent = "浏览器不支持手柄检测";
    els.scanButton.disabled = true;
    els.mapButton.disabled = true;
  }

  refreshDevices();
  updateBindingLabels();
  renderSummary(performance.now());
  requestAnimationFrame(tick);
})();
