/**
 * Shapes returned by GitLab, stored by this extension, and passed between its modules.
 *
 * The diff-file shape mirrors `DiffFileMetadataEntity` at GitLab v18.8.0-ee, which
 * exposes exactly these fields:
 * https://gitlab.com/gitlab-org/gitlab/-/blob/v18.8.0-ee/app/serializers/diff_file_metadata_entity.rb
 *
 * Naming: a **rule** is one configured entry (a project scope owning a list of globs);
 * a **glob** is one line inside it. "Pattern" is deliberately not used as a type name --
 * it previously meant the rule, the line list and a single glob in the same expression.
 * It survives only as the *persisted* field name, which is a compatibility surface --
 * see `normalizeRule` in `lib/settings.ts`.
 */

export interface DiffFile {
  added_lines: number;
  removed_lines: number;
  /** Path after the change. Equal to `old_path` for adds, deletes and plain edits. */
  new_path: string;
  /** Path before the change. Differs from `new_path` only for renames. */
  old_path: string;
  new_file: boolean;
  deleted_file: boolean;
  submodule: boolean;
  file_identifier_hash: string;
  file_hash: string;
  /** SHA1 the "Viewed" store is keyed by. Changes when file content changes. */
  code_review_id: string;
  conflict_type: string | null;
}

/** Response body of `diffs_metadata.json`. */
export interface DiffsMetadata {
  diff_files: DiffFile[];
  /** Number of files actually returned. */
  size: number;
  /** Always a string. A trailing "+" means the collection overflowed. */
  real_size: string;
  render_overflow_warning?: boolean;
  has_encoded_file_paths?: boolean;
}

/**
 * One configured rule: a project scope owning any number of file globs.
 *
 * `project` is matched case-insensitively against the project's full path
 * (`group/subgroup/project`), because GitLab namespace paths are case-insensitively
 * unique. `globs` are matched case-sensitively against the file path from the repo
 * root, because Git paths are case-sensitive.
 */
export interface Rule {
  /** Glob over the project full path. `**` means "every project". */
  project: string;
  /**
   * Globs over the file path from the repo root. A file matching any one is selected.
   * May contain comment lines, which `globsOf` strips at match time.
   */
  globs: string[];
  enabled: boolean;
}

/**
 * Older on-disk shapes `normalizeRule` still accepts.
 *
 * Both fields are optional because a stored entry carries exactly one of them, and
 * neither is written any more. Kept so configuration already in `storage.sync`, and
 * files exported by an older version, upgrade on read without depending on the
 * declared migration having run.
 */
export interface LegacyRule {
  project: string;
  /** v1: a rule held exactly one glob. */
  pattern?: string;
  /** v2: the glob list, before it was renamed `globs`. */
  patterns?: string[];
  enabled: boolean;
}

/**
 * Which structural categories of file may be marked, independent of any rule.
 *
 * Every field is phrased positively, so `true` always means "more gets marked" and a
 * missing or corrupt value can safely fall back to the conservative default.
 *
 * Note `markRenamedFiles` only governs renames GitLab actually *detects*. Git rename
 * detection is similarity-based, so a moved file whose content also changed is reported
 * as a delete plus an add and is governed by `markDeletedFiles` / `markNewFiles` instead.
 * The extension adds no heuristics of its own; it reflects what GitLab reports.
 */
export interface MarkingOptions {
  markNewFiles: boolean;
  markDeletedFiles: boolean;
  markRenamedFiles: boolean;
  markSubmodules: boolean;
}

/**
 * Reason a file was skipped, for the confirmation overlay's summary.
 *
 * A closed union on purpose: `SKIP_LABELS` in `lib/overlay.ts` is typed
 * `Record<SkipReason, string>`, so adding a reason without giving it a user-facing
 * label is a compile error rather than a raw slug shipped into the UI.
 */
export type SkipReason =
  'deleted' | 'renamed' | 'submodule' | 'new' | 'no-checkbox' | 'no-pattern-match';

/**
 * What the confirmation overlay renders.
 *
 * Lives here rather than in `lib/overlay.ts` so `lib/plan.ts` can describe its output
 * without importing the renderer -- the decision layer must not depend on the view.
 */
export interface ConfirmOptions {
  matched: DiffFile[];
  /** Of `matched`, how many are already ticked -- i.e. this run is a no-op for them. */
  alreadyViewed: number;
  totalFiles: number;
  skippedCounts: Partial<Record<SkipReason, number>>;
  projectFullPath: string;
  /** How many rules are in scope for this project. */
  activeRuleCount: number;
  /**
   * How many files are currently marked Viewed in this merge request, from any source.
   * Drives the Unmark all button, which is hidden when there is nothing to undo.
   */
  currentlyMarked: number;
  /** Shown as a prominent warning at the top of the body, e.g. a failed self-check. */
  warning?: string | null;
}

/** What a terminal message renders. Same rationale as `ConfirmOptions` for living here. */
export interface MessageOptions {
  title: string;
  subtitle?: string;
  body: string;
  tone: 'warning' | 'error';
}
