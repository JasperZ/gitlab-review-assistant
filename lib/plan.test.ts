import { describe, expect, it } from 'vitest';
import { checkPreviousRun, countBy, planRun, serializeStash } from './plan';
import type { RunInput } from './plan';
import { DEFAULT_MARKING_OPTIONS } from './settings';
import type { DiffFile, DiffsMetadata, Rule } from './types';

function file(overrides: Partial<DiffFile> & { new_path: string }): DiffFile {
  return {
    added_lines: 1,
    removed_lines: 0,
    old_path: overrides.old_path ?? overrides.new_path,
    new_file: false,
    deleted_file: false,
    submodule: false,
    file_identifier_hash: `fih-${overrides.new_path}`,
    file_hash: `fh-${overrides.new_path}`,
    code_review_id: `crid-${overrides.new_path}`,
    conflict_type: null,
    ...overrides,
  };
}

const TEMPLATED = file({ new_path: 'charts/app/templates/a.yaml' });
const HANDWRITTEN = file({ new_path: 'src/index.ts' });

function metadata(overrides: Partial<DiffsMetadata> = {}): DiffsMetadata {
  const files = overrides.diff_files ?? [TEMPLATED, HANDWRITTEN];
  return {
    diff_files: files,
    size: files.length,
    real_size: String(files.length),
    ...overrides,
  };
}

const rule: Rule = { project: '**', globs: ['**/templates/*.yaml'], enabled: true };

const MR_PATH = '/group/sub/project/-/merge_requests/42';
const KEY = `code-review-${MR_PATH}`;

function input(overrides: Partial<RunInput> = {}): RunInput {
  return {
    mrPath: MR_PATH,
    projectFullPath: 'group/sub/project',
    metadata: metadata(),
    storedRaw: null,
    stashRaw: null,
    rules: [rule],
    markingOptions: DEFAULT_MARKING_OPTIONS,
    ...overrides,
  };
}

/** Narrows to the abort branch, failing loudly rather than returning undefined. */
function abortOf(plan: ReturnType<typeof planRun>) {
  if (plan.kind !== 'abort') throw new Error(`expected an abort, got ${plan.kind}`);
  return plan.message;
}

function confirmOf(plan: ReturnType<typeof planRun>) {
  if (plan.kind !== 'confirm') throw new Error(`expected a confirm, got ${plan.kind}`);
  return plan;
}

describe('planRun aborts', () => {
  it('refuses a page with no merge-request path', () => {
    expect(abortOf(planRun(input({ mrPath: null }))).title).toBe('Not a merge request');
  });

  it('refuses when the project path is missing from the DOM', () => {
    const message = abortOf(planRun(input({ projectFullPath: null })));
    expect(message.title).toBe("Couldn't read the project path");
    expect(message.tone).toBe('error');
  });

  it('surfaces a fetch failure verbatim', () => {
    const message = abortOf(planRun(input({ metadata: 'GitLab returned 500 for /x.json.' })));
    expect(message.title).toBe("Couldn't load the file list");
    expect(message.body).toBe('GitLab returned 500 for /x.json.');
  });

  it('refuses a truncated file list', () => {
    const message = abortOf(planRun(input({ metadata: metadata({ real_size: '1000+' }) })));
    expect(message.title).toBe('Refusing to mark a partial file list');
  });

  it('refuses when the stored value cannot be parsed', () => {
    const message = abortOf(planRun(input({ storedRaw: 'not json' })));
    expect(message.title).toBe('Existing review state is unreadable');
    expect(message.subtitle).toBe(KEY);
  });
});

describe('planRun ordering', () => {
  // The sequence is a correctness property, not an implementation detail: every abort
  // has to happen while nothing has been touched, and the earliest applicable one wins
  // so the user is told the most fundamental problem rather than a downstream symptom.
  it('reports a missing project before attempting anything with the payload', () => {
    const plan = planRun(input({ projectFullPath: null, metadata: 'fetch blew up' }));
    expect(abortOf(plan).title).toBe("Couldn't read the project path");
  });

  it('reports truncation before unreadable stored state', () => {
    const plan = planRun(input({ metadata: metadata({ real_size: '1000+' }), storedRaw: '{{{' }));
    expect(abortOf(plan).title).toBe('Refusing to mark a partial file list');
  });
});

describe('planRun confirmation', () => {
  it('selects only glob matches and reports the rest as skipped', () => {
    const plan = confirmOf(planRun(input()));

    expect(plan.matched.map((f) => f.new_path)).toEqual([TEMPLATED.new_path]);
    expect(plan.confirm.skippedCounts).toEqual({ 'no-pattern-match': 1 });
    expect(plan.confirm.totalFiles).toBe(2);
    expect(plan.confirm.activeRuleCount).toBe(1);
    expect(plan.key).toBe(KEY);
  });

  it('passes the existing ids through untouched, for the caller to union into', () => {
    const plan = confirmOf(planRun(input({ storedRaw: JSON.stringify(['someone-elses-id']) })));

    expect(plan.existing).toEqual(['someone-elses-id']);
    expect(plan.confirm.currentlyMarked).toBe(1);
    expect(plan.confirm.alreadyViewed).toBe(0);
  });

  it('counts matches that are already viewed, so a no-op run can say so', () => {
    const plan = confirmOf(
      planRun(input({ storedRaw: JSON.stringify([TEMPLATED.code_review_id]) })),
    );

    expect(plan.confirm.alreadyViewed).toBe(1);
    expect(plan.matched).toHaveLength(1);
  });

  it('treats absent stored state as empty rather than unreadable', () => {
    expect(confirmOf(planRun(input({ storedRaw: null }))).existing).toEqual([]);
    expect(confirmOf(planRun(input({ storedRaw: '' }))).existing).toEqual([]);
  });

  it('carries no warning when the previous run is unverifiable', () => {
    expect(confirmOf(planRun(input())).confirm.warning).toBeNull();
  });
});

describe('countBy', () => {
  it('tallies reasons', () => {
    expect(countBy([{ reason: 'deleted' }, { reason: 'deleted' }, { reason: 'new' }])).toEqual({
      deleted: 2,
      new: 1,
    });
  });

  it('is empty for no skips', () => {
    expect(countBy([])).toEqual({});
  });
});

describe('checkPreviousRun', () => {
  const ids = ['a', 'b'];

  it('says nothing without a stash', () => {
    expect(checkPreviousRun(null, KEY, new Set(ids))).toBeNull();
  });

  it('says nothing when every stashed id survived', () => {
    const stash = serializeStash({ key: KEY, ids });
    expect(checkPreviousRun(stash, KEY, new Set(ids))).toBeNull();
  });

  it('warns when stashed ids have gone missing', () => {
    const stash = serializeStash({ key: KEY, ids });
    const warning = checkPreviousRun(stash, KEY, new Set(['a']));
    expect(warning).toContain('marked 2 file(s)');
    expect(warning).toContain('1 of them are no longer recorded');
  });

  it('ignores a stash left by a different merge request', () => {
    // Otherwise every second merge request in a tab would raise a false alarm about
    // destroyed review state -- which is exactly the alarm nobody should ignore.
    const stash = serializeStash({ key: 'code-review-/other/-/merge_requests/1', ids });
    expect(checkPreviousRun(stash, KEY, new Set())).toBeNull();
  });

  it('ignores malformed stashes rather than warning on them', () => {
    expect(checkPreviousRun('{{{', KEY, new Set())).toBeNull();
    expect(checkPreviousRun(JSON.stringify({ key: KEY }), KEY, new Set())).toBeNull();
    expect(checkPreviousRun(JSON.stringify(['a']), KEY, new Set())).toBeNull();
  });
});
