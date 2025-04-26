import * as vscode from 'vscode';

// Decoration type for matched characters
let matchDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
    border: '2px solid #569cd6',
    backgroundColor: 'rgba(38, 79, 120, 0.5)',
    // @ts-ignore - borderRadius is not in the type definition but works in practice
    borderRadius: '3px'
});

// Decoration type for character labels
let labelDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
    before: {
        margin: '0 3px 0 0',
        backgroundColor: '#569cd6',
        color: 'white',
        fontWeight: 'bold',
        // @ts-ignore - borderRadius is not in the type definition but works in practice
        borderRadius: '2px',
        padding: '0 3px'
    }
});

// Track if we're in jump mode
let inJumpMode: boolean = false;
let labelDecorations: vscode.DecorationOptions[] = [];
let quickPick: vscode.QuickPick<vscode.QuickPickItem> | null = null;
let searchBuffer: string = '';

// Map to track label positions - key is the label, value is the Position to jump to
let labelPositionMap: Map<string, vscode.Position> = new Map();

// Characters used for labels - chosen for clarity and ease of reach on keyboard
const labelChars: string = 'jfkdlshgaytnburmviecoxwpzq';

// Interface for storing match information
interface MatchPosition {
    start: vscode.Position;
    range: vscode.Range;
    nextChar: string;
}

export function activate(context: vscode.ExtensionContext): void {
    // Register the main ace jump command
    const startJumpDisposable = vscode.commands.registerCommand('ace-jump.startJump', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // If already in jump mode, exit
        if (inJumpMode) {
            exitJumpMode(editor);
            return;
        }

        // Enter jump mode
        inJumpMode = true;
        searchBuffer = '';

        // Create QuickPick input that minimizes UI
        quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = 'Type characters to highlight (ESC to cancel)';
        quickPick.items = [];

        // Make the quickpick as minimal as possible
        quickPick.matchOnDescription = false;
        quickPick.matchOnDetail = false;
        quickPick.canSelectMany = false;

        // Listen to value changes to update highlights in real-time
        quickPick.onDidChangeValue(value => {
            searchBuffer = value;
            findAndHighlightMatches(editor, searchBuffer);
        });

        // Exit when quickpick is hidden
        quickPick.onDidHide(() => {
            exitJumpMode(editor);
        });

        // Show the quickpick
        quickPick.show();
    });

    // Register the escape jump mode command
    const escJumpDisposable = vscode.commands.registerCommand('extension.escapeJumpMode', () => {
        if (inJumpMode) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                exitJumpMode(editor);
            }
        }
    });

    context.subscriptions.push(startJumpDisposable);
    context.subscriptions.push(escJumpDisposable);
}

// Generate unique labels efficiently
function generateLabels(count: number, charsToAvoid: Set<string> = new Set()): string[] {
    const labels: string[] = [];
    // Filter out characters to avoid
    const filteredLabelChars = labelChars.split('')
        .filter(char => !charsToAvoid.has(char.toUpperCase()))
        .join('');

    // If we have no usable chars, fallback to original set
    const usableChars = filteredLabelChars.length > 0 ? filteredLabelChars : labelChars;

    // First, use single characters if there are few enough matches
    if (count <= usableChars.length) {
        for (let i = 0; i < count; i++) {
            labels.push(usableChars[i].toUpperCase());
        }
        return labels;
    }

    // Otherwise use combinations of characters
    if (count <= usableChars.length * labelChars.length) {
        for (let i = 0; i < usableChars.length; i++) {
            for (let j = 0; j < labelChars.length && labels.length < count; j++) {
                labels.push((usableChars[i] + labelChars[j]).toUpperCase());
            }
        }
        return labels;
    }

    // If we need more labels (rare), generate three-character labels
    for (let i = 0; i < usableChars.length && labels.length < count; i++) {
        for (let j = 0; j < labelChars.length && labels.length < count; j++) {
            for (let k = 0; k < labelChars.length && labels.length < count; k++) {
                labels.push((usableChars[i] + labelChars[j] + labelChars[k]).toUpperCase());
            }
        }
    }
    return labels;
}

function findAndHighlightMatches(editor: vscode.TextEditor, searchString: string): void {
    // Clear previous decorations
    editor.setDecorations(matchDecorationType, []);
    editor.setDecorations(labelDecorationType, []);

    if (!searchString) {
        return;
    }

    const text = editor.document.getText();
    const searchRegex = new RegExp(escapeRegExp(searchString), 'gi');
    const matchRanges: vscode.DecorationOptions[] = [];
    const visibleRanges = editor.visibleRanges;

    // Find all matches
    let match: RegExpExecArray | null;
    let matchPositions: MatchPosition[] = [];
    const nextChars = new Set<string>();

    while ((match = searchRegex.exec(text)) !== null) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + searchString.length);

        // Only include matches in the visible ranges
        for (const visibleRange of visibleRanges) {
            if (startPos.line >= visibleRange.start.line && endPos.line <= visibleRange.end.line) {
                const nextChar = getNextCharacter(editor, endPos);
                // Store match information with position
                matchPositions.push({
                    start: startPos,
                    range: new vscode.Range(startPos, endPos),
                    nextChar
                });
                // Add to set of chars to avoid if it's a letter
                if (nextChar.match(/[a-zA-Z]/)) {
                    nextChars.add(nextChar.toUpperCase());
                }
                break;
            }
        }
    }

    // Generate a unique label for each match, avoiding next character conflicts
    const labels = generateLabels(matchPositions.length, nextChars);

    // Create highlight decorations and label decorations
    matchRanges.length = 0;
    labelDecorations.length = 0;

    // Clear map
    labelPositionMap.clear();

    matchPositions.forEach((match, index) => {
        // Add match highlighting
        matchRanges.push({
            range: match.range
        });

        // Add label decoration
        const label = labels[index];
        labelDecorations.push({
            range: new vscode.Range(match.start, match.start),
            renderOptions: {
                before: {
                    contentText: label
                }
            }
        });

        // Store the label and its position for future jumping
        labelPositionMap.set(label, match.start);
    });

    // Apply decorations
    editor.setDecorations(matchDecorationType, matchRanges);
    editor.setDecorations(labelDecorationType, labelDecorations);

    // Update the QuickPick title with match count
    if (quickPick) {
        quickPick.title = `${matchPositions.length} matches`;
    }
}

function getNextCharacter(editor: vscode.TextEditor, position: vscode.Position): string {
    // Get the character after the match, if possible
    try {
        const nextPos = position.translate(0, 1);
        const range = new vscode.Range(position, nextPos);
        return editor.document.getText(range);
    } catch (e) {
        return '';
    }
}

function clearDecorations(editor: vscode.TextEditor): void {
    // Clear all decorations
    editor.setDecorations(matchDecorationType, []);
    editor.setDecorations(labelDecorationType, []);
}

function exitJumpMode(editor: vscode.TextEditor): void {
    inJumpMode = false;
    clearDecorations(editor);
    labelPositionMap.clear();

    // Dispose quickpick if exists
    if (quickPick) {
        quickPick.dispose();
        quickPick = null;
    }
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deactivate(): void { } 