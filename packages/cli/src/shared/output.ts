export function toJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
