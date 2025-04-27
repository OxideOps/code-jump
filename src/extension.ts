import * as vscode from 'vscode';

// Interface for storing label position
interface Match {
    label: string;
    info: MatchInfo;
}

// Interface for storing match information
interface MatchInfo {
    start: vscode.Position;
    range: vscode.Range;
    nextChar: string;
    nextNextChar: string;
}

// Configuration options
const MAX_MATCHES = 300;

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
let matchingLabels: boolean = false;
let inputBufferLength: number = 0;
let searchString: string = '';
let editedQuickPick: boolean = false;

let quickPick: vscode.QuickPick<vscode.QuickPickItem> | null = null;

// Array to track label positions
let matches: Match[] = [];

// Characters used for labels - chosen for clarity and ease of reach on keyboard
const labelChars: string = 'JFKDLSHGAYTNBURMVIECOXWPZQ';

export function activate(context: vscode.ExtensionContext): void {
    // Register the main quick jump command
    const startJumpDisposable = vscode.commands.registerCommand('quick-jump.startJump', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
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
            const backspaced = value.length < inputBufferLength;
            inputBufferLength = value.length;

            if (editedQuickPick) {
                editedQuickPick = false;
                return;
            }

            if (value.length === 0) {
                if (matchingLabels) {
                    matchingLabels = false;
                    editQuickPick(searchString);
                    findAndHighlightMatches(editor);
                } else {
                    exitJumpMode(editor);
                }
                return;
            }

            const searchChar = value[value.length - 1].toUpperCase();
            const matchedLabel = matches.find(lp => lp.label === searchChar);

            if (!backspaced && matchedLabel) {
                const position = matchedLabel.info.start;
                // If a selection is active, keep the anchor and move the active end
                // Otherwise, just move the cursor to the target position
                if (!editor.selection.isEmpty) {
                    editor.selection = new vscode.Selection(editor.selection.anchor, position);
                } else {
                    editor.selection = new vscode.Selection(position, position);
                }
                editor.revealRange(new vscode.Range(position, position));
                exitJumpMode(editor);
            } else if (!backspaced && matches.some(lp => lp.label.startsWith(searchChar))) {
                matchingLabels = true;
                matches = matches.filter(lp => lp.label.startsWith(searchChar));
                matches.forEach(match => {
                    match.label = match.label.substring(searchChar.length);
                });
                editQuickPick(searchChar.toLowerCase());
                updateDecorations(editor);
            } else if (!matchingLabels) {
                searchString = value;
                findAndHighlightMatches(editor);
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
    const escJumpDisposable = vscode.commands.registerCommand('quick-jump.escapeJumpMode', () => {
        if (inJumpMode) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                exitJumpMode(editor);
            }
        }
    });

    context.subscriptions.push(startJumpDisposable);
    context.subscriptions.push(escJumpDisposable);

    // Add decorations to subscription for proper cleanup
    context.subscriptions.push(matchDecorationType);
    context.subscriptions.push(labelDecorationType);
}

function editQuickPick(value: string): void {
    if (quickPick) {
        quickPick.value = value;
        editedQuickPick = true;
    }
}

// Generate unique labels efficiently
function generateLabels(matchInfos: MatchInfo[]): string[] {
    const nextChars = new Set(matchInfos.map(match => match.nextChar.toUpperCase()));
    const count = matchInfos.length;
    const labelCharsArray = labelChars.split('');
    const firstChars = labelCharsArray.filter(char => !nextChars.has(char));
    const labels = Array.from({ length: count }, (_, i) => firstChars[i % firstChars.length]);

    if (count <= firstChars.length) {
        return labels;
    }

    // For matches that need two-character labels
    const secondCharMap = new Map<string, Set<string>>();

    // Group matches by their first label character
    matchInfos.forEach((match, i) => {
        const firstChar = labels[i];
        if (!secondCharMap.has(firstChar)) {
            secondCharMap.set(firstChar, new Set(labelCharsArray));
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

function findAndHighlightMatches(editor: vscode.TextEditor): void {
    if (!searchString) {
        clearDecorations(editor);
        return;
    }

    const text = editor.document.getText();
    const searchRegex = new RegExp(escapeRegExp(searchString), 'gi');
    const visibleRanges = editor.visibleRanges;

    // Find all matches
    let match: RegExpExecArray | null;
    let matchInfos: MatchInfo[] = [];
    let matchCount = 0;

    // Limit to MAX_MATCHES to prevent performance issues
    while ((match = searchRegex.exec(text)) !== null && matchCount < MAX_MATCHES) {
        const startPos = editor.document.positionAt(match.index);
        const endPos = editor.document.positionAt(match.index + searchString.length);

        // Only include matches in the visible ranges
        for (const visibleRange of visibleRanges) {
            if (startPos.line >= visibleRange.start.line && endPos.line <= visibleRange.end.line) {
                const nextChar = getNextCharacter(editor, endPos);
                const nextNextChar = getNextCharacter(editor, endPos.translate(0, 1));
                // Store match information with position
                matchInfos.push({
                    start: startPos,
                    range: new vscode.Range(startPos, endPos),
                    nextChar,
                    nextNextChar
                });
                matchCount++;
                break;
            }
        }
    }

    // Generate a unique label for each match, avoiding next character conflicts
    const labels = generateLabels(matchInfos);

    matches = matchInfos.map((match, index) => ({
        label: labels[index],
        info: match
    }));

    updateDecorations(editor);
}

function updateDecorations(editor: vscode.TextEditor): void {
    const matchRanges: vscode.DecorationOptions[] = [];
    const labelDecorations: vscode.DecorationOptions[] = [];

    matches.forEach(match => {
        // Add match highlighting
        matchRanges.push({
            range: match.info.range
        });

        // Add label decoration
        labelDecorations.push({
            range: new vscode.Range(match.info.start, match.info.start),
            renderOptions: {
                before: {
                    contentText: match.label
                }
            }
        });
    });

    // Apply decorations
    editor.setDecorations(matchDecorationType, matchRanges);
    editor.setDecorations(labelDecorationType, labelDecorations);

    // Update the QuickPick title with match count
    if (quickPick) {
        quickPick.title = matches.length >= MAX_MATCHES ?
            `${matches.length}+ matches (limited)` :
            `${matches.length} matches`;
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
    matches = [];
    matchingLabels = false;
    searchString = '';
    inputBufferLength = 0;

    // Dispose quickpick if exists
    if (quickPick) {
        quickPick.dispose();
        quickPick = null;
    }
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deactivate(): void {
    // Clean up any remaining state
    const editor = vscode.window.activeTextEditor;
    if (editor && inJumpMode) {
        exitJumpMode(editor);
    }

    // Explicitly dispose decoration types
    matchDecorationType.dispose();
    labelDecorationType.dispose();
} 
