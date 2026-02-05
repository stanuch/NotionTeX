const ROOTS = [".notion-page-content", ".notion-frame", "main", "body"];
const HUD_Z = 2147483646;
const STEP_DELAY = 20;

// --- Global Ignore Set ---
let ignoredNodes = new WeakSet();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isEditable = el => !!el && (el.getAttribute("contenteditable") === "true" || el.isContentEditable);
const isCodeCtx = el => el.closest?.(".notion-code-block, pre, code");
const isMathAlready = el => el.closest?.(".notion-equation, .katex");

// --- DOM Scanners ---

function* textNodes(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.indexOf("$") === -1) return NodeFilter.FILTER_REJECT;
      if (ignoredNodes.has(n)) return NodeFilter.FILTER_REJECT;
      if (!n.parentElement) return NodeFilter.FILTER_REJECT;
      if (isCodeCtx(n.parentElement)) return NodeFilter.FILTER_REJECT;
      if (isMathAlready(n.parentElement)) return NodeFilter.FILTER_REJECT;
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
      if (text[j] === "$") { dbl = (j + 1 < n && text[j + 1] === "$"); open = j; break; }
    }
    if (open === -1) break;
    const openLen = dbl ? 2 : 1;
    let k = open + openLen, close = -1;
    for (; k < n; k++) {
      if (text[k] === "\\") { k++; continue; }
      if (text[k] === "$") {
        if (dbl) { if (k + 1 < n && text[k + 1] === "$") { close = k + 2; break; } }
        else { close = k + 1; break; }
      }
    }
    if (close === -1) { i = open + 1; continue; }
    const innerStart = open + openLen;
    const innerEnd = close - (dbl ? 2 : 1);
    if (innerEnd >= innerStart) spans.push({ open, innerStart, innerEnd, close, dbl });
    i = close;
  }
  return spans;
}

// --- UI / HUD ---

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
    borderRadius: "10px",
    zIndex: String(HUD_Z),
    pointerEvents: "none",
    boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.1)",
    minWidth: "260px", maxWidth: "380px", lineHeight: "1.5",
    backdropFilter: "blur(6px)"
  });
  document.documentElement.appendChild(hud);
  return hud;
}

function updateHUD(current, total) {
  const hud = makeHUD();
  hud.style.display = "block";
  hud.style.padding = "16px 20px";

  const cmd = /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";

  hud.innerHTML =
    `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; gap:20px;">
       <span style="font-weight:700; font-size:16px; color:#4ade80; white-space:nowrap; letter-spacing: 0.5px;">Equation Found</span>
       <span style="font-size:12px; font-weight:600; opacity:0.9; background:rgba(255,255,255,0.15); padding:3px 10px; border-radius:12px; font-variant-numeric: tabular-nums;">
         ${current + 1} / ${total}
       </span>
     </div>` +
    `<div style="font-size:13px; opacity:0.9; margin-bottom:6px;">
       Press <b style="color:#fff; border-bottom:1px solid #aaa; font-size:14px;">${cmd}+Shift+E</b>
     </div>` +
    `<div style="font-size:12px; color:#bbb; margin-top:10px; display:flex; gap:15px; font-weight:500;">
       <span>➡ Skip (Ignore)</span> <span>ESC: Exit</span>
     </div>`;
}

// --- NOTIFICATION SYSTEM (Medium Sized) ---
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

  setTimeout(() => {
    if (!guide) hideHUD();
  }, 3000);
}

const showHUD = (idx, total) => updateHUD(idx, total);
const hideHUD = () => { const h = document.getElementById("eq-hud"); if (h) h.style.display = "none"; };

// --- Highlighting ---

function highlightSelection(range) {
  let box = document.getElementById("eq-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "eq-box";
    Object.assign(box.style, {
      position: "fixed", border: `2px solid #4ade80`, borderRadius: "4px",
      background: "rgba(74, 222, 128, 0.15)", zIndex: String(HUD_Z), pointerEvents: "none",
      transition: "all 0.1s cubic-bezier(0.4, 0, 0.2, 1)"
    });
    document.documentElement.appendChild(box);
  }
  const rects = range.getClientRects();
  if (!rects.length) { box.style.display = "none"; return; }
  const r = rects[0];
  Object.assign(box.style, {
    left: `${r.left - 4}px`, top: `${r.top - 2}px`,
    width: `${r.width + 8}px`, height: `${r.height + 4}px`, display: "block"
  });
}
const hideHighlight = () => { const b = document.getElementById("eq-box"); if (b) b.style.display = "none"; };

// --- Edit Helpers ---

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
  await sleep(STEP_DELAY);
}

// --- Main Logic ---

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

let guide = null;

function stopGuide() {
  if (!guide) return;
  hideHUD(); hideHighlight();
  window.removeEventListener("keydown", onKey, true);
  if (guide.mo) { guide.mo.disconnect(); guide.mo = null; }
  guide = null;
}

async function goStep(delta, recursionDepth = 0) {
  if (!guide) return;
  if (recursionDepth > 3) return;

  const items = collectItems();
  guide.items = items;

  if (!items.length) {
    stopGuide();
    showNotification("All done! No more equations found.", false);
    return;
  }

  let i = guide.index + delta;
  if (i < 0) i = 0;
  if (i >= items.length) i = items.length - 1;

  guide.index = i;
  const item = items[i];
  const { tn } = item;

  if (!tn.isConnected || !focusEditableFrom(tn)) {
    return goStep(0, recursionDepth + 1);
  }

  const text = tn.nodeValue;
  const spans = findDollarSpans(text);
  if (!spans.length) {
    return goStep(0, recursionDepth + 1);
  }

  const s = spans[0];
  item.span = s;

  const ed = focusEditableFrom(tn);
  if (!ed) return goStep(1, recursionDepth + 1);

  // Prepare selection
  setSelectionInTextNode(tn, s.innerEnd, s.close);
  await deleteSelection();
  setSelectionInTextNode(tn, s.open, s.innerStart);
  await deleteSelection();

  const innerLen = s.innerEnd - s.innerStart;
  const r = setSelectionInTextNode(tn, s.open, s.open + innerLen);

  if (r) {
    highlightSelection(r);
    showHUD(guide.index, items.length);
  }

  armAutoAdvance();
}

function armAutoAdvance() {
  if (!guide) return;
  if (guide.mo) { guide.mo.disconnect(); guide.mo = null; }

  guide.mo = new MutationObserver((mutations) => {
    const eqAdded = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === 1 && (n.classList?.contains("notion-equation") || n.classList?.contains("katex"))
      )
    );

    if (eqAdded) {
      setTimeout(() => { if (guide) goStep(0); }, 50);
      return;
    }

    const dlg = document.querySelector('div[role="dialog"] [contenteditable="true"]');
    if (dlg) {
      const btn = Array.from(document.querySelectorAll('div[role="dialog"] div[role="button"]'))
        .find(b => b.textContent === "Done");
      if (btn) {
        btn.click();
        setTimeout(() => { if (guide) goStep(0); }, 50);
      }
    }
  });
  guide.mo.observe(document.body, { childList: true, subtree: true });
}

function onKey(e) {
  if (!guide) return;

  if (e.key === "Escape") {
    e.preventDefault(); stopGuide();
  }
  else if (e.key === "ArrowRight") {
    e.preventDefault();

    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      // Restore dollars
      const text = sel.toString();
      document.execCommand("insertText", false, "$" + text + "$");

      // Mark as ignored
      const newNode = window.getSelection().anchorNode;
      if (newNode && newNode.nodeType === 3) {
        ignoredNodes.add(newNode);
      }
    }

    setTimeout(() => goStep(0), 50);
  }
}

async function runGuided() {
  ignoredNodes = new WeakSet();

  const items = collectItems();

  if (!items.length) {
    showNotification("No equations found ($...$)", true);
    return;
  }

  guide = { items, index: 0, mo: null };
  window.addEventListener("keydown", onKey, true);
  await goStep(0);
}

chrome.runtime.onMessage.addListener(m => {
  if (m?.t === "RUN_CONVERT") runGuided();
});