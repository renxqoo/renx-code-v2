export class ToolApprovalStore {
  private readonly turnApprovals = new Set<string>();
  private readonly sessionApprovals = new Set<string>();

  has(key: string): boolean {
    return this.turnApprovals.has(key) || this.sessionApprovals.has(key);
  }

  grant(key: string, scope: 'turn' | 'session'): void {
    if (scope === 'session') {
      this.sessionApprovals.add(key);
      return;
    }
    this.turnApprovals.add(key);
  }

  clearTurn(): void {
    this.turnApprovals.clear();
  }
}
