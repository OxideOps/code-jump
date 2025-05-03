import * as vscode from 'vscode';

// Interface for storing label position
interface Match {
    label: string;
    info: MatchInfo;
    displayBefore: boolean;
}

// Interface for storing match information
interface MatchInfo {
    start: vscode.Position;
    range: vscode.Range;
    nextChar: string;
    nextNextChar: string;
}
const color = '#569cd6';

// Decoration type for matched characters
const matchDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
    border: `2px solid ${color}`,
    backgroundColor: 'rgba(38, 79, 120, 0.5)',
});

// Decoration type for character labels
const labelDecorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({
    before: {
        backgroundColor: color,
        color: 'white',
        fontWeight: 'bold',
        fontStyle: 'normal',
    }
});

// Track if we're in jump mode
let inJumpMode: boolean = false;
let matchingLabels: boolean = false;
let inputBufferLength: number = 0;
let searchString: string = '';
let editedQuickPick: boolean = false;
let matchesExceeded: boolean = false;

let quickPick: vscode.QuickPick<vscode.QuickPickItem> | null = null;

// Array to track label positions
let matches: Match[] = [];

// Characters used for labels - chosen for clarity and ease of reach on keyboard
const labelChars: string = 'JFKDLSHGAYTNBURMVIECOXWPZQ';

// Configuration options
let useInlineLabels: boolean = false;

export function activate(context: vscode.ExtensionContext): void {
    // Load configuration
    const config = vscode.workspace.getConfiguration('code-jump');
    useInlineLabels = config.get<boolean>('inlineLabels') || false;

    // Watch for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('code-jump.inlineLabels')) {
            const config = vscode.workspace.getConfiguration('code-jump');
            useInlineLabels = config.get<boolean>('inlineLabels') || false;
        }
    }));

    // Register the main code jump command
    const startJumpDisposable = vscode.commands.registerCommand('code-jump.startJump', function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        // Enter jump mode
        inJumpMode = true;
        vscode.commands.executeCommand('setContext', 'code-jump.inJumpMode', true);

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
                } else {
                    searchString = '';
                }
                findAndHighlightMatches(editor);
                return;
            }

            const searchChar = value[value.length - 1].toUpperCase();
            const matchedLabel = matches.find(lp => lp.label === searchChar);

            if (!backspaced && matchedLabel) {
                const position = matchedLabel.info.start;
                // If a selection is active, keep the anchor and move the active end
                // Otherwise, just move the cursor to the target position
                if (!editor.selection.isEmpty) {
                    editor.selection = new vscode.Selection(editor.selection.anchor, position.translate(0, 1));
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
            } else if (matchingLabels) {
                editQuickPick(value.slice(0, -1));
            } else {
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
    const escJumpDisposable = vscode.commands.registerCommand('code-jump.escapeJumpMode', () => {
        if (inJumpMode) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                exitJumpMode(editor);
            }
        }
    });

    context.subscriptions.push(
        startJumpDisposable,
        escJumpDisposable,
        matchDecorationType,
        labelDecorationType
    );
}

function editQuickPick(value: string): void {
    if (quickPick) {
        quickPick.value = value;
        editedQuickPick = true;
    }
}

// Generate unique labels efficiently
function generateLabels(matchInfos: MatchInfo[]): Match[] {
    const nextChars = new Set(matchInfos.map(match => match.nextChar.toUpperCase()));
    const count = matchInfos.length;
    if (count === 0) {
        matchesExceeded = false;
        return [];
    }
    const labelCharsArray = labelChars.split('');
    const firstCharCandidates = labelCharsArray.filter(char => !nextChars.has(char));
    if (firstCharCandidates.length === 0) {
        matchesExceeded = true;
        return [];
    }
    let labels = Array.from({ length: count }, (_, i) => firstCharCandidates[i % firstCharCandidates.length]);

    if (count > firstCharCandidates.length) {
        const firstCharIndices = new Map<string, number[]>();
        labels.forEach((firstChar, i) => {
            const arr = firstCharIndices.get(firstChar);
            if (arr) arr.push(i);
            else firstCharIndices.set(firstChar, [i]);
        });

        const secondCharCandidates = new Map<string, Set<string>>();
        firstCharIndices.forEach((indices, firstChar) => {
            if (indices.length > 1) {
                const set = new Set(labelCharsArray);
                indices.forEach(i => set.delete(matchInfos[i].nextNextChar.toUpperCase()));
                secondCharCandidates.set(firstChar, set);
            }
        });

        for (const [firstChar, indices] of firstCharIndices) {
            if (indices.length > 1) {
                for (const i of indices) {
                    const set = secondCharCandidates.get(firstChar)!;
                    const nextValue = set.values().next();
                    if (nextValue.done) {
                        matchesExceeded = true;
                        return [];
                    }
                    labels[i] = firstChar + nextValue.value;
                    set.delete(nextValue.value);
                }
            }
        }
    }

    matchesExceeded = false;
    // Map MatchInfo to Match objects
    const initialMatches: Match[] = matchInfos.map((info, i) => ({
        label: labels[i],
        info,
        displayBefore: false
    }));

    // Filter overlapping matches based on start position and label width
    const filteredMatches: Match[] = [];
    let currentLine = -1;
    let nextColumn = 0;

    for (const match of initialMatches) {
        const { start, range } = match.info;
        if (start.line > currentLine) {
            currentLine = start.line;
            nextColumn = 0;
        }
        if (!useInlineLabels && start.character < nextColumn) {
            continue;
        }
        const width = match.label.length;
        const displayBefore = useInlineLabels || (start.character - width) >= nextColumn;
        nextColumn = range.end.character + (displayBefore ? 0 : width);
        filteredMatches.push({ label: match.label, info: match.info, displayBefore });
    }

    return filteredMatches;
}

function findAndHighlightMatches(editor: vscode.TextEditor): void {
    if (!searchString) {
        matches = [];
        clearDecorations(editor);
        return;
    }
    const rx = new RegExp(escapeRegExp(searchString), "gi");
    const infos: MatchInfo[] = [];
    for (const vr of editor.visibleRanges) {
        const slice = editor.document.getText(vr);
        const base = editor.document.offsetAt(vr.start);
        let m: RegExpExecArray | null;
        while ((m = rx.exec(slice))) {
            const startOff = base + m.index;
            const startPos = editor.document.positionAt(startOff);
            const endPos = editor.document.positionAt(startOff + searchString.length);
            infos.push({
                start: startPos,
                range: new vscode.Range(startPos, endPos),
                nextChar: getNextCharacter(editor, endPos),
                nextNextChar: getNextCharacter(editor, endPos.translate(0, 1))
            });
        }
    }
    matches = generateLabels(infos);
    updateDecorations(editor);
}

function updateDecorations(editor: vscode.TextEditor): void {
    const matchRanges: vscode.DecorationOptions[] = [];
    const labelDecorations: vscode.DecorationOptions[] = [];
    let line = 0;
    let count = matches.length;

    matches.forEach(match => {
        if (match.info.start.line > line) {
            line = match.info.start.line;
        }

        const width = match.label.length;
        const displayBefore = match.displayBefore;

        // Add match highlighting
        matchRanges.push({
            range: match.info.range
        });

        const labelPos = displayBefore ? match.info.start : match.info.range.end.translate(0, width);
        const overflow = labelPos.character - editor.document.lineAt(line).text.length;
        const shift = useInlineLabels ? 0 : Math.min(width, width - overflow);

        // Add label decoration
        labelDecorations.push({
            range: new vscode.Range(labelPos, labelPos),
            renderOptions: {
                before: {
                    width: `${width}ch`,
                    margin: `0 0 0 -${shift}ch`,
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
        quickPick.title = matchesExceeded ? `Too many matches!` : `${count} matches`;
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
    vscode.commands.executeCommand('setContext', 'code-jump.inJumpMode', false);
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
        vscode.commands.executeCommand('setContext', 'code-jump.inJumpMode', false);
        exitJumpMode(editor);
    }

    // Explicitly dispose decoration types
    matchDecorationType.dispose();
    labelDecorationType.dispose();
} 
