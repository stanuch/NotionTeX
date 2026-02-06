// CONFIGURATION
const ROOTS = [".notion-page-content", ".notion-frame", "main", "body"];
const HUD_Z = 2147483646;
const STORAGE_KEY = "notion-math-assistant-settings";

// Default delays (can be adjusted by user)
const DEFAULT_DELAY = {
  MENU_WAIT: 100,
  INPUT_WAIT: 50,
  TYPING: 10
};

// Delay presets for different computer speeds
const DELAY_PRESETS = {
  fast: { MENU_WAIT: 50, INPUT_WAIT: 25, TYPING: 5, label: "Fast", desc: "For fast computers" },
  normal: { MENU_WAIT: 100, INPUT_WAIT: 50, TYPING: 10, label: "Normal", desc: "Default speed" },
  slow: { MENU_WAIT: 200, INPUT_WAIT: 100, TYPING: 20, label: "Slow", desc: "For slower computers" },
  slower: { MENU_WAIT: 400, INPUT_WAIT: 200, TYPING: 40, label: "Very Slow", desc: "If you experience issues" }
};

// Load saved settings or use defaults
let DELAY = loadSettings();

function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_DELAY, ...parsed };
    }
  } catch (e) { }
  return { ...DEFAULT_DELAY };
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DELAY));
  } catch (e) { }
}

function applyPreset(presetName) {
  const preset = DELAY_PRESETS[presetName];
  if (preset) {
    DELAY.MENU_WAIT = preset.MENU_WAIT;
    DELAY.INPUT_WAIT = preset.INPUT_WAIT;
    DELAY.TYPING = preset.TYPING;
    saveSettings();
  }
}

let ignoredNodes = new WeakSet();
let settingsOpen = false;

// UTILITY FUNCTIONS
const sleep = ms => new Promise(r => setTimeout(r, ms));

const isEditable = el => !!el && (el.getAttribute("contenteditable") === "true" || el.isContentEditable);

const isCodeCtx = el => el.closest?.(".notion-code-block, pre, code");

function dispatchKey(el, key, code, keyCode) {
  const ev = new KeyboardEvent("keydown", {
    key: key, code: code, keyCode: keyCode, which: keyCode,
    bubbles: true, cancelable: true, view: window
  });
  el.dispatchEvent(ev);
}

function closeNotionDialog() {
  const buttons = document.querySelectorAll('.notion-overlay-container div[role="button"], .notion-overlay-container button');
  for (const btn of buttons) {
    if (btn.textContent === "Done" || btn.textContent === "Gotowe") {
      btn.click();
      return true;
    }
  }

  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
    dispatchKey(active, "Enter", "Enter", 13);
    return true;
  }

  document.body.click();
  return false;
}

// TEXT SCANNING - Finding LaTeX expressions in the document
function* textNodes(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.indexOf("$") === -1) return NodeFilter.FILTER_REJECT;
      if (ignoredNodes.has(n)) return NodeFilter.FILTER_REJECT;
      if (!n.parentElement) return NodeFilter.FILTER_REJECT;
      if (isCodeCtx(n.parentElement)) return NodeFilter.FILTER_REJECT;
      if (n.closest?.(".notion-equation, .katex")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let cur; while ((cur = w.nextNode())) yield cur;
}

function findDollarSpans(text) {
  const spans = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    let open = -1, dbl = false;

    for (let j = i; j < n; j++) {
      if (text[j] === "\\") { j++; continue; }
      if (text[j] === "$") {
        dbl = (j + 1 < n && text[j + 1] === "$");
        open = j;
        break;
      }
    }
    if (open === -1) break;

    const openLen = dbl ? 2 : 1;
    let k = open + openLen, close = -1;

    for (; k < n; k++) {
      if (text[k] === "\\") { k++; continue; }
      if (text[k] === "$") {
        if (dbl) {
          if (k + 1 < n && text[k + 1] === "$") { close = k + 2; break; }
        } else {
          close = k + 1;
          break;
        }
      }
    }

    if (close === -1) { i = open + 1; continue; }

    const innerStart = open + openLen;
    const innerEnd = close - (dbl ? 2 : 1);

    if (innerEnd >= innerStart) {
      spans.push({ open, innerStart, innerEnd, close, dbl });
    }

    i = close;
  }
  return spans;
}

// HUD
function makeHUD() {
  let hud = document.getElementById("eq-hud");
  if (hud) return hud;

  hud = document.createElement("div");
  hud.id = "eq-hud";
  Object.assign(hud.style, {
    position: "fixed", top: "16px", right: "16px",
    background: "rgba(30, 30, 30, 0.95)",
    color: "#fff",
    font: "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    borderRadius: "10px", zIndex: String(HUD_Z), pointerEvents: "none",
    boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.1)",
    minWidth: "280px", maxWidth: "400px", lineHeight: "1.5",
    backdropFilter: "blur(6px)"
  });
  document.documentElement.appendChild(hud);
  return hud;
}

function getCurrentPreset() {
  for (const [name, preset] of Object.entries(DELAY_PRESETS)) {
    if (DELAY.MENU_WAIT === preset.MENU_WAIT &&
      DELAY.INPUT_WAIT === preset.INPUT_WAIT &&
      DELAY.TYPING === preset.TYPING) {
      return name;
    }
  }
  return "custom";
}

function showSettings() {
  settingsOpen = true;
  const hud = makeHUD();
  hud.style.display = "block";
  hud.style.padding = "16px 20px";
  hud.style.pointerEvents = "auto";

  const currentPreset = getCurrentPreset();

  let presetsHTML = "";
  for (const [name, preset] of Object.entries(DELAY_PRESETS)) {
    const isActive = name === currentPreset;
    const activeStyle = isActive
      ? "background: #4ade80; color: #000; font-weight: 600;"
      : "background: rgba(255,255,255,0.1);";
    presetsHTML += `
      <button data-preset="${name}" style="
        ${activeStyle}
        border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer;
        font-size: 12px; transition: all 0.15s;
      " onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
        ${preset.label}
      </button>`;
  }

  hud.innerHTML = `
    <style>
      .eq-settings-input { 
        width: 60px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px; color: #fff; padding: 4px 8px; text-align: center; font-size: 12px;
      }
      .eq-settings-input:focus { outline: none; border-color: #4ade80; }
      .eq-settings-row { display: flex; justify-content: space-between; align-items: center; margin: 8px 0; }
      .eq-settings-label { font-size: 12px; color: #aaa; }
    </style>
    <div style="font-weight: 700; font-size: 15px; margin-bottom: 12px; color: #4ade80;">
      ⚙️ Speed Settings
    </div>
    <div style="font-size: 11px; color: #888; margin-bottom: 12px;">
      Adjust timing for your computer speed
    </div>
    <div style="display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap;">
      ${presetsHTML}
    </div>
    <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;">
      <div style="font-size: 11px; color: #888; margin-bottom: 8px;">Custom values (ms):</div>
      <div class="eq-settings-row">
        <span class="eq-settings-label">Menu Wait</span>
        <input type="number" class="eq-settings-input" id="eq-menu-wait" value="${DELAY.MENU_WAIT}" min="10" max="1000" step="10">
      </div>
      <div class="eq-settings-row">
        <span class="eq-settings-label">Input Wait</span>
        <input type="number" class="eq-settings-input" id="eq-input-wait" value="${DELAY.INPUT_WAIT}" min="10" max="500" step="10">
      </div>
      <div class="eq-settings-row">
        <span class="eq-settings-label">Typing</span>
        <input type="number" class="eq-settings-input" id="eq-typing" value="${DELAY.TYPING}" min="5" max="100" step="5">
      </div>
    </div>
    <div style="margin-top: 16px; display: flex; gap: 8px;">
      <button id="eq-save-settings" style="
        flex: 1; background: #4ade80; color: #000; border: none; padding: 8px; 
        border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;
      ">Save & Close</button>
      <button id="eq-cancel-settings" style="
        background: rgba(255,255,255,0.1); color: #fff; border: none; padding: 8px 16px;
        border-radius: 6px; cursor: pointer; font-size: 13px;
      ">Cancel</button>
    </div>
  `;

  // Add event listeners
  setTimeout(() => {
    // Preset buttons
    hud.querySelectorAll("[data-preset]").forEach(btn => {
      btn.addEventListener("click", () => {
        applyPreset(btn.dataset.preset);
        showSettings(); // Refresh UI
      });
    });

    // Save button
    document.getElementById("eq-save-settings")?.addEventListener("click", () => {
      DELAY.MENU_WAIT = parseInt(document.getElementById("eq-menu-wait")?.value) || 100;
      DELAY.INPUT_WAIT = parseInt(document.getElementById("eq-input-wait")?.value) || 50;
      DELAY.TYPING = parseInt(document.getElementById("eq-typing")?.value) || 10;
      saveSettings();
      settingsOpen = false;
      hud.style.pointerEvents = "none";
      if (guide && guide.items.length > 0) {
        // Just refresh the HUD without rescanning - stay on current equation
        const item = guide.items[guide.index];
        if (item) {
          const isBlock = item.span.dbl;
          updateHUD(guide.index, guide.items.length, isBlock, guide.autoMode);
        }
      } else {
        hideHUD();
      }
    });

    // Cancel button
    document.getElementById("eq-cancel-settings")?.addEventListener("click", () => {
      settingsOpen = false;
      hud.style.pointerEvents = "none";
      if (guide && guide.items.length > 0) {
        // Just refresh the HUD without rescanning - stay on current equation
        const item = guide.items[guide.index];
        if (item) {
          const isBlock = item.span.dbl;
          updateHUD(guide.index, guide.items.length, isBlock, guide.autoMode);
        }
      } else {
        hideHUD();
      }
    });

    // Input change handlers
    ["eq-menu-wait", "eq-input-wait", "eq-typing"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", (e) => {
        // Visual feedback that custom is selected
        hud.querySelectorAll("[data-preset]").forEach(btn => {
          btn.style.background = "rgba(255,255,255,0.1)";
          btn.style.color = "#fff";
          btn.style.fontWeight = "normal";
        });
      });
    });
  }, 0);
}

function updateHUD(current, total, isBlock, autoMode) {
  if (settingsOpen) return;

  const hud = makeHUD();
  hud.style.display = "block";
  hud.style.padding = "16px 20px";
  hud.style.pointerEvents = "none";

  const cmd = /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";
  const typeLabel = isBlock ? "Block Equation ($$)" : "Inline Equation ($)";
  const typeColor = isBlock ? "#60a5fa" : "#4ade80";

  // Get current speed preset name
  const currentPreset = getCurrentPreset();
  const speedLabel = currentPreset === "custom" ? "Custom" : DELAY_PRESETS[currentPreset]?.label || "Normal";

  let instruction = "";
  if (autoMode) {
    instruction = `<span style="color:#fbbf24; animation: pulse 0.5s infinite;">⚡ Auto-Running...</span>`;
  } else {
    instruction = `Press <b style="color:#fff; border-bottom:1px solid #aaa">${cmd}+Shift+E</b>`;
  }

  hud.innerHTML =
    `<style>@keyframes pulse { 0% {opacity:1;} 50% {opacity:0.5;} 100% {opacity:1;} }</style>` +
    `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:20px;">
       <span style="font-weight:700; font-size:15px; color:${typeColor}; white-space:nowrap;">${typeLabel}</span>
       <div style="display:flex; gap:8px; align-items:center;">
         <span style="font-size:10px; color:#888; background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px;">⚡${speedLabel}</span>
         <span style="font-size:12px; font-weight:600; opacity:0.9; background:rgba(255,255,255,0.15); padding:3px 10px; border-radius:12px; font-variant-numeric: tabular-nums;">
           ${current + 1} / ${total}
         </span>
       </div>
     </div>` +
    `<div style="font-size:13px; opacity:0.9; margin-bottom:6px;">${instruction}</div>` +
    `<div style="font-size:12px; color:#bbb; margin-top:10px; display:flex; gap:15px; font-weight:500;">
       <span><b style="color:#fff">A</b>: Auto</span> <span>➡ Skip</span> <span><b style="color:#fff">S</b>: Speed</span> <span>ESC: Exit</span>
     </div>`;
}

function showNotification(text, isError = false) {
  const hud = makeHUD();
  hud.style.display = "block";
  hud.style.padding = "12px 16px";
  const icon = isError ? "❗" : "ℹ️";
  hud.innerHTML =
    `<div style="display:flex; align-items:center; gap:12px; padding:2px 0;">
       <span style="font-size:22px; line-height:1;">${icon}</span>
       <span style="font-weight:600; font-size:14px; color:#fff;">${text}</span>
     </div>`;
  setTimeout(() => { if (!guide) hideHUD(); }, 2000);
}

const hideHUD = () => { const h = document.getElementById("eq-hud"); if (h) h.style.display = "none"; };

// VISUAL HIGHLIGHTING - Shows which equation is currently selected
function highlightSelection(range, color = "#4ade80") {
  let box = document.getElementById("eq-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "eq-box";
    Object.assign(box.style, {
      position: "fixed", borderRadius: "4px", zIndex: String(HUD_Z), pointerEvents: "none",
      transition: "all 0.1s cubic-bezier(0.4, 0, 0.2, 1)"
    });
    document.documentElement.appendChild(box);
  }

  const rects = range.getClientRects();
  if (!rects.length) { box.style.display = "none"; return; }

  const r = rects[0];
  Object.assign(box.style, {
    left: `${r.left - 4}px`, top: `${r.top - 2}px`,
    width: `${r.width + 8}px`, height: `${r.height + 4}px`, display: "block",
    border: `2px solid ${color}`, background: color + "26"
  });
}

const hideHighlight = () => { const b = document.getElementById("eq-box"); if (b) b.style.display = "none"; };

// DOM MANIPULATION - Text selection and editing
function focusEditableFrom(node) {
  let el = node.parentElement;
  while (el && !isEditable(el)) el = el.parentElement;
  if (el) { el.focus({ preventScroll: true }); return el; }
  return null;
}

function setSelectionInTextNode(node, start, end) {
  const sel = window.getSelection();
  const r = document.createRange();
  try {
    r.setStart(node, start);
    r.setEnd(node, end);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (e) { return null; }
  return r;
}

async function deleteSelection() {
  document.execCommand?.("delete");
  const a = document.activeElement;
  a?.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "deleteContent" }));
  await sleep(10);
}

// MACRO ENGINE - Automated equation insertion via slash commands
async function runMacro(latex, command) {
  document.execCommand("insertText", false, command);
  await sleep(DELAY.MENU_WAIT);

  let active = document.activeElement;
  dispatchKey(active, "Enter", "Enter", 13);
  await sleep(DELAY.INPUT_WAIT);

  active = document.activeElement;
  if (active) {
    document.execCommand("insertText", false, latex);
    await sleep(DELAY.TYPING);
    dispatchKey(active, "Enter", "Enter", 13);
    await sleep(50);
    return true;
  }
  return false;
}

// EQUATION COLLECTION - Finding all equations in the document
function collectItems() {
  const items = [];
  const roots = new Set();

  for (const s of ROOTS) document.querySelectorAll(s).forEach(n => roots.add(n));
  if (!roots.size) roots.add(document.body);

  const visitedNodes = new Set();
  for (const root of roots) {
    for (const tn of textNodes(root)) {
      if (visitedNodes.has(tn)) continue;
      visitedNodes.add(tn);
      const spans = findDollarSpans(tn.nodeValue);
      spans.forEach(span => items.push({ tn, span }));
    }
  }
  return items;
}

// GUIDE STATE - Tracks the conversion session
let guide = null;

function stopGuide() {
  if (!guide) return;
  hideHUD();
  hideHighlight();
  window.removeEventListener("keydown", onKey, true);
  if (guide.checker) clearInterval(guide.checker);
  guide = null;
  settingsOpen = false;
}

// MAIN CONVERSION LOGIC
async function goStep(delta) {
  if (!guide) return;

  if (guide.checker) clearInterval(guide.checker);

  const items = collectItems();
  guide.items = items;

  if (!items.length) {
    stopGuide();
    showNotification("All done!", false);
    return;
  }

  let i = guide.index + delta;
  if (i < 0) i = 0;
  if (i >= items.length) i = items.length - 1;

  guide.index = i;
  const item = items[i];
  const { tn, span } = item;

  if (!tn.isConnected || !focusEditableFrom(tn)) {
    guide.index = 0;
    setTimeout(() => goStep(0), 10);
    return;
  }

  item.span = span;
  const isBlock = span.dbl;

  // AUTO MODE - Fully automatic conversion
  if (guide.autoMode) {
    const r = setSelectionInTextNode(tn, span.open, span.close);
    if (!r) { setTimeout(() => goStep(1), 0); return; }

    const color = isBlock ? "#60a5fa" : "#4ade80";
    highlightSelection(r, color);
    updateHUD(guide.index, items.length, isBlock, true);
    await sleep(10);

    const latex = tn.nodeValue.substring(span.innerStart, span.innerEnd);

    await deleteSelection();
    const command = isBlock ? "/math" : "/inlinemath";
    const success = await runMacro(latex, command);

    if (success) {
      setTimeout(() => goStep(0), 10);
    } else {
      ignoredNodes.add(tn);
      setTimeout(() => goStep(0), 50);
    }
    return;
  }

  // MANUAL MODE - Strip $ signs upfront, restore on ESC if no conversion
  // Store info for potential restoration
  const latex = tn.nodeValue.substring(span.innerStart, span.innerEnd);
  const dollars = isBlock ? "$$" : "$";
  guide.pendingRestore = { tn, latex, dollars, converted: false };

  // Strip closing delimiter first (so positions stay valid)
  setSelectionInTextNode(tn, span.innerEnd, span.close);
  await deleteSelection();

  // Strip opening delimiter
  setSelectionInTextNode(tn, span.open, span.innerStart);
  await deleteSelection();

  // Select the inner LaTeX content
  const innerLen = span.innerEnd - span.innerStart;
  const rInner = setSelectionInTextNode(tn, span.open, span.open + innerLen);
  if (!rInner) { setTimeout(() => goStep(1), 0); return; }

  const color = isBlock ? "#60a5fa" : "#4ade80";
  highlightSelection(rInner, color);
  updateHUD(guide.index, items.length, isBlock, false);

  // Store original text to detect when user converts
  const originalText = tn.nodeValue;

  // Monitor for conversion
  guide.checker = setInterval(() => {
    if (!tn.isConnected) {
      clearInterval(guide.checker);
      guide.checker = null;
      guide.pendingRestore = null; // Conversion happened, no need to restore
      setTimeout(() => {
        closeNotionDialog();
        setTimeout(() => goStep(0), 20);
      }, 50);
      return;
    }

    if (tn.nodeValue !== originalText) {
      clearInterval(guide.checker);
      guide.checker = null;
      guide.pendingRestore = null; // Conversion happened
      setTimeout(() => {
        closeNotionDialog();
        setTimeout(() => goStep(0), 20);
      }, 50);
    }
  }, 50);
}

// KEYBOARD HANDLER
function onKey(e) {
  if (!guide) return;

  // Allow typing in settings inputs
  if (settingsOpen && (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON")) {
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    if (settingsOpen) {
      settingsOpen = false;
      goStep(0);
    } else {
      // Restore dollar signs if we stripped them but user didn't convert
      if (guide.pendingRestore && guide.pendingRestore.tn.isConnected) {
        const { latex, dollars } = guide.pendingRestore;
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          document.execCommand("insertText", false, dollars + latex + dollars);
        }
      }
      stopGuide();
    }
  }
  else if ((e.key === "s" || e.key === "S") && !settingsOpen) {
    e.preventDefault();
    showSettings();
  }
  else if (e.key === "a" || e.key === "A") {
    if (settingsOpen) return;
    e.preventDefault();

    // Clear any checker since we're switching modes
    if (guide.checker) clearInterval(guide.checker);

    // Restore dollar signs if we stripped them in manual mode
    if (guide.pendingRestore && guide.pendingRestore.tn.isConnected && !guide.autoMode) {
      const { latex, dollars } = guide.pendingRestore;
      const sel = window.getSelection();
      if (sel.rangeCount > 0) {
        document.execCommand("insertText", false, dollars + latex + dollars);
      }
    }
    guide.pendingRestore = null;

    guide.autoMode = !guide.autoMode;
    setTimeout(() => goStep(0), 50);
  }
  else if (e.key === "ArrowRight") {
    if (settingsOpen) return;
    e.preventDefault();

    // Restore dollar signs before skipping
    if (guide.pendingRestore && guide.pendingRestore.tn.isConnected) {
      const { latex, dollars } = guide.pendingRestore;
      const sel = window.getSelection();
      if (sel.rangeCount > 0) {
        document.execCommand("insertText", false, dollars + latex + dollars);
      }
    }
    guide.pendingRestore = null;

    const item = guide.items[guide.index];
    if (item?.tn) ignoredNodes.add(item.tn);
    setTimeout(() => goStep(0), 10);
  }
  else if (e.key === "Enter" && !guide.autoMode) {
    if (settingsOpen) return;
    e.preventDefault();
    if (guide.checker) clearInterval(guide.checker);
    closeNotionDialog();
    setTimeout(() => goStep(0), 50);
  }
}

// ENTRY POINT
async function runGuided() {
  ignoredNodes = new WeakSet();

  const items = collectItems();
  if (!items.length) {
    showNotification("No equations found", true);
    return;
  }

  guide = { items, index: 0, checker: null, autoMode: false };

  window.addEventListener("keydown", onKey, true);

  await goStep(0);
}

chrome.runtime.onMessage.addListener(m => {
  if (m?.t === "RUN_CONVERT") runGuided();
});