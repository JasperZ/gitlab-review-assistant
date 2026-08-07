/**
 * Reading and writing the whole configuration as a file.
 *
 * Pure: no DOM, no pickers, no storage. The options page owns the user gesture and the
 * file handles; everything here is string in, data out, so it can be tested directly.
 *
 * Import is deliberately forgiving. A config file is something people hand-edit, copy
 * between machines and commit to a repo, so anything recognisable should load — and
 * anything that is not should say why rather than silently importing nothing.
 */
import {
  DEFAULT_MARKING_OPTIONS,
  SCHEMA_VERSION,
  normalizeMarkingOptions,
  normalizeRule,
} from './settings';
import type { MarkingOptions, Rule } from './types';

/** Identifies our files. Descriptive only — never validated, so it can change freely. */
export const FILE_SCHEMA = 'gitlab-review-assistant/settings';

/**
 * Derived, not copied. The file carries whatever the rule schema is currently at, so
 * the two cannot drift -- a stale literal here would label a v3 file as v2 and make
 * `parseSettingsFile` miss the "written by a newer version" warning it exists to give.
 */
export const FILE_VERSION = SCHEMA_VERSION;

export const DEFAULT_FILENAME = 'gitlab-review-assistant-settings.json';

export interface SettingsFile {
  $schema: string;
  version: number;
  marking: MarkingOptions;
  rules: Rule[];
}

export interface ParseSuccess {
  ok: true;
  rules: Rule[];
  marking: MarkingOptions;
  /** Entries that could not be understood and were left out. */
  skipped: number;
  /** Non-fatal note, e.g. the file came from a newer version. */
  warning?: string;
}

export interface ParseFailure {
  ok: false;
  /** Why the file was rejected, phrased for the user. */
  reason: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

/** Serialises to pretty JSON with a trailing newline, so the file diffs cleanly in git. */
export function serializeSettings(rules: readonly Rule[], marking: MarkingOptions): string {
  const file: SettingsFile = {
    $schema: FILE_SCHEMA,
    version: FILE_VERSION,
    marking,
    rules: [...rules],
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Parses an exported file, a bare array, or anything close enough.
 *
 * Never throws — a bad file is a normal outcome the UI has to explain, not an exception.
 * Every entry goes through `normalizeRule`, which accepts every glob-list spelling this
 * extension has written, so older exports and hand-written files both work. A file with
 * no `marking` block — including every file exported before it existed — falls back to
 * defaults.
 */
export function parseSettingsFile(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That file is not valid JSON.' };
  }

  const { entries, marking, warning } = locateSettings(parsed);
  if (entries === null) {
    return {
      ok: false,
      reason: 'That file has no rule list. Expected an array, or an object with a "rules" array.',
    };
  }

  const rules: Rule[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const normalized = normalizeRule(entry);
    if (normalized) rules.push(normalized);
    else skipped += 1;
  }

  if (rules.length === 0) {
    return {
      ok: false,
      reason:
        entries.length === 0
          ? 'That file contains an empty rule list.'
          : `None of the ${entries.length} entries in that file are usable rules.`,
    };
  }

  return { ok: true, rules, marking, skipped, ...(warning ? { warning } : {}) };
}

/**
 * Finds the rule array and marking options, accepting the current envelope, the
 * pre-v3 one that called the array `patterns`, and a bare array. Returns
 * `entries: null` when there is nothing array-shaped to work with.
 */
function locateSettings(parsed: unknown): {
  entries: unknown[] | null;
  marking: MarkingOptions;
  warning?: string;
} {
  if (Array.isArray(parsed)) {
    return { entries: parsed, marking: { ...DEFAULT_MARKING_OPTIONS } };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { entries: null, marking: { ...DEFAULT_MARKING_OPTIONS } };
  }

  const file = parsed as Partial<SettingsFile> & { patterns?: unknown };
  const entries = Array.isArray(file.rules)
    ? file.rules
    : Array.isArray(file.patterns)
      ? file.patterns
      : null;

  if (entries === null) {
    return { entries: null, marking: { ...DEFAULT_MARKING_OPTIONS } };
  }

  // A newer file is a warning, not a rejection: unknown fields are dropped by the
  // normalisers, so the worst case is losing options this version cannot express anyway.
  const warning =
    typeof file.version === 'number' && file.version > FILE_VERSION
      ? `This file was written by a newer version (v${file.version}); anything unrecognised was ignored.`
      : undefined;

  // Absent marking block => defaults. Covers files exported before it existed.
  return { entries, marking: normalizeMarkingOptions(file.marking), warning };
}
