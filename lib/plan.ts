/**
 * The decision sequence for one run, as a pure function.
 *
 * Everything the marker decides before it changes anything lives here: whether the page
 * is usable, whether GitLab's answer can be trusted, whether the existing state is safe
 * to merge into, and what would be marked. `entrypoints/marker.ts` is the effectful
 * shell that gathers the inputs and carries out the result.
 *
 * The split exists for the ordering. "Refuse before write" is a correctness property --
 * every abort below must happen while nothing has been touched -- and as a pure
 * function it can be tested exhaustively without a browser.
 */
import { selectFiles } from './filter';
import { detectIncompleteMetadata, parseViewedIds, storageKeyFor } from './gitlab';
import type {
  ConfirmOptions,
  DiffFile,
  DiffsMetadata,
  MarkingOptions,
  MessageOptions,
  Rule,
  SkipReason,
} from './types';

/** Everything the decision depends on, gathered by the caller. */
export interface RunInput {
  /** Resolved merge-request path, or null when this is not a merge request page. */
  mrPath: string | null;
  projectFullPath: string | null;
  /** The metadata payload, or a human-readable reason the fetch failed. */
  metadata: DiffsMetadata | string;
  /** Raw value of GitLab's viewed-ids key, straight from `localStorage`. */
  storedRaw: string | null;
  /**
   * Raw self-check stash left by the previous run, or null. Read, never consumed --
   * clearing it is the caller's job, and only once this run has got far enough to
   * report what it says. See `lib/../entrypoints/marker.ts`.
   */
  stashRaw: string | null;
  rules: readonly Rule[];
  markingOptions: MarkingOptions;
}

export type Plan =
  /** Show this and change nothing. */
  | { kind: 'abort'; message: MessageOptions }
  /** Ask the user, then act on `key` / `existing` / `matched`. */
  | {
      kind: 'confirm';
      key: string;
      /** Ids already stored, to union into -- never to replace. */
      existing: string[];
      matched: DiffFile[];
      confirm: ConfirmOptions;
    };

export function planRun(input: RunInput): Plan {
  // Deliberately does NOT require #js-diffs-app: Vue replaces that element on mount, so
  // it is absent from the live DOM. The MR path comes from the URL instead.
  if (!input.mrPath) {
    return abort({
      title: 'Not a merge request',
      body: 'Open a GitLab merge request and try again.',
      tone: 'warning',
    });
  }

  if (!input.projectFullPath) {
    return abort({
      title: "Couldn't read the project path",
      body:
        'This page exposes the project path neither on <body>, which every GitLab project ' +
        'page since 17.0 carries, nor on the merge-request element. The GitLab version may ' +
        'have changed its markup.',
      tone: 'error',
    });
  }

  if (typeof input.metadata === 'string') {
    return abort({
      title: "Couldn't load the file list",
      body: input.metadata,
      tone: 'error',
    });
  }

  const incomplete = detectIncompleteMetadata(input.metadata);
  if (incomplete) {
    return abort({
      title: 'Refusing to mark a partial file list',
      subtitle: input.projectFullPath,
      body: incomplete,
      tone: 'error',
    });
  }

  const key = storageKeyFor(input.mrPath);
  const existing = parseViewedIds(input.storedRaw);
  if (existing === null) {
    return abort({
      title: 'Existing review state is unreadable',
      subtitle: key,
      body:
        'GitLab has stored a value for this merge request that could not be parsed. ' +
        'Overwriting it would discard review progress, so nothing has been changed.',
      tone: 'error',
    });
  }

  const existingIds = new Set(existing);
  const selection = selectFiles(
    input.metadata.diff_files,
    input.projectFullPath,
    input.rules,
    input.markingOptions,
  );

  return {
    kind: 'confirm',
    key,
    existing,
    matched: selection.matched,
    confirm: {
      matched: selection.matched,
      alreadyViewed: selection.matched.filter((f) => existingIds.has(f.code_review_id)).length,
      totalFiles: input.metadata.diff_files.length,
      skippedCounts: countBy(selection.skipped),
      projectFullPath: input.projectFullPath,
      activeRuleCount: selection.activeRules.length,
      currentlyMarked: existingIds.size,
      warning: checkPreviousRun(input.stashRaw, key, existingIds),
    },
  };
}

function abort(message: MessageOptions): Plan {
  return { kind: 'abort', message };
}

/**
 * Tallies skip reasons. Keeps the `SkipReason` union rather than widening to `string`,
 * so the overlay's label table stays exhaustiveness-checked against it.
 */
export function countBy(
  skipped: ReadonlyArray<{ reason: SkipReason }>,
): Partial<Record<SkipReason, number>> {
  const counts: Partial<Record<SkipReason, number>> = {};
  for (const { reason } of skipped) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}

/** What the previous run stashed, so this one can check the write stuck. */
export interface SelfCheckStash {
  key: string;
  /** Only the ids that run actually added; ones already ticked prove nothing. */
  ids: string[];
}

export function serializeStash(stash: SelfCheckStash): string {
  return JSON.stringify(stash);
}

/**
 * Deferred self-check.
 *
 * Nothing can run immediately after the reload -- `activeTab` is revoked on navigation --
 * so verification happens on the *next* invocation instead: if the ids the last run wrote
 * are no longer in GitLab's store, the localStorage contract has changed and the primary
 * approach is no longer working.
 *
 * Returns a warning to surface, or null when there is nothing to say. A malformed stash,
 * or one left by a different merge request, is silently ignored: it is diagnostic only,
 * and a false alarm about destroyed review state would be worse than no alarm.
 */
export function checkPreviousRun(
  stashRaw: string | null,
  key: string,
  currentIds: ReadonlySet<string>,
): string | null {
  if (!stashRaw) return null;

  let stash: { key?: unknown; ids?: unknown };
  try {
    stash = JSON.parse(stashRaw) as { key?: unknown; ids?: unknown };
  } catch {
    return null;
  }

  // Scoped to this merge request. A stash from another one says nothing about this
  // store, and warning on it would be a pure false positive.
  if (stash.key !== key || !Array.isArray(stash.ids)) return null;

  const missing = stash.ids.filter((id) => typeof id === 'string' && !currentIds.has(id));
  if (missing.length === 0) return null;

  return (
    `The previous run marked ${stash.ids.length} file(s), but ${missing.length} of them are no ` +
    'longer recorded. GitLab may have changed how it stores Viewed state in this version.'
  );
}
