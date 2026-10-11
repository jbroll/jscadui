/**
 * Append items whose name has not been seen, preserving first-wins order.
 * Anonymous items (empty name) always pass and are not recorded.
 */
export function dedupeByName<T>(
  items: T[],
  names: string[],
  seen: Set<string>,
  out: T[],
  keptNames?: string[],
): void {
  for (let i = 0; i < items.length; i++) {
    const name = names[i]
    if (!name || !seen.has(name)) {
      if (name) seen.add(name)
      out.push(items[i])
      if (keptNames) keptNames.push(name ?? '')
    }
  }
}
