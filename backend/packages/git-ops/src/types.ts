export interface GitStatus {
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  clean: boolean;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
}

export interface GitDiff {
  file: string;
  additions: number;
  deletions: number;
  hunks: string[];
}
