import vscode from "vscode";

type Decorations = Record<"open" | "closed" | "pending", vscode.DecorationOptions[]>;
type IssueResponse = { state: "pending" | "open" | "closed"; timestamp: number };

const open = vscode.window.createTextEditorDecorationType({ after: { contentText: "🟢", margin: "0 0 0 1em" } });
const closed = vscode.window.createTextEditorDecorationType({ after: { contentText: "🔴", margin: "0 0 0 1em" } });
const pending = vscode.window.createTextEditorDecorationType({ after: { contentText: "🟡", margin: "0 0 0 1em" } });

const fetchIssue = async ({ url }: { url: string }): Promise<IssueResponse> => {
	const githubToken = await vscode.workspace.getConfiguration("issue-glimpse").get<string>("githubToken");
	const response = await fetch(url, {
		headers: { authorization: `token ${githubToken}`, accept: "application/vnd.github.v3+json" },
	});
	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`);
	}
	return (await response.json()) as IssueResponse;
};

const issueStatusCache = new Map<string, IssueResponse>();

const getStatus = async ({ url }: { url: string }): Promise<IssueResponse> => {
	let data = issueStatusCache.get(url);
	if (!data || Date.now() - data.timestamp > 300_000) {
		try {
			data = await fetchIssue({ url });
			issueStatusCache.set(url, { ...data, timestamp: Date.now() });
		} catch {
			issueStatusCache.set(url, { state: "pending", timestamp: Date.now() });
			data = issueStatusCache.get(url);
		}
	}
	if (!data) {
		throw new Error("No data for issue!");
	}
	return data;
};

const applyDecorations = async ({ editor }: { editor: vscode.TextEditor }) => {
	const text = editor.document.getText();
	const regex = /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/gi;
	const decorations: Decorations = { open: [], closed: [], pending: [] };

	const matches = [...text.matchAll(regex)];
	const decorationTypes = await Promise.all(
		matches.map(async (match) => {
			const url = `https://api.github.com/repos/${match[1]}/issues/${match[2]}`;
			const status = await getStatus({ url });
			const decorationType = status.state === "open" ? open : status.state === "pending" ? pending : closed;
			return {
				decorationName: status.state,
				decorationType,
				range: new vscode.Range(
					editor.document.positionAt(match.index),
					editor.document.positionAt(match.index + match[0].length),
				),
			};
		}),
	);

	for (const { decorationName, range } of decorationTypes) {
		if (decorations[decorationName]) {
			decorations[decorationName].push({ range });
		} else {
			console.error(`Unexpected decoration type: ${decorationName}`);
		}
	}

	editor.setDecorations(open, decorations.open);
	editor.setDecorations(closed, decorations.closed);
	editor.setDecorations(pending, decorations.pending);
};

const getGithubToken = async (): Promise<string> => {
	let githubToken = await vscode.workspace.getConfiguration("issue-glimpse").get("githubToken");
	if (!githubToken) {
		githubToken = await vscode.window.showInputBox({
			placeHolder: "Enter your GitHub token",
			prompt: "Token is needed to access GitHub issues",
			ignoreFocusOut: true,
		});
		await vscode.workspace.getConfiguration("issue-glimpse").update("githubToken", githubToken, true);
	}
	if (typeof githubToken !== "string") {
		throw new Error("Invalid GitHub token");
	}
	return githubToken;
};

const activate = async (_context: vscode.ExtensionContext) => {
	await getGithubToken();

	vscode.workspace.onDidChangeTextDocument((event) => {
		const editor = vscode.window.activeTextEditor;
		if (editor && event.document === editor.document) {
			applyDecorations({ editor });
		}
	});

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor) {
			applyDecorations({ editor });
		}
	});

	if (vscode.window.activeTextEditor) {
		applyDecorations({ editor: vscode.window.activeTextEditor });
	}
};

export { activate };
