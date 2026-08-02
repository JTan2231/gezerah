export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const current = next[index];
  const other = next[target];
  if (current === undefined || other === undefined) return items;
  next[index] = other;
  next[target] = current;
  return next;
}
