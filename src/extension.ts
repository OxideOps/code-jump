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
const labelChars: string[] = Array.from('JFKDLSHGAYTNBURMVIECOXWPZQ');

// Configuration options
let useInlineLabels: boolean = false;

// Added dynamic declarations:
let decorationColor: string = '#569cd6';
let matchDecorationType: vscode.TextEditorDecorationType;
let labelDecorationType: vscode.TextEditorDecorationType;

// Create decoration types given a base color
function createDecorationTypes(color: string): [vscode.TextEditorDecorationType, vscode.TextEditorDecorationType] {
    const match = vscode.window.createTextEditorDecorationType({
        border: `2px solid ${color}`,
        backgroundColor: `${color}40`,
    });
    const label = vscode.window.createTextEditorDecorationType({
        before: {
            backgroundColor: color,
            color: 'white',
            fontWeight: 'bold',
            fontStyle: 'normal',
        }
    });
    return [match, label];
}

export function activate(context: vscode.ExtensionContext): void {
    // Load configuration
    const config = vscode.workspace.getConfiguration('code-jump');
    useInlineLabels = config.get<boolean>('inlineLabels') || false;
    // Load decoration color and create decoration types
    decorationColor = config.get<string>('decorationColor') || decorationColor;
    [matchDecorationType, labelDecorationType] = createDecorationTypes(decorationColor);

    // Watch for configuration changes
    const configDisposable = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('code-jump.inlineLabels')) {
            const config = vscode.workspace.getConfiguration('code-jump');
            useInlineLabels = config.get<boolean>('inlineLabels') || false;
        }
        // Handle decoration color changes
        if (e.affectsConfiguration('code-jump.decorationColor')) {
            const config = vscode.workspace.getConfiguration('code-jump');
            decorationColor = config.get<string>('decorationColor') || decorationColor;
            // Recreate decoration types with new color
            matchDecorationType.dispose();
            labelDecorationType.dispose();
            [matchDecorationType, labelDecorationType] = createDecorationTypes(decorationColor);
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                updateDecorations(activeEditor);
            }
        }
    });

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
                editQuickPick(value[value.length - 1]);
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
        matchDecorationType,
        labelDecorationType,
        configDisposable,
        startJumpDisposable,
        escJumpDisposable
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
    const nextChars = new Set(matchInfos.map(match => match.nextChar));
    const count = matchInfos.length;
    if (count === 0) {
        matchesExceeded = false;
        return [];
    }
    const firstCharCandidates = labelChars.filter(char => !nextChars.has(char));
    if (firstCharCandidates.length === 0) {
        matchesExceeded = true;
        return [];
    }
    const labels = Array.from({ length: count }, (_, i) => firstCharCandidates[i % firstCharCandidates.length]);

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
                const set = new Set(labelChars);
                indices.forEach(i => set.delete(matchInfos[i].nextNextChar));
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
        matchesExceeded = false;
        clearDecorations(editor);
        if (quickPick) {
            quickPick.title = ``;
        }
        return;
    }
    const infos: MatchInfo[] = [];
    const needle = searchString.toUpperCase();
    for (const vr of editor.visibleRanges) {
        const slice = editor.document.getText(vr).toUpperCase();
        const base = editor.document.offsetAt(vr.start);
        let index = 0;
        while ((index = slice.indexOf(needle, index)) >= 0) {
            const startOff = base + index;
            const startPos = editor.document.positionAt(startOff);
            const endPos = editor.document.positionAt(startOff + needle.length);
            infos.push({
                start: startPos,
                range: new vscode.Range(startPos, endPos),
                nextChar: getNextCharacter(editor, endPos),
                nextNextChar: getNextCharacter(editor, endPos.translate(0, 1))
            });
            index += needle.length;
        }
    }
    matches = generateLabels(infos);
    updateDecorations(editor);
    if (quickPick) {
        quickPick.title = matchesExceeded ? `Too many matches!` : ``;
    }
}

function updateDecorations(editor: vscode.TextEditor): void {
    const matchRanges: vscode.DecorationOptions[] = [];
    const labelDecorations: vscode.DecorationOptions[] = [];
    let line = -1;
    let lineLength = 0;

    matches.forEach(match => {
        if (match.info.start.line > line) {
            line = match.info.start.line;
            lineLength = editor.document.lineAt(line).text.length;
        }

        const width = match.label.length;
        const displayBefore = match.displayBefore;

        // Add match highlighting
        matchRanges.push({
            range: match.info.range
        });

        const labelPos = displayBefore ? match.info.start : match.info.range.end.translate(0, width);
        const overflow = labelPos.character - lineLength;
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
}

function getNextCharacter(editor: vscode.TextEditor, position: vscode.Position): string {
    // Get the character after the match, if possible
    try {
        const nextPos = position.translate(0, 1);
        const range = new vscode.Range(position, nextPos);
        return editor.document.getText(range).toUpperCase();
    } catch {
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

export function deactivate(): void {
    // Clean up any remaining state
    const editor = vscode.window.activeTextEditor;
    if (editor && inJumpMode) {
        exitJumpMode(editor);
    }
} 
