// ===== CONFIGURATION =====
const ROOTS = [".notion-page-content", ".notion-frame", "main", "body"];
const HUD_Z = 2147483646;
console.log("[NotionTeX] Content script loaded");

// Maximum wait times for DOM-based waiting (replaces fixed sleep delays)
const TIMEOUTS = {
  MENU: 5000,       // Wait for Notion slash menu to appear
  INPUT: 5000,      // Wait for equation input field to appear
  EQUATION: 3000,   // Wait for equation element after submit
  UNDO_STEP: 50,    // Delay between undo operations
  POLL: 50,         // Polling interval for DOM checks
};

let ignoredNodes = new WeakSet();

// ===== CONVERSION LOG =====
let conversionLog = [];

function logConversion(original, latex, type, status, detail = "") {
  conversionLog.push({ timestamp: Date.now(), original, latex, type, status, detail });
}

// ===== UTILITY FUNCTIONS =====
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForCondition(conditionFn, timeout = 5000, pollInterval = 20) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (conditionFn()) return true;
    await sleep(pollInterval);
  }
  return false;
}

const isEditable = el =>
  !!el && (el.getAttribute("contenteditable") === "true" || el.isContentEditable);

const isCodeCtx = el => el.closest?.(".notion-code-block, pre, code");

function dispatchKey(el, key, code, keyCode, options = {}) {
  const ev = new KeyboardEvent("keydown", {
    key, code, keyCode, which: keyCode,
    bubbles: true, cancelable: true, view: window,
    ...options
  });
  el.dispatchEvent(ev);
}

// --- DOM-based waiting (replaces all sleep(DELAY.*) calls) ---

/**
 * Wait for an element matching `selector` to appear in the DOM.
 * Uses MutationObserver for efficiency instead of polling.
 * Returns the element or null on timeout.
 */
async function waitForElement(selector, timeout = 5000) {
  return new Promise(resolve => {
    const existing = document.querySelector(selector);
    if (existing) { resolve(existing); return; }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

/**
 * Wait for document.activeElement to change from `prev`.
 * Used to detect when Notion opens the equation input field.
 */
async function waitForActiveElementChange(prev, timeout = 5000) {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      const active = document.activeElement;
      if (active !== prev && active !== document.body) {
        resolve(active);
        return;
      }
      if (Date.now() - start > timeout) { resolve(null); return; }
      requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Wait for a new child to appear in the Notion overlay container.
 * This is a broader check for when specific menu selectors are unknown.
 */
async function waitForNewOverlay(timeout = 5000, extInitialCount = null) {
  const container = document.querySelector(".notion-overlay-container");
  const initialCount = extInitialCount !== null ? extInitialCount : (container ? container.children.length : 0);

  return new Promise(resolve => {
    const check = () => {
      const c = document.querySelector(".notion-overlay-container");
      if (c && c.children.length > initialCount) return true;
      return false;
    };
    if (check()) { resolve(true); return; }

    const observer = new MutationObserver(() => {
      if (check()) { observer.disconnect(); resolve(true); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(false); }, timeout);
  });
}

/**
 * Rollback operations using Ctrl+Z (undo).
 * Undoes `count` operations to restore the document to its previous state.
 */
async function undoOperations(count = 10) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  for (let i = 0; i < count; i++) {
    // Prefer Notion's native React undo stack to prevent markdown parser bugs
    const ev = new KeyboardEvent("keydown", {
      key: "z", code: "KeyZ", keyCode: 90, which: 90,
      ctrlKey: !isMac, metaKey: isMac,
      bubbles: true, cancelable: true, view: window
    });
    const canceled = !document.activeElement.dispatchEvent(ev);
    if (!canceled) {
      document.execCommand("undo");
    }
    await sleep(TIMEOUTS.UNDO_STEP);
  }
}

// ===== CONTEXT CAPTURE (punctuation protection) =====

/**
 * Captures the surrounding context of an equation before conversion.
 * Used to verify that adjacent punctuation is preserved after conversion.
 */
function captureContext(tn, span) {
  return {
    fullText: tn.nodeValue,
    charBefore: span.open > 0 ? tn.nodeValue.charAt(span.open - 1) : null,
    charAfter: span.close < tn.nodeValue.length ? tn.nodeValue.charAt(span.close) : null,
    latex: tn.nodeValue.substring(span.innerStart, span.innerEnd),
    original: tn.nodeValue.substring(span.open, span.close),
    isBlock: span.dbl,
  };
}

function triggerInlineMath(el) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const ev = new KeyboardEvent("keydown", {
    key: "e", code: "KeyE", keyCode: 69, which: 69,
    ctrlKey: !isMac, metaKey: isMac, shiftKey: true,
    bubbles: true, cancelable: true, view: window
  });
  el.dispatchEvent(ev);
}

async function closeNotionDialog(isBlock) {
  const buttons = document.querySelectorAll(
    '.notion-overlay-container div[role="button"], .notion-overlay-container button'
  );
  for (const btn of buttons) {
    if (btn.textContent === "Done" || btn.textContent === "Gotowe") {
      btn.click();
      return true;
    }
  }

  const active = document.activeElement;
  if (isBlock && active) {
    const prevActive = document.activeElement;
    dispatchKey(active, "Escape", "Escape", 27);

    // Wait dynamically for focus to leave the equation input
    await waitForCondition(() => document.activeElement !== prevActive, 3000);

    // Press Escape again to clear the block selection (blue outline)
    // This prevents Notion from locking its internal focus on the closed block
    dispatchKey(document.activeElement, "Escape", "Escape", 27);
    await sleep(20);
    return true;
  }

  if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) {
    dispatchKey(active, "Enter", "Enter", 13);
    return true;
  }

  // Do not click document.body here, as it removes focus from the editor 
  // and breaks React's state synchronization for the next equation.
  return false;
}

// ===== TEXT SCANNING =====
// (unchanged — finding LaTeX expressions in the document)

function* textNodes(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.indexOf("$") === -1) return NodeFilter.FILTER_REJECT;
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

    if (close === -1) { i = open + (dbl ? 2 : 1); continue; }

    const innerStart = open + openLen;
    const innerEnd = close - (dbl ? 2 : 1);

    if (innerEnd >= innerStart) {
      const latex = text.substring(innerStart, innerEnd);
      if (latex.trim().length > 0) {
        spans.push({ open, innerStart, innerEnd, close, dbl });
      }
    }

    i = close;
  }
  return spans;
}

// ===== EQUATION COLLECTION =====

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

// ===== DOM MANIPULATION =====

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
  a?.dispatchEvent(new InputEvent("input", {
    bubbles: true, cancelable: true, inputType: "deleteContent"
  }));
  await sleep(10);
}

// ===== VISUAL HIGHLIGHTING =====

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

const hideHighlight = () => {
  const b = document.getElementById("eq-box"); if (b) b.style.display = "none";
};

// ===== HUD =====

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

function updateHUD(current, total, isBlock, autoMode) {
  const hud = makeHUD();
  hud.style.display = "block";
  hud.style.padding = "16px 20px";
  hud.style.pointerEvents = "none";

  const cmd = /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";
  const typeLabel = isBlock ? "Block Equation ($$)" : "Inline Equation ($)";
  const typeColor = isBlock ? "#60a5fa" : "#4ade80";

  // Stats from conversion log
  const successCount = conversionLog.filter(l => l.status === "success").length;
  const failCount = conversionLog.filter(l => l.status === "rollback").length;
  let statsHTML = "";
  if (successCount > 0 || failCount > 0) {
    statsHTML = `<span style="font-size:10px; color:#888; background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px;">` +
      `✅${successCount}` + (failCount > 0 ? ` ⚠️${failCount}` : "") + `</span>`;
  }

  let instruction = "";
  if (autoMode) {
    instruction = `<span style="color:#fbbf24; animation: pulse 0.5s infinite;">⚡ Auto-Running...</span>`;
  } else {
    instruction = `Press <b style="color:#fff; border-bottom:1px solid #aaa">C</b> to convert`;
  }

  hud.innerHTML =
    `<style>@keyframes pulse { 0% {opacity:1;} 50% {opacity:0.5;} 100% {opacity:1;} }</style>` +
    `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:20px;">
       <span style="font-weight:700; font-size:15px; color:${typeColor}; white-space:nowrap;">${typeLabel}</span>
       <div style="display:flex; gap:8px; align-items:center;">
         ${statsHTML}
         <span style="font-size:12px; font-weight:600; opacity:0.9; background:rgba(255,255,255,0.15); padding:3px 10px; border-radius:12px; font-variant-numeric: tabular-nums;">
           ${total - current} eq left
         </span>
       </div>
     </div>` +
    `<div style="font-size:13px; opacity:0.9; margin-bottom:6px;">${instruction}</div>` +
    `<div style="font-size:12px; color:#bbb; margin-top:10px; display:flex; gap:15px; font-weight:500;">
       <span><b style="color:#fff">C</b>: Convert</span> <span><b style="color:#fff">A</b>: Auto</span> <span>➡ Skip</span> <span>ESC: Exit</span>
     </div>`;
}

function showNotification(text, isError = false) {
  const hud = makeHUD();
  hud.style.display = "block";
  hud.style.padding = "12px 16px";
  hud.style.pointerEvents = isError ? "auto" : "none";
  const icon = isError ? "❗" : "ℹ️";
  hud.innerHTML =
    `<div style="display:flex; align-items:center; gap:12px; padding:2px 0;">
       <span style="font-size:22px; line-height:1;">${icon}</span>
       <span style="font-weight:600; font-size:14px; color:#fff;">${text}</span>
     </div>`;
  setTimeout(() => { if (!guide) hideHUD(); }, 2000);
}

function showConversionReport() {
  const hud = makeHUD();
  hud.style.display = "block";
  hud.style.padding = "16px 20px";
  hud.style.pointerEvents = "none";

  const success = conversionLog.filter(l => l.status === "success").length;
  const skipped = conversionLog.filter(l => l.status === "skipped").length;
  const rolled = conversionLog.filter(l => l.status === "rollback");

  let rolledHTML = "";
  if (rolled.length > 0) {
    const details = rolled.map(r =>
      `<div style="font-size:11px; color:#fca5a5; margin-top:4px; word-break:break-all;">
         <code style="background:rgba(255,255,255,0.08); padding:1px 4px; border-radius:3px;">${r.original}</code>
         <span style="color:#888;"> — ${r.detail}</span>
       </div>`
    ).join("");
    rolledHTML = `<div style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;">
      <div style="font-size:11px; color:#fca5a5; font-weight:600;">Failed equations:</div>
      ${details}
    </div>`;
  }

  const allGood = rolled.length === 0;
  const titleColor = allGood ? "#4ade80" : "#fbbf24";
  const titleIcon = allGood ? "✅" : "⚠️";

  hud.innerHTML =
    `<div style="font-weight:700; font-size:15px; color:${titleColor}; margin-bottom:10px;">
       ${titleIcon} Conversion Complete
     </div>
     <div style="display:flex; gap:16px; font-size:13px; margin-bottom:4px;">
       <span style="color:#4ade80;">✅ Converted: ${success}</span>
       <span style="color:#888;">⏭ Skipped: ${skipped}</span>
       ${rolled.length > 0 ? `<span style="color:#fca5a5;">⚠️ Rolled back: ${rolled.length}</span>` : ""}
     </div>
     ${rolledHTML}`;

  setTimeout(hideHUD, rolled.length > 0 ? 8000 : 3000);
}

const hideHUD = () => {
  const h = document.getElementById("eq-hud"); if (h) h.style.display = "none";
};

// ===== CONVERSION LOGIC =====

/**
 * Core conversion function. Replaces the old runMacro().
 * Handles the full lifecycle: select → delete → slash command → verify.
 * All operations are tracked for undo-based rollback on failure.
 *
 * @param {Node} tn - The text node containing the equation
 * @param {object} span - The span object from findDollarSpans
 * @returns {{ success: boolean, reason?: string }}
 */
async function convertEquation(tn, span) {
  const latex = tn.nodeValue.substring(span.innerStart, span.innerEnd);
  const isBlock = span.dbl;
  const command = isBlock ? "/math" : "/inlinemath";
  let inputField = null;
  let insertedSpace = false;
  let undoCount = 0;
  let pivotUndoCount = 0;

  // Helper to force Notion's React state to recognize the block as active
  function activateNode(node) {
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
    const mouseup = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
    node.dispatchEvent(mousedown);
    node.dispatchEvent(mouseup);

    let ceNode = node;
    while (ceNode && !ceNode.isContentEditable) {
      ceNode = ceNode.parentElement;
    }
    if (ceNode) ceNode.focus();
  }

  if (!isBlock) {
    // INLINE MATH: Wrap selection with Ctrl+Shift+E, then overwrite
    activateNode(tn.parentElement);
    const r = setSelectionInTextNode(tn, span.open, span.close);
    if (!r) return { success: false, reason: "selection_failed" };

    const prevActive = document.activeElement;
    triggerInlineMath(prevActive);

    inputField = await waitForActiveElementChange(prevActive, TIMEOUTS.INPUT);
    if (!inputField) {
      await undoOperations(1);
      return { success: false, reason: "input_timeout" };
    }

    // Select all inside the equation editor to overwrite the original text (including $)
    inputField.focus();
    if (typeof inputField.select === "function") inputField.select();
    document.execCommand("selectAll");
    await sleep(20);

    document.execCommand("insertText", false, latex);
    undoCount++;

    await sleep(50);
    dispatchKey(inputField, "Enter", "Enter", 13);
    await sleep(50);

  } else {
    // BLOCK MATH

    activateNode(tn.parentElement);
    await waitForCondition(() => document.activeElement && document.activeElement.contains(tn.parentElement), 2000);
    await sleep(20); // Wait for React to complete its async focus-restore

    // Dispatch a harmless key to wake up Notion's event listeners
    dispatchKey(document.activeElement, "Shift", "ShiftLeft", 16);
    await sleep(10);

    const r = setSelectionInTextNode(tn, span.open, span.close);
    if (!r) return { success: false, reason: "selection_failed" };

    // Force React to recognize the new native DOM selection
    document.dispatchEvent(new Event("selectionchange"));
    if (tn.parentElement) {
      tn.parentElement.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    }
    await sleep(30); // Wait for React to digest the selection change

    let prefix = "/";
    if (span.open > 0) {
      // First explicitly delete the selected $$...$$ so Notion's native DOM state updates
      document.execCommand("delete");
      await sleep(40);
      
      // Now press Enter to split the block. This moves the cursor to a fresh line perfectly ready for '/'.
      dispatchKey(document.activeElement, "Enter", "Enter", 13);
      await sleep(150);
      undoCount += 2; // delete, then enter
    }

    const initialOverlays = document.querySelectorAll('.notion-overlay-container').length;

    // OVERWRITE the original equation directly with the slash trigger.
    document.execCommand("insertText", false, prefix);
    undoCount++;

    // Wait for the slash menu to actually open!
    const menuAppeared = await waitForNewOverlay(TIMEOUTS.MENU, initialOverlays);
    if (!menuAppeared) {
      await undoOperations(undoCount);
      return { success: false, reason: "menu_timeout" };
    }

    // Now type the rest of the command to filter the menu
    document.execCommand("insertText", false, "block eq");
    undoCount++;

    // Give Notion a fast, reliable moment to filter the slash menu
    await sleep(400);

    let beforeEnterActive = document.activeElement;
    dispatchKey(beforeEnterActive, "Enter", "Enter", 13);

    inputField = await waitForActiveElementChange(beforeEnterActive, TIMEOUTS.INPUT);
    if (!inputField) {
      await undoOperations(undoCount);
      return { success: false, reason: "input_timeout" };
    }

    await sleep(150);

    const cleanLatex = latex.trim();

    inputField.focus();
    if (typeof inputField.select === "function") inputField.select();
    document.execCommand("selectAll");
    await sleep(20);

    if (cleanLatex.includes('\n')) {
      const lines = cleanLatex.replace(/\r/g, '').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 0) {
          document.execCommand("insertText", false, lines[i]);
        }
        if (i < lines.length - 1) {
          dispatchKey(inputField, "Enter", "Enter", 13, { shiftKey: true });
          await sleep(20);
        }
      }
    } else {
      document.execCommand("insertText", false, cleanLatex);
    }

    undoCount++;
    await sleep(50);
  }

  await closeNotionDialog(isBlock);
  await sleep(20); // Give Notion time to fully blur the block

  // Step 10: Verify the equation was actually created
  const verified = await verifyEquationCreated(inputField);
  if (!verified) {
    // Extra undo operations for safety (Notion may have done internal ops)
    await undoOperations(undoCount + pivotUndoCount + 5);
    return { success: false, reason: "verify_failed" };
  }

  // Step 11: Clean up the inserted space (if we added one)
  if (insertedSpace) {
    await cleanupInsertedSpace();
  }

  return { success: true };
}

/**
 * Verify that an equation element was created after conversion.
 * Checks if the equation input field closed (meaning Notion accepted the input).
 * Also looks for .katex or .notion-equation near cursor as secondary check.
 */
async function verifyEquationCreated(inputField, timeout) {
  timeout = timeout || TIMEOUTS.EQUATION;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const active = document.activeElement;

    // Primary signal: equation input is no longer focused
    if (active !== inputField) {
      // Secondary: check if focus returned to an editable area
      if (isEditable(active) || active === document.body) {
        // Optional: look for equation element nearby
        await sleep(50);
        return true;
      }
    }
    await sleep(TIMEOUTS.POLL);
  }
  return false;
}

/**
 * Remove the space that was inserted before the slash command.
 * Uses execCommand('delete') to stay compatible with Notion's undo stack.
 * (Replaces old nodeValue manipulation which bypassed undo and could corrupt text.)
 */
async function cleanupInsertedSpace() {
  try {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

    const block = node.closest('.notion-text-block, .notion-selectable') || document.body;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null, false);

    let current = walker.nextNode();
    while (current) {
      if (current.nodeValue.endsWith(" ")) {
        // Check if the next element is an equation
        let nextEl = current.nextSibling;
        if (!nextEl && current.parentElement) {
          nextEl = current.parentElement.nextSibling;
        }

        if (nextEl && nextEl.nodeType === Node.ELEMENT_NODE &&
          (nextEl.classList.contains('notion-equation') || nextEl.classList.contains('katex') || nextEl.querySelector('.katex'))) {

          const r = document.createRange();
          r.setStart(current, current.nodeValue.length - 1);
          r.setEnd(current, current.nodeValue.length);
          const tempSel = window.getSelection();
          tempSel.removeAllRanges();
          tempSel.addRange(r);
          document.execCommand("delete");
          await sleep(10);
          return;
        }
      }
      current = walker.nextNode();
    }
  } catch (e) {
    // Space cleanup is non-critical
  }
}

// ===== GUIDE STATE =====

let guide = null;
let isConverting = false;

function stopGuide(showReport = false) {
  if (!guide) return;
  hideHighlight();
  window.removeEventListener("keydown", onKey, true);
  guide = null;

  if (showReport && conversionLog.length > 0) {
    showConversionReport();
  } else {
    hideHUD();
  }
}

// ===== MAIN STEP LOGIC =====

/**
 * Simplified goStep — no manual mode (which was destructive).
 * In non-auto mode: highlights the equation WITHOUT modifying DOM.
 * Conversion only happens on explicit user action or auto mode.
 */
async function goStep(delta) {
  if (!guide) return;

  // Re-collect items (equations may have changed after previous conversion)
  const items = collectItems();
  guide.items = items;

  if (!items.length) {
    stopGuide(true);
    if (conversionLog.length === 0) {
      showNotification("All done!", false);
    }
    return;
  }

  let i = guide.index + delta;
  if (i < 0) i = 0;
  if (i >= items.length) {
    // Reached the end
    stopGuide(true);
    return;
  }

  guide.index = i;
  const item = items[i];
  const { tn, span } = item;

  // Ensure the text node is still in the DOM
  if (!tn.isConnected) {
    guide.index = 0;
    setTimeout(() => goStep(0), 10);
    return;
  }

  // Scroll into view if off-screen (prevents Notion from unmounting virtualized nodes during focus)
  if (tn.parentElement) {
    const rect = tn.parentElement.getBoundingClientRect();
    const inView = rect.top >= 150 && rect.bottom <= window.innerHeight - 150;
    if (!inView) {
      tn.parentElement.scrollIntoView({ block: "center" });
      await sleep(100); // Give Notion time to render virtualized lists

      // After scrolling, React might have recreated the text node!
      if (!tn.isConnected) {
        setTimeout(() => goStep(0), 10);
        return;
      }
    }
  }

  if (!focusEditableFrom(tn)) {
    guide.index = 0;
    setTimeout(() => goStep(0), 10);
    return;
  }

  const isBlock = span.dbl;

  // AUTO MODE — convert automatically
  if (guide.autoMode) {
    if (isConverting) {
      setTimeout(() => goStep(0), 100);
      return;
    }
    isConverting = true;

    try {
      // Highlight briefly for visual feedback
      const r = setSelectionInTextNode(tn, span.open, span.close);
      if (!r) { setTimeout(() => goStep(0), 0); return; }

      const color = isBlock ? "#60a5fa" : "#4ade80";
      highlightSelection(r, color);
      updateHUD(guide.index, items.length, isBlock, true);

      // Wait for Notion's DOM to settle before manipulating the next equation in Auto Mode
      await sleep(150);

      // Capture context for punctuation protection
      const context = captureContext(tn, span);

      // convertEquation handles select → delete → convert → verify → rollback
      const result = await convertEquation(tn, span);
      if (!guide) return;

      if (result.success) {
        logConversion(context.original, context.latex, isBlock ? "block" : "inline", "success");
        setTimeout(() => goStep(0), 10);
      } else {
        logConversion(context.original, context.latex, isBlock ? "block" : "inline", "rollback", result.reason);

        // Stop auto mode on failure — don't risk further data loss
        guide.autoMode = false;
        showNotification(
          `⚠️ Rollback: ${result.reason}<br>` +
          `<div style="margin-top:10px; font-size:12px; color:#ddd;">Original text (copy if needed):</div>` +
          `<textarea style="width:100%; height:60px; margin-top:4px; padding:6px; background:#333; color:#fff; border:1px solid #555; border-radius:4px; font-family:monospace; resize:vertical; user-select:text; -webkit-user-select:text; cursor:text;" onfocus="this.select()">${context.original}</textarea>`,
          true
        );
      }
    } finally {
      isConverting = false;
    }
    return;
  }

  // NON-AUTO MODE — just highlight, don't modify DOM
  const r = setSelectionInTextNode(tn, span.open, span.close);
  if (!r) { setTimeout(() => goStep(1), 0); return; }

  const color = isBlock ? "#60a5fa" : "#4ade80";
  highlightSelection(r, color);
  updateHUD(guide.index, items.length, isBlock, false);
}

/**
 * Convert the currently highlighted equation (triggered by Ctrl+Shift+E).
 */
async function convertCurrent() {
  if (!guide || guide.autoMode || isConverting) return;

  const item = guide.items[guide.index];
  if (!item) return;

  const { tn, span } = item;
  if (!tn.isConnected) { goStep(0); return; }

  isConverting = true;
  try {
    const isBlock = span.dbl;
    const context = captureContext(tn, span);

    // convertEquation handles select → delete → convert → verify → rollback
    const result = await convertEquation(tn, span);

    if (result.success) {
      logConversion(context.original, context.latex, isBlock ? "block" : "inline", "success");
      setTimeout(() => goStep(0), 10);
    } else {
      logConversion(context.original, context.latex, isBlock ? "block" : "inline", "rollback", result.reason);
      showNotification(
        `⚠️ Rollback: ${result.reason}<br>` +
        `<div style="margin-top:10px; font-size:12px; color:#ddd;">Original text (copy if needed):</div>` +
        `<textarea style="width:100%; height:60px; margin-top:4px; padding:6px; background:#333; color:#fff; border:1px solid #555; border-radius:4px; font-family:monospace; resize:vertical; user-select:text; -webkit-user-select:text; cursor:text;" onfocus="this.select()">${context.original}</textarea>`,
        true
      );
    }
  } finally {
    isConverting = false;
  }
}

// ===== KEYBOARD HANDLER =====

function onKey(e) {
  if (!guide || !e.isTrusted) return;
  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT")) return;

  if (e.key === "Escape") {
    e.preventDefault();
    stopGuide(true);
  }
  else if ((e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (!guide.autoMode) {
      convertCurrent();
    }
  }
  else if ((e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    guide.autoMode = !guide.autoMode;
    setTimeout(() => goStep(0), 10);
  }
  else if (e.key === "ArrowRight") {
    e.preventDefault();
    // Skip this equation
    const item = guide.items[guide.index];
    if (item) {
      const context = captureContext(item.tn, item.span);
      logConversion(context.original, context.latex, context.isBlock ? "block" : "inline", "skipped");
    }
    setTimeout(() => goStep(1), 10);
  }
}

// ===== ENTRY POINT =====

async function runGuided() {
  console.log("[NotionTeX] runGuided() called");
  conversionLog.length = 0;

  const items = collectItems();
  console.log("[NotionTeX] Found", items.length, "equations");
  if (!items.length) {
    showNotification("No equations found", true);
    return;
  }

  guide = { items, index: 0, autoMode: false };

  window.addEventListener("keydown", onKey, true);

  await goStep(0);
}

chrome.runtime.onMessage.addListener(m => {
  console.log("[NotionTeX] Message received:", m);
  if (m?.t === "RUN_CONVERT") runGuided();
});