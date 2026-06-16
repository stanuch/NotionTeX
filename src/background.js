async function run(tabId) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { t: "RUN_CONVERT" }).catch(() => {
    // Ignore error if content script is not loaded or receiving end does not exist
  });
}

chrome.commands.onCommand.addListener(async c => {
  if (c !== "convert_inline_equations") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  run(tab.id);
});

chrome.action.onClicked.addListener(async tab => {
  if (!tab?.id) return;
  run(tab.id);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "convert_inline_equations",
    title: "Convert $…$ to inline equations",
    contexts: ["all"],
    documentUrlPatterns: ["https://notion.so/*", "https://www.notion.so/*", "https://*.notion.site/*", "https://*.notion.com/*"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "convert_inline_equations") return;
  if (!tab?.id) return;
  run(tab.id);
});
