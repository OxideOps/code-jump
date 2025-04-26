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
let labelMatchString: string = '';
let labelDecorations: vscode.DecorationOptions[] = [];
let quickPick: vscode.QuickPick<vscode.QuickPickItem> | null = null;

// Map to track label positions - key is the label, value is the Position to jump to
let labelPositionMap: Map<string, vscode.Position> = new Map();

// Characters used for labels - chosen for clarity and ease of reach on keyboard
const labelChars: string = 'JFKDLSHGAYTNBURMVIECOXWPZQ';

// Interface for storing match information
interface MatchPosition {
    start: vscode.Position;
    range: vscode.Range;
    nextChar: string;
    nextNextChar: string;
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
            const searchString = labelMatchString + value[value.length - 1].toUpperCase();
            for (const key of labelPositionMap.keys()) {
                if (key.startsWith(searchString)) {
                    labelMatchString = searchString;
                    if (labelMatchString.length === value.length) {
                        // Jump
                    }
                    break;
                }
            }

            if (!labelMatchString) {
                findAndHighlightMatches(editor, value);
            }
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
function generateLabels(matchPositions: MatchPosition[]): string[] {
    const nextChars = new Set(matchPositions.map(match => match.nextChar));
    const count = matchPositions.length;
    const labelCharsSet = new Set(labelChars.split(''));
    const firstChars = Array.from(labelCharsSet).filter(char => !nextChars.has(char));
    const labels = Array.from({ length: count }, (_, i) => firstChars[i % firstChars.length]);

    if (count <= firstChars.length) {
        return labels;
    }

    // For matches that need two-character labels
    const secondCharMap = new Map<string, Set<string>>();

    // Group matches by their first label character
    matchPositions.forEach((match, i) => {
        const firstChar = labels[i];
        if (!secondCharMap.has(firstChar)) {
            secondCharMap.set(firstChar, new Set(labelCharsSet));
        }
        secondCharMap.get(firstChar)!.delete(match.nextNextChar.toUpperCase());
    });

    // Assign second characters for labels that need them
    for (let i = 0; i < labels.length; i++) {
        const firstChar = labels[i];
        const nextValue = secondCharMap.get(firstChar)!.values().next();
        if (nextValue.done) continue;
        labels[i] = firstChar + nextValue.value;
        secondCharMap.get(firstChar)!.delete(nextValue.value);
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

    while ((match = searchRegex.exec(text)) !== null) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + searchString.length);

        // Only include matches in the visible ranges
        for (const visibleRange of visibleRanges) {
            if (startPos.line >= visibleRange.start.line && endPos.line <= visibleRange.end.line) {
                const nextChar = getNextCharacter(editor, endPos);
                const nextNextChar = getNextCharacter(editor, endPos.translate(0, 1));
                // Store match information with position
                matchPositions.push({
                    start: startPos,
                    range: new vscode.Range(startPos, endPos),
                    nextChar,
                    nextNextChar
                });
                break;
            }
        }
    }

    // Generate a unique label for each match, avoiding next character conflicts
    const labels = generateLabels(matchPositions);

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