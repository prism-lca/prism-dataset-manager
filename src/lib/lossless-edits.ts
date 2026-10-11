/** Apply only differences in the form projection to the retained document. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]))
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]))
  }
  return false
}
function isObject(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) }
function hasExtra(original: unknown, projected: unknown): boolean {
  if (isObject(original) && isObject(projected) && typeof projected.lang === 'string' && typeof projected.text === 'string' && Object.keys(original).some(k => !['lang','text'].includes(k))) return true
  if (isObject(original) && isObject(projected)) return Object.keys(original).some(k => !Object.hasOwn(projected, k) || hasExtra(original[k], projected[k]))
  if (Array.isArray(original) && Array.isArray(projected)) return original.some((v, i) => hasExtra(v, projected[i]))
  return original !== undefined && projected === undefined
}
function itemKey(v: unknown): string | undefined {
  if (!isObject(v)) return undefined
  if (v.dataSetInternalID != null) return `id:${v.dataSetInternalID}`
  if (typeof v.lang === 'string') return `lang:${v.lang}`
  return undefined
}
export interface EditResult { payload: Record<string, unknown>; removedExtraPaths: string[] }
export function applyFormEdits(original: Record<string, unknown>, before: unknown, after: unknown): EditResult {
  const removedExtraPaths: string[] = []
  function apply(raw: unknown, old: unknown, next: unknown, path: string): unknown {
    if (sameJson(old, next)) return structuredClone(raw)
    if (isObject(old) && isObject(next)) {
      const out = isObject(raw) ? structuredClone(raw) : {}
      for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (sameJson(old[key], next[key])) continue
        if (!Object.hasOwn(next, key)) { if (hasExtra(out[key], old[key])) removedExtraPaths.push(`${path}/${key}`); delete out[key] }
        else out[key] = apply(out[key], old[key], next[key], `${path}/${key}`)
      }
      return out
    }
    if (Array.isArray(old) && Array.isArray(next)) {
      const source = Array.isArray(raw) ? raw : []
      const used = new Set<number>()
      const matches = next.map((value) => {
        const key = itemKey(value)
        const index = key === undefined ? old.findIndex((v, i) => !used.has(i) && (v === value || sameJson(v, value))) : old.findIndex(v => itemKey(v) === key)
        if (index >= 0 && used.has(index)) throw new Error(`Duplicate item identity at ${path}.`)
        if (index >= 0) used.add(index)
        return index
      })
      // Remaining object replacements can be paired only when unambiguous.
      const unmatchedOld = old.map((_, i) => i).filter(i => !used.has(i))
      const replacements = matches.map((v, i) => v === -1 && itemKey(next[i]) === undefined ? i : -1).filter(i => i >= 0)
      if (replacements.length > 1 && unmatchedOld.some(i => hasExtra(source[i], old[i]))) {
        throw new Error(`Cannot safely identify edited items at ${path}. Edit unkeyed items one at a time.`)
      }
      if (replacements.length === unmatchedOld.length) {
        replacements.forEach((index, i) => { matches[index] = unmatchedOld[i]; used.add(unmatchedOld[i]) })
      } else if (replacements.length && unmatchedOld.some(i => hasExtra(source[i], old[i]))) {
        throw new Error(`Cannot safely identify edited items at ${path}. Keep the original items or edit them separately.`)
      }
      old.forEach((v, i) => { if (!used.has(i) && hasExtra(source[i], v)) removedExtraPaths.push(`${path}/${i}`) })
      return next.map((v, i) => matches[i] < 0 ? structuredClone(v) : apply(source[matches[i]], old[matches[i]], v, `${path}/${matches[i]}`))
    }
    return structuredClone(next)
  }
  return { payload: apply(original, before, after, '') as Record<string, unknown>, removedExtraPaths }
}
