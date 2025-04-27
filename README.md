# Code Jump

A quick navigation extension for VS Code inspired by AceJump/EasyMotion plugins from other editors.

## Features

- Quick cursor navigation without using the mouse
- Press `Ctrl+;` (or `Cmd+;` on Mac) to activate Code Jump mode
- Type characters to highlight matching occurrences in the visible editor area
- Each match gets a unique character label that you can press to jump directly to that location
- Characters are chosen for labels in order of ease of pressing
- Smart label generation that avoids using characters that conflict with the next character in target text
- Supports backspacing when searching and typing labels
- Integrates powerfully with vim visual mode, allowing selections to be extended to presize locations

## Usage

1. Press `Ctrl+;` (or `Cmd+;` on Mac) to activate Code Jump
2. Type characters to highlight matches
3. Press the displayed label to jump to that position
4. Use backspace to refine your search
5. Press `Escape` to exit Code Jump mode

## Requirements

- VS Code 1.60.0 or higher

## Extension Settings

None currently.

## Known Issues

Please report any bugs or feature requests on the [GitHub repository](https://github.com/OxideOps/code-jump/issues).

## Development

- Run `npm install` to install dependencies
- Press `F5` to start debugging

## License

MIT 