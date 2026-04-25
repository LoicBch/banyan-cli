export function worktreePath(repoPath: string, feature: string): string {
  return `${repoPath}-${feature}`;
}

export function branchName(feature: string): string {
  return `feature/${feature}`;
}

export function windowName(targetName: string, feature: string): string {
  return `${targetName}-${feature}`;
}

export function sessionName(projectName: string): string {
  return projectName;
}

export function agentsWindowName(projectName: string): string {
  return `agents-${projectName}`;
}
