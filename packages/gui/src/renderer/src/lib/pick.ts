/**
 * Look up a value in a string-keyed record by a runtime-computed key that TS
 * cannot narrow to the record's key union. Returns the value, or `undefined`
 * when the key is absent.
 *
 * This centralizes the one cast the renderer would otherwise repeat inline:
 * indexing a const object (a page map, a message map, an error-code map) by a
 * dynamic string is a `TS7053` without a widening, so each call site would carry
 * its own inline `any` cast. Passing through here does the widening once, in one
 * audited spot, and hands back a typed value-or-`undefined`.
 */
export function pick<V>(record: Record<string, V>, key: string): V | undefined {
  return record[key];
}
