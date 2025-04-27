# VS Code Quick Jump

A quick navigation extension for VS Code inspired by AceJump/EasyMotion plugins from other editors.

## Features

- Quick cursor navigation without using the mouse
- Press `Ctrl+;` (or `Cmd+;` on Mac) to activate Quick Jump mode
- Type characters to highlight matching occurrences in the visible editor area
- Each match gets a unique character label that you can press to jump directly to that location
- Supports multi-character labels for efficient navigation when there are many matches
- Smart label generation that avoids using characters that conflict with the next character in target text
- Supports backspacing when searching and typing labels

## Usage

1. Press `Ctrl+;` (or `Cmd+;` on Mac) to activate Quick Jump
2. Type characters to highlight matches
3. Press the displayed label to jump to that position
4. Use backspace to refine your search
5. Press `Escape` to exit Quick Jump mode

## Requirements

- VS Code 1.60.0 or higher

## Installation

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Quick Jump"
4. Click Install

## Extension Settings

None currently.

## Known Issues

Please report any bugs or feature requests on the [GitHub repository](https://github.com/OxideOps/quick-jump/issues).

## Development

- Run `npm install` to install dependencies
- Press `F5` to start debugging

## License

MIT 