# Notion Inline Math Assistant

A Chrome extension that converts LaTeX-style math notation (`$...$` and `$$...$$`) into native Notion inline equations.

## Overview

Notion supports inline equations, but entering them requires navigating menus or using slash commands, which interrupts the flow of note-taking. This extension allows you to write math naturally using standard LaTeX delimiters and convert them to native Notion equations with a single keyboard shortcut.

## Features

- **LaTeX Delimiter Detection**: Automatically finds both inline (`$...$`) and block-style (`$$...$$`) math expressions
- **Guided Navigation**: Step through each detected equation one-by-one with visual highlighting
- **Keyboard-Driven Workflow**: Convert, skip, or navigate equations without leaving the keyboard
- **Privacy-Focused**: Runs entirely locally in your browser with no external data transmission
- **Context-Aware Scanning**: Ignores equations already converted or inside code blocks

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** in the top right corner
4. Click **Load unpacked**
5. Select the repository root folder (the directory containing `manifest.json`)

## Usage

### Step 1: Write Your Math

Type your notes using standard LaTeX delimiters:

```
The solution is $E=mc^2$.

We define $$\sum_{i=0}^n i$$ as the sum.
```

### Step 2: Activate the Extension

Trigger the extension using one of the following methods:

| Method | Windows/Linux | Mac |
|:-------|:--------------|:----|
| Keyboard Shortcut | `Ctrl + M` | `Cmd + Shift + M` |
| Toolbar Icon | Click the extension icon | Click the extension icon |
| Context Menu | Right-click and select "Convert $...$ to inline equations" | Right-click and select "Convert $...$ to inline equations" |

The extension scans the page and highlights the first detected equation in green.

### Step 3: Navigate and Convert

Once an equation is highlighted, use these controls:

| Action | Shortcut | Description |
|:-------|:---------|:------------|
| Convert | `Ctrl + Shift + E` (`Cmd + Shift + E` on Mac) | Converts the highlighted equation to a Notion equation block |
| Next | `Right Arrow` | Skip to the next equation |
| Exit | `Esc` | Close the extension and remove highlights |

## How It Works

### Architecture

The extension consists of two main components:

**Background Script** (`src/background.js`)
- Listens for keyboard commands and toolbar/context menu clicks
- Sends messages to the content script to trigger conversion

**Content Script** (`src/content.js`)
- Scans the Notion page DOM for text nodes containing LaTeX delimiters
- Creates visual overlays to highlight detected equations
- Manages the guided navigation workflow
- Handles text selection and triggers Notion's native equation insertion

### Detection Process

1. The content script traverses all text nodes within Notion's page content
2. Each text node is scanned for `$...$` and `$$...$$` patterns using regex
3. Nodes inside code blocks (`.notion-code-block`, `pre`, `code`) are excluded
4. Already-converted equations (`.notion-equation`, `.katex`) are ignored
5. Detected equations are stored with their DOM ranges for highlighting and selection

### Conversion Process

1. When converting, the extension selects the equation text including delimiters
2. The selected text is deleted
3. Notion's equation insertion is triggered via keyboard simulation
4. The raw LaTeX content (without delimiters) is pasted into the equation editor

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
- Nested delimiters (e.g., `$a$b$c$`) may produce unexpected results

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.

## License

This project is provided as-is for personal and educational use.