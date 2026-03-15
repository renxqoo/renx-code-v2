export function generateId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function hasNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
