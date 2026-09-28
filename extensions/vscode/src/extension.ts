import * as vscode from "vscode";
import { io, Socket } from "socket.io-client";

interface Task {
  id: string;
  goal: string;
  state: string;
  workspaceId: string;
}

interface PendingApproval {
  taskRunId: string;
  taskId: string;
  toolName: string;
  riskLevel: string;
  approvalId: string;
}

interface DiagnosticEntry {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning" | "info";
}

let tasksTreeView: vscode.TreeView<Task | PendingApproval>;
let chatViewProvider: ChatWebviewProvider;
let statusBar: vscode.StatusBarItem;
let serverUrl: string;
let apiToken: string;
let extensionContext: vscode.ExtensionContext;

let socket: Socket | null = null;
let diagnosticCollection: vscode.DiagnosticCollection;
const disposables: vscode.Disposable[] = [];

export async function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  serverUrl = vscode.workspace.getConfiguration("ai-harness").get("serverUrl", "http://localhost:4010");
  apiToken = (await context.secrets.get("ai-harness.apiToken")) ?? "";

  diagnosticCollection = vscode.languages.createDiagnosticCollection("ai-harness");
  disposables.push(diagnosticCollection);

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "$(robot) AI Harness";
  statusBar.tooltip = "Click to connect";
  statusBar.command = "ai-harness.connect";
  context.subscriptions.push(statusBar);
  statusBar.show();

  // Tree view
  tasksTreeView = vscode.window.createTreeView("ai-harness.tasks", {
    treeDataProvider: new TasksTreeProvider(),
  });
  context.subscriptions.push(tasksTreeView);

  // Chat webview
  chatViewProvider = new ChatWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("ai-harness.chat", chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Commands
  disposables.push(
    vscode.commands.registerCommand("ai-harness.connect", connectToServer)
  );
  disposables.push(
    vscode.commands.registerCommand("ai-harness.newTask", createNewTask)
  );
  disposables.push(
    vscode.commands.registerCommand("ai-harness.approve", approveAction)
  );
  disposables.push(
    vscode.commands.registerCommand("ai-harness.deny", denyAction)
  );
  disposables.push(
    vscode.commands.registerCommand("ai-harness.openChat", () => {
      vscode.commands.executeCommand("ai-harness.chat.focus");
    })
  );
  disposables.push(
    vscode.commands.registerCommand("ai-harness.showDiagnostics", showDiagnostics)
  );
  context.subscriptions.push(...disposables);

  // Watch for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ai-harness")) {
        serverUrl = vscode.workspace.getConfiguration("ai-harness").get("serverUrl", "http://localhost:4010");
        apiToken = vscode.workspace.getConfiguration("ai-harness").get("apiToken", "");
        if (socket?.connected) socket.disconnect();
        connectWebSocket();
      }
    })
  );
}

function connectWebSocket() {
  if (socket?.connected) {
    socket.disconnect();
  }

  const wsUrl = serverUrl.replace(/^http/, "ws");

  socket = io(wsUrl, {
    auth: apiToken ? { token: apiToken } : undefined,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    statusBar.text = "$(robot) AI Harness (Connected)";
    statusBar.tooltip = `Connected to ${serverUrl}`;
    statusBar.backgroundColor = undefined;
    vscode.window.showInformationMessage(`AI Harness connected to ${serverUrl}`);

    socket!.emit("subscribe:tasks", { workspaceId: getWorkspaceId() });
  });

  socket.on("disconnect", (reason) => {
    statusBar.text = "$(robot) AI Harness (Disconnected)";
    statusBar.tooltip = `Disconnected: ${reason}`;
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  });

  socket.on("connect_error", (err) => {
    statusBar.text = "$(robot) AI Harness (Error)";
    statusBar.tooltip = `Connection error: ${err.message}`;
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  });

  socket.on("task:created", (task: Task) => {
    vscode.window.showInformationMessage(`New task: ${task.goal}`);
    (tasksTreeView as any).refresh?.();
    chatViewProvider.postMessage({ type: "taskEvent", event: "created", task });
  });

  socket.on("task:updated", (task: Task) => {
    (tasksTreeView as any).refresh?.();
    chatViewProvider.postMessage({ type: "taskEvent", event: "updated", task });
  });

  socket.on("task:completed", (task: Task) => {
    vscode.window.showInformationMessage(`Task completed: ${task.goal}`);
    (tasksTreeView as any).refresh?.();
    chatViewProvider.postMessage({ type: "taskEvent", event: "completed", task });
  });

  socket.on("task:failed", (task: Task & { error?: string }) => {
    vscode.window.showErrorMessage(`Task failed: ${task.goal}${task.error ? ` - ${task.error}` : ""}`);
    (tasksTreeView as any).refresh?.();
    chatViewProvider.postMessage({ type: "taskEvent", event: "failed", task });
  });

  socket.on("approval:requested", (approval: PendingApproval) => {
    const message = `Approval required: ${approval.toolName} (${approval.riskLevel} risk)`;
    vscode.window.showWarningMessage(message, "Approve", "Deny").then((choice) => {
      if (choice === "Approve") {
        vscode.commands.executeCommand("ai-harness.approve", approval);
      } else if (choice === "Deny") {
        vscode.commands.executeCommand("ai-harness.deny", approval);
      }
    });
    (tasksTreeView as any).refresh?.();
    chatViewProvider.postMessage({ type: "taskEvent", event: "approval", approval });
  });

  socket.on("diagnostics", (entries: DiagnosticEntry[]) => {
    applyDiagnostics(entries);
  });

  socket.on("chat:message", (msg: { role: string; content: string; taskId?: string }) => {
    chatViewProvider.postMessage({ type: "chatMessage", ...msg });
  });
}

function applyDiagnostics(entries: DiagnosticEntry[]) {
  const diagnosticsMap = new Map<string, vscode.Diagnostic[]>();

  for (const entry of entries) {
    const uri = vscode.Uri.file(entry.file);
    const key = uri.toString();

    const range = new vscode.Range(
      new vscode.Position(Math.max(0, entry.line - 1), Math.max(0, entry.column)),
      new vscode.Position(Math.max(0, entry.line - 1), Number.MAX_SAFE_INTEGER)
    );

    const severity =
      entry.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : entry.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;

    const diagnostic = new vscode.Diagnostic(range, entry.message, severity);
    diagnostic.source = "ai-harness";

    if (!diagnosticsMap.has(key)) {
      diagnosticsMap.set(key, []);
    }
    diagnosticsMap.get(key)!.push(diagnostic);
  }

  diagnosticCollection.clear();
  for (const [fileUri, diags] of diagnosticsMap) {
    diagnosticCollection.set(vscode.Uri.parse(fileUri), diags);
  }
}

function showDiagnostics() {
  const allDiags: vscode.Diagnostic[] = [];
  for (const diagList of diagnosticCollection) {
    allDiags.push(...diagList[1]);
  }

  if (allDiags.length === 0) {
    vscode.window.showInformationMessage("No AI Harness diagnostics to display.");
    return;
  }

  const items = allDiags.map((d) => ({
    label: `$(warning) ${d.message}`,
    description: d.source,
    diagnostic: d,
  }));

  vscode.window.showQuickPick(items, {
    placeHolder: "AI Harness Diagnostics",
  });
}

function getWorkspaceId(): string {
  const configured = vscode.workspace.getConfiguration("ai-harness").get<string>("workspaceId", "");
  if (configured) return configured;
  return "";
}

async function connectToServer() {
  const url = await vscode.window.showInputBox({
    prompt: "Enter AI Harness Gateway URL",
    value: serverUrl,
    validateInput: (value) => {
      try {
        new URL(value);
        return null;
      } catch (err) {
        console.error("[VSCode] URL validation failed:", err);
        return "Please enter a valid URL";
      }
    },
  });

  if (!url) return;

  const token = await vscode.window.showInputBox({
    prompt: "Enter API token (optional)",
    value: apiToken,
    password: true,
  });

  if (token === undefined) return;

  serverUrl = url;
  apiToken = token;

  await vscode.workspace.getConfiguration("ai-harness").update("serverUrl", url, true);
  if (token) {
    await extensionContext.secrets.store("ai-harness.apiToken", token);
  } else {
    await extensionContext.secrets.delete("ai-harness.apiToken");
  }

  connectWebSocket();
}

async function createNewTask() {
  const goal = await vscode.window.showInputBox({
    prompt: "Describe the task for AI to complete",
    placeHolder: "e.g., Add user authentication with JWT tokens",
  });

  if (!goal) return;

  try {
    const response = await fetch(`${serverUrl}/v1/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({
        goal,
        workspaceId: getWorkspaceId(),
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const task = (await response.json()) as { data: Task };
    vscode.window.showInformationMessage(`Task created: ${task.data.goal}`);

    const frontendUrl = vscode.workspace.getConfiguration("ai-harness").get("frontendUrl", "http://localhost:3000");
    vscode.env.openExternal(vscode.Uri.parse(`${frontendUrl}/tasks/${task.data.id}`));
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to create task: ${err}`);
  }
}

async function approveAction(approval: PendingApproval) {
  try {
    const response = await fetch(`${serverUrl}/v1/approvals/${approval.approvalId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    vscode.window.showInformationMessage(`Approved: ${approval.toolName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to approve: ${err}`);
  }
}

async function denyAction(approval: PendingApproval) {
  const reason = await vscode.window.showInputBox({
    prompt: "Reason for denial (optional)",
  });

  if (reason === undefined) return;

  try {
    const response = await fetch(`${serverUrl}/v1/approvals/${approval.approvalId}/deny`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    vscode.window.showInformationMessage(`Denied: ${approval.toolName}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to deny: ${err}`);
  }
}

class TasksTreeProvider implements vscode.TreeDataProvider<Task | PendingApproval> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Task | PendingApproval | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Task | PendingApproval): vscode.TreeItem {
    if ("toolName" in element) {
      const item = new vscode.TreeItem(`Pending: ${element.toolName}`, vscode.TreeItemCollapsibleState.None);
      item.description = element.riskLevel;
      item.contextValue = "pendingApproval";
      item.iconPath = new vscode.ThemeIcon("warning");
      return item;
    }

    const item = new vscode.TreeItem(element.goal, vscode.TreeItemCollapsibleState.None);
    item.description = element.state;
    item.contextValue = "task";
    item.iconPath = new vscode.ThemeIcon(
      element.state === "RUNNING" ? "sync~spin" :
      element.state === "COMPLETED" ? "check" :
      element.state === "FAILED" ? "error" :
      "circle-outline"
    );
    return item;
  }

  async getChildren(element?: Task | PendingApproval): Promise<(Task | PendingApproval)[]> {
    if (element) return [];

    try {
      const response = await fetch(`${serverUrl}/v1/tasks?limit=20`, {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      });

      if (!response.ok) {
        return [{ id: "error", goal: `Failed to load tasks (${response.status})`, state: "FAILED" } as Task];
      }

      const result = (await response.json()) as { data: Task[] };
      const tasks = result.data ?? [];
      if (tasks.length === 0) {
        return [{ id: "empty", goal: "No tasks found. Create a task to get started.", state: "COMPLETED" } as Task];
      }
      return tasks;
    } catch (err) {
      console.error("[VSCode] Failed to fetch tasks:", err);
      return [{ id: "error", goal: "Unable to connect to AI Harness server", state: "FAILED" } as Task];
    }
  }
}

class ChatWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _messageListeners: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    this._messageListeners.push(
      webviewView.webview.onDidReceiveMessage((message) => {
        this._handleMessage(message);
      })
    );

    webviewView.onDidDispose(() => {
      this._messageListeners.forEach((d) => d.dispose());
      this._view = undefined;
    });
  }

  postMessage(msg: Record<string, unknown>) {
    if (this._view) {
      this._view.webview.postMessage(msg);
    }
  }

  private _handleMessage(message: { type: string; text?: string; taskId?: string }) {
    if (message.type === "sendMessage" && message.text) {
      if (socket?.connected) {
        socket.emit("chat:send", {
          content: message.text,
          workspaceId: getWorkspaceId(),
          taskId: message.taskId,
        });
      } else {
        this.postMessage({ type: "chatMessage", role: "system", content: "Not connected to server." });
      }
    }

    if (message.type === "requestDiagnostics") {
      vscode.commands.executeCommand("ai-harness.showDiagnostics");
    }
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "src", "chat.css")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <title>AI Harness Chat</title>
  <style>
    body { margin: 0; padding: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    #chat-container { display: flex; flex-direction: column; height: 100vh; }
    #messages { flex: 1; overflow-y: auto; padding: 8px; }
    .message { margin-bottom: 8px; padding: 8px 12px; border-radius: 6px; max-width: 90%; word-wrap: break-word; }
    .message.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); margin-left: auto; text-align: right; }
    .message.assistant { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); }
    .message.system { background: var(--vscode-inputValidation-warningBackground); font-style: italic; font-size: 0.9em; text-align: center; }
    .task-event { font-size: 0.85em; padding: 4px 8px; margin-bottom: 4px; border-left: 3px solid var(--vscode-charts-blue); background: var(--vscode-editor-inactiveSelectionBackground); }
    #input-area { display: flex; padding: 8px; gap: 8px; border-top: 1px solid var(--vscode-editorWidget-border); }
    #user-input { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: inherit; font-size: inherit; resize: none; }
    #user-input:focus { outline: 1px solid var(--vscode-focusBorder); }
    #send-btn { padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; }
    #send-btn:hover { background: var(--vscode-button-hoverBackground); }
    #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { padding: 4px 8px; font-size: 0.8em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-editorWidget-border); }
    .spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="chat-container">
    <div id="messages"></div>
    <div id="status">Disconnected</div>
    <div id="input-area">
      <textarea id="user-input" placeholder="Ask the AI agent..." rows="1"></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const statusEl = document.getElementById('status');

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = content;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addTaskEvent(event, data) {
      const div = document.createElement('div');
      div.className = 'task-event';
      const label = event === 'approval' ? 'Approval Required' : 'Task ' + event;
      const detail = event === 'approval' ? data.toolName + ' (' + data.riskLevel + ')' : (data.goal || data.id);
      div.textContent = label + ': ' + detail;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setStatus(text, connected) {
      statusEl.textContent = text;
      statusEl.style.color = connected
        ? 'var(--vscode-charts-green)'
        : 'var(--vscode-charts-red)';
    }

    sendBtn.addEventListener('click', () => {
      const text = inputEl.value.trim();
      if (!text) return;
      addMessage('user', text);
      vscode.postMessage({ type: 'sendMessage', text });
      inputEl.value = '';
      inputEl.style.height = 'auto';
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'chatMessage') {
        addMessage(msg.role || 'assistant', msg.content);
      } else if (msg.type === 'taskEvent') {
        addTaskEvent(msg.event, msg.task || msg.approval);
      } else if (msg.type === 'status') {
        setStatus(msg.text, msg.connected);
      }
    });

    setStatus('Disconnected', false);
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

export function deactivate() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  for (const d of disposables) d.dispose();
}

