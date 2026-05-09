/**
 * deepMerge — small typed helper used by ProjectManager when loading saved
 * project records. Fills in fields that exist in the default template but are
 * absent from the loaded payload (legacy DB records), without overwriting
 * anything the loaded record actually carries.
 *
 * Semantics:
 *  - Only plain objects (POJOs) recurse. Arrays, primitives, null, Date, and
 *    class instances are TREATED AS LEAVES and copied through whole — the
 *    override value wins outright when present.
 *  - Per-array-element field defaulting is intentionally NOT done here: array
 *    indices have no semantic meaning across schema versions. If you need a
 *    new field on every element of a legacy array (e.g. CostLineItem.feeRatePercent),
 *    add an explicit step to migratePersistedState — that's Layer B.
 *  - Override-only keys are preserved (forward-compat: extra fields ride
 *    through untouched).
 *  - Missing-in-override keys are deep-cloned from the default so the loaded
 *    project cannot accidentally share mutable references with the default
 *    template.
 *
 * Use case: load(rec) → normalize(rec, defaults) → migrate(normalized) →
 * replace(normalized).
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  // Reject Date, Map, Set, class instances, etc. — only walk literal objects.
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function deepCloneLeaf<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(item => deepCloneLeaf(item)) as unknown as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepCloneLeaf(val);
    return out as unknown as T;
  }
  // Date, Map, Set, class instances — return as-is. Defaults shouldn't carry
  // mutable instances, but if they do the caller will need to handle it.
  return v;
}

/**
 * Deep-merge `override` over `base`.
 *
 * - Both must be plain objects at the top level (caller guarantees).
 * - Returns a NEW object — neither input is mutated.
 * - Plain-object values recurse; everything else (arrays, primitives, Dates,
 *   class instances) is treated as a leaf and the override wins when present.
 */
export function deepMerge<T extends object>(
  base: T,
  override: Partial<T> | undefined | null,
): T {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return deepCloneLeaf(base);
  }

  const out: Record<string, unknown> = {};
  // Walk keys from `base` first — fill defaults for fields the loaded record is missing.
  for (const [key, baseVal] of Object.entries(base as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) {
      out[key] = deepCloneLeaf(baseVal);
      continue;
    }
    const overrideVal = (override as Record<string, unknown>)[key];
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      out[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      // override wins outright (arrays, primitives, null/undefined explicit)
      out[key] = overrideVal;
    }
  }
  // Forward-compat: keep override-only keys we don't know about. The loaded
  // record may carry fields from a future schema version; passing them through
  // is safer than silently dropping them.
  for (const key of Object.keys(override as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) {
      out[key] = (override as Record<string, unknown>)[key];
    }
  }
  return out as T;
}
