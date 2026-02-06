<p align="center">
  <img src="assets/Notion-Inline-Math-Assistant_logo.png" width="500" alt="Notion Inline Math Assistant Logo">
</p>

A Chrome extension that converts LaTeX-style math notation (`$...$` for inline and `$$...$$` for block equations) into native Notion equations. Notion supports equations natively, but entering them requires navigating menus or using slash commands. This extension streamlines the workflow by allowing you to write math in familiar LaTeX syntax and convert it with a single action.

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Notion](https://img.shields.io/badge/Notion-000000?logo=notion&logoColor=white)
![Chrome](https://img.shields.io/badge/Chrome_Extension-4285F4?logo=google-chrome&logoColor=white)
![Manifest](https://img.shields.io/badge/Manifest-V3-2ea44f?logo=google-chrome&logoColor=white)
![AI Assisted](https://img.shields.io/badge/Built_with-AI-blueviolet?style=flat)

## Features

- **Dual Equation Support**: Converts both inline (`$...$`) and block (`$$...$$`) equations
- **Two Conversion Modes**:
  - **Manual Mode**: Navigate equations one-by-one and convert with `Ctrl+Shift+E`
  - **Auto Mode**: Automatically converts all detected equations in sequence
- **Adjustable Speed Settings**: Configure timing delays via the HUD for different computer speeds
- **Visual Feedback**: On-screen HUD shows progress, current mode, and keyboard shortcuts
- **Non-Destructive Workflow**: Equations are only modified when you commit to conversion
- **Context-Aware**: Ignores equations already converted or inside code blocks

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** in the top right corner
4. Click **Load unpacked**
5. Select the repository root folder (containing `manifest.json`)

## Usage

### Step 1: Write Your Math

Type your notes using standard LaTeX delimiters:

```
The solution is $E=mc^2$ for inline equations.

For block equations, use $$\sum_{i=0}^n i^2$$ on its own line.
```

### Step 2: Activate the Extension

| Method | Windows/Linux | Mac |
|:-------|:--------------|:----|
| Keyboard Shortcut | `Ctrl + M` | `Cmd + Shift + M` |
| Toolbar Icon | Click the extension icon | Click the extension icon |
| Context Menu | Right-click → "Convert $...$ to inline equations" | Right-click → "Convert $...$ to inline equations" |

### Step 3: Convert Equations

Once activated, a HUD appears showing the first equation. Use these controls:

| Action | Shortcut | Description |
|:-------|:---------|:------------|
| Convert | `Ctrl + Shift + E` | Converts the highlighted equation |
| Auto Mode | `A` | Toggle automatic conversion of all equations |
| Skip | `→` (Arrow Right) | Skip to the next equation |
| Speed Settings | `S` | Open speed configuration panel |
| Exit | `Esc` | Close the extension (restores any uncommitted changes) |

### Speed Settings

Press `S` to open the speed settings panel. Choose a preset or set custom values:

| Preset | Menu Wait | Input Wait | Typing | Use Case |
|:-------|:----------|:-----------|:-------|:---------|
| Fast | 50ms | 25ms | 5ms | Fast computers |
| Normal | 100ms | 50ms | 10ms | Default |
| Slow | 200ms | 100ms | 20ms | Slower computers |
| Very Slow | 400ms | 200ms | 40ms | If experiencing issues |

Settings are saved automatically and persist between sessions.

## How It Works

The extension operates through two components:

**Background Script** (`src/background.js`)
- Listens for keyboard commands and toolbar/context menu clicks
- Sends activation messages to the content script

**Content Script** (`src/content.js`)
- Scans Notion's DOM for text nodes containing LaTeX delimiters
- Creates visual overlays to highlight detected equations
- Manages the conversion workflow using Notion's native commands
- Handles both `/inlinemath` and `/math` slash commands for respective equation types

## Technical Details

| Property | Value |
|:---------|:------|
| Manifest Version | 3 |
| Minimum Chrome Version | 109 |
| Permissions | `activeTab`, `scripting`, `contextMenus` |
| Host Permissions | `notion.so`, `*.notion.site` |

## Limitations

- Only works on `notion.so` and `*.notion.site` domains
- Requires the Notion page to be fully loaded before activation
- Nested or malformed delimiters may produce unexpected results
- This extension can not be used in the Notion Desktop app (from what I am aware of)

## About This Project

This extension was built with AI assistance. I am not a JavaScript developer. 
This project was created for personal use to address the frustration of manually entering math equations in Notion. The codebase reflects a practical solution rather than a showcase of JavaScript expertise.
Contributions and feedback are welcome.

---

*Disclaimer: This is an unofficial extension and is not affiliated with Notion Labs, Inc.*