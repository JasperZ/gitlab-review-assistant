/**
 * Persisted configuration.
 *
 * Stored in `sync` so the rule list roams across machines. Note the whole list is
 * ONE storage item on purpose: that makes the binding constraint the 8 KB
 * per-item quota (roughly 100 rules) rather than the 512-item limit, and it keeps
 * a save to a single write against the 120-writes-per-minute throttle.
 *
 * Viewed state itself is NOT stored here and cannot be synced -- GitLab keeps it in
 * the page's localStorage, per browser. See README.
 */
import { storage } from 'wxt/utils/storage';
import { globsOf, isValidGlob } from './match';
import type { LegacyRule, MarkingOptions, Rule } from './types';

/** Applies to every project. Written explicitly rather than left blank. */
export const ALL_PROJECTS = '**';

/**
 * v2 gave each rule a list of globs instead of a single one; v3 renamed that list
 * from `patterns` to `globs`. Exported so `lib/transfer.ts` can assert the file
 * format it writes is the shape this schema reads.
 */
export const SCHEMA_VERSION = 3;

/**
 * The storage key stays `sync:patterns` across the v3 rename. It is the identity of
 * the data, not a description of it -- changing it would orphan every existing
 * configuration rather than migrate it.
 */
export const rulesItem = storage.defineItem<Rule[]>('sync:patterns', {
  fallback: [],
  version: SCHEMA_VERSION,
  migrations: {
    // WXT runs these when the extension updates. `loadRules` normalises on read as
    // well, because a manually reloaded unpacked extension is not a dependable trigger
    // and losing a configured rule list would be a nasty surprise.
    2: migrateList,
    3: migrateList,
  },
});

/** Both declared migrations are the same read-time coercion, applied to the whole list. */
function migrateList(old: unknown): Rule[] {
  return Array.isArray(old) ? old.map(normalizeRule).filter((r): r is Rule => r !== null) : [];
}

/**
 * Reproduces the behaviour that was hardcoded before these became configurable, so
 * upgrading changes nothing until the user opts in.
 */
export const DEFAULT_MARKING_OPTIONS: MarkingOptions = {
  markNewFiles: true,
  markDeletedFiles: false,
  markRenamedFiles: false,
  markSubmodules: false,
};

/**
 * Kept as its own storage item rather than folded into the rule list, so the rule
 * schema and its migration stay untouched. Both are tiny and well inside sync quotas.
 */
export const markingOptionsItem = storage.defineItem<MarkingOptions>('sync:marking', {
  fallback: DEFAULT_MARKING_OPTIONS,
  version: 1,
});

/**
 * Coerces per field rather than rejecting the whole object: a partially written or
 * hand-edited value should lose only the fields it got wrong, and a corrupt value must
 * never silently disable marking altogether.
 */
export function normalizeMarkingOptions(value: unknown): MarkingOptions {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_MARKING_OPTIONS };

  const candidate = value as Partial<Record<keyof MarkingOptions, unknown>>;
  const result = { ...DEFAULT_MARKING_OPTIONS };
  for (const key of Object.keys(DEFAULT_MARKING_OPTIONS) as Array<keyof MarkingOptions>) {
    if (typeof candidate[key] === 'boolean') result[key] = candidate[key];
  }
  return result;
}

export async function loadMarkingOptions(): Promise<MarkingOptions> {
  return normalizeMarkingOptions(await markingOptionsItem.getValue());
}

export async function saveMarkingOptions(options: MarkingOptions): Promise<void> {
  await markingOptionsItem.setValue(options);
}

export function newRule(): Rule {
  return { project: ALL_PROJECTS, globs: [], enabled: true };
}

export async function loadRules(): Promise<Rule[]> {
  const stored = await rulesItem.getValue();
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeRule).filter((r): r is Rule => r !== null);
}

export async function saveRules(rules: Rule[]): Promise<void> {
  await rulesItem.setValue(rules);
}

/**
 * Coerces a stored or imported entry into the current shape.
 *
 * Accepts all three field spellings a rule's glob list has had: `globs` (current),
 * `patterns` (v2) and a single `pattern` string (v1). Returns null for anything
 * unrecognisable, so one corrupt row cannot break the rest.
 */
export function normalizeRule(value: unknown): Rule | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<Rule> & Partial<LegacyRule>;

  if (typeof candidate.project !== 'string' || typeof candidate.enabled !== 'boolean') {
    return null;
  }

  const list = candidate.globs ?? candidate.patterns;
  const globs = Array.isArray(list)
    ? list.filter((g): g is string => typeof g === 'string')
    : typeof candidate.pattern === 'string'
      ? [candidate.pattern]
      : null;

  if (globs === null) return null;

  return { project: candidate.project, globs, enabled: candidate.enabled };
}

export interface RuleProblem {
  field: 'project' | 'globs';
  message: string;
}

/** Validation surfaced in the options UI. Empty array means the rule is fine. */
export function validateRule(rule: Rule): RuleProblem[] {
  const problems: RuleProblem[] = [];

  if (rule.project.trim() === '') {
    problems.push({ field: 'project', message: 'Required. Use ** for every project.' });
  } else if (!isValidGlob(rule.project)) {
    problems.push({ field: 'project', message: 'Not a valid glob.' });
  }

  const globs = globsOf(rule.globs);
  if (globs.length === 0) {
    problems.push({ field: 'globs', message: 'Required. One glob per line.' });
    return problems;
  }

  // Named rather than numbered: blank lines are dropped on save, so a line number
  // would stop matching what the user sees.
  for (const glob of globs) {
    if (!isValidGlob(glob)) {
      problems.push({ field: 'globs', message: `"${glob}" is not a valid glob.` });
    } else if (glob.startsWith('/')) {
      problems.push({
        field: 'globs',
        message: `"${glob}": a leading "/" is a literal slash in globs, not a repo-root anchor. It will be ignored.`,
      });
    }
  }

  return problems;
}

/**
 * Trailing-edge debounce. `storage.sync` throttles at 120 writes/minute, which a
 * naive save-on-every-keystroke blows through in seconds.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
