import { execSync } from "node:child_process";
import type { GitStatus, GitCommit, GitBranch, GitDiff } from "./types.js";

function git(repoPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: repoPath,
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export class GitOps {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async getStatus(): Promise<GitStatus> {
    const branch = git(this.repoPath, "rev-parse --abbrev-ref HEAD");
    const statusOutput = git(this.repoPath, "status --porcelain=v1");

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of statusOutput.split("\n").filter(Boolean)) {
      const indexStatus = line[0] ?? " ";
      const workTreeStatus = line[1] ?? " ";
      const filePath = line.slice(3);

      if (indexStatus !== " " && indexStatus !== "?") {
        staged.push(filePath);
      }
      if (workTreeStatus !== " " && workTreeStatus !== "?") {
        modified.push(filePath);
      }
      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.push(filePath);
      }
    }

    return {
      branch,
      staged,
      modified,
      untracked,
      clean: staged.length === 0 && modified.length === 0 && untracked.length === 0,
    };
  }

  async commit(message: string, files?: string[]): Promise<GitCommit> {
    if (files && files.length > 0) {
      // Stage specific files
      for (const file of files) {
        git(this.repoPath, `add -- ${JSON.stringify(file)}`);
      }
    }

    // Use HEREDOC-style message to avoid shell injection
    const escapedMsg = message.replace(/'/g, "'\\''");
    git(this.repoPath, `commit -m '${escapedMsg}' --author="AI Harness <ai@aiharness.dev>"`);

    const hash = git(this.repoPath, "rev-parse HEAD");
    const author = git(this.repoPath, "log -1 --format=%an");
    const dateStr = git(this.repoPath, "log -1 --format=%aI");

    return {
      hash,
      message,
      author,
      date: new Date(dateStr),
    };
  }

  async createBranch(name: string): Promise<void> {
    git(this.repoPath, `checkout -b ${JSON.stringify(name)}`);
  }

  async switchBranch(name: string): Promise<void> {
    git(this.repoPath, `checkout ${JSON.stringify(name)}`);
  }

  async listBranches(): Promise<GitBranch[]> {
    const output = git(this.repoPath, "branch --format=%(refname:short)");
    const current = git(this.repoPath, "rev-parse --abbrev-ref HEAD");

    return output.split("\n").filter(Boolean).map((name) => ({
      name,
      current: name === current,
    }));
  }

  async getDiff(from?: string, to?: string): Promise<GitDiff[]> {
    const range = from && to ? `${from}..${to}` : from ? `${from}..HEAD` : "HEAD";
    const output = git(this.repoPath, `diff --numstat ${range}`);

    const diffs: GitDiff[] = [];
    for (const line of output.split("\n").filter(Boolean)) {
      const parts = line.split("\t");
      const additions = parseInt(parts[0] ?? "0", 10) || 0;
      const deletions = parseInt(parts[1] ?? "0", 10) || 0;
      const file = parts[2] ?? "";
      diffs.push({ file, additions, deletions, hunks: [] });
    }
    return diffs;
  }

  async getLog(maxCount: number = 10): Promise<GitCommit[]> {
    const output = git(this.repoPath, `log -${maxCount} --format=%H|%s|%an|%aI`);

    return output.split("\n").filter(Boolean).map((line) => {
      const [hash, message, author, dateStr] = line.split("|");
      return {
        hash: hash!,
        message: message!,
        author: author!,
        date: new Date(dateStr!),
      };
    });
  }

  async stage(files: string[]): Promise<void> {
    for (const file of files) {
      git(this.repoPath, `add -- ${JSON.stringify(file)}`);
    }
  }

  async unstage(files: string[]): Promise<void> {
    for (const file of files) {
      git(this.repoPath, `reset HEAD -- ${JSON.stringify(file)}`);
    }
  }
}
