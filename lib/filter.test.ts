import { describe, expect, it } from 'vitest';
import { groupByDirectory, isRenamed, selectFiles } from './filter';
import { DEFAULT_MARKING_OPTIONS } from './settings';
import type { DiffFile, MarkingOptions, Rule } from './types';

/**
 * Builds a diff file with the real path semantics GitLab uses:
 * for adds, deletes and plain edits `old_path === new_path`; only renames differ.
 */
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

const marking = (overrides: Partial<MarkingOptions> = {}): MarkingOptions => ({
  ...DEFAULT_MARKING_OPTIONS,
  ...overrides,
});

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  project: '**',
  globs: ['**/templates/*.yaml'],
  enabled: true,
  ...overrides,
});

describe('isRenamed', () => {
  it('is true only when the paths differ', () => {
    expect(isRenamed(file({ new_path: 'b.yaml', old_path: 'a.yaml' }))).toBe(true);
    expect(isRenamed(file({ new_path: 'a.yaml' }))).toBe(false);
  });

  it('does not misclassify adds or deletes, whose paths are equal not null', () => {
    // A null-check here would look correct and quietly treat every add and delete as
    // a rename. GitLab sets old_path === new_path for both.
    expect(isRenamed(file({ new_path: 'new.yaml', new_file: true }))).toBe(false);
    expect(isRenamed(file({ new_path: 'gone.yaml', deleted_file: true }))).toBe(false);
  });

  it('still detects a rename that also changed content', () => {
    const renamedAndEdited = file({
      new_path: 'b.yaml',
      old_path: 'a.yaml',
      added_lines: 12,
      removed_lines: 5,
    });
    expect(isRenamed(renamedAndEdited)).toBe(true);
  });
});

describe('selectFiles', () => {
  const files = [
    file({ new_path: 'charts/app/templates/deploy.yaml' }),
    file({ new_path: 'charts/app/templates/svc.yaml', new_file: true }),
    file({ new_path: 'src/main.ts' }),
    file({ new_path: 'charts/app/templates/moved.yaml', old_path: 'old/moved.yaml' }),
    file({ new_path: 'charts/app/templates/gone.yaml', deleted_file: true }),
    file({ new_path: 'charts/app/templates/mod', submodule: true }),
  ];

  it('matches only eligible files that satisfy a glob', () => {
    // svc.yaml is a new file and still matches by default: a freshly generated
    // templated file is exactly the case worth marking.
    const { matched } = selectFiles(files, 'mygroup/app', [rule()], marking());
    expect(matched.map((f) => f.new_path)).toEqual([
      'charts/app/templates/deploy.yaml',
      'charts/app/templates/svc.yaml',
    ]);
  });

  it('reports why each file was skipped', () => {
    const { skipped } = selectFiles(files, 'mygroup/app', [rule()], marking());
    const byPath = Object.fromEntries(skipped.map((s) => [s.file.new_path, s.reason]));
    expect(byPath).toEqual({
      'src/main.ts': 'no-pattern-match',
      'charts/app/templates/moved.yaml': 'renamed',
      'charts/app/templates/gone.yaml': 'deleted',
      'charts/app/templates/mod': 'submodule',
    });
  });

  it('checks structural exclusions before glob matching', () => {
    // A deleted file that matches a glob must be reported as deleted, not as a
    // glob miss -- the overlay's summary would otherwise be misleading.
    const { skipped } = selectFiles(
      [file({ new_path: 'charts/app/templates/gone.yaml', deleted_file: true })],
      'mygroup/app',
      [rule()],
      marking(),
    );
    expect(skipped[0]?.reason).toBe('deleted');
  });

  it('matches a file hit by the second glob of a rule', () => {
    const multi = [rule({ globs: ['**/nothing/*.yaml', '**/templates/*.yaml'] })];
    const { matched } = selectFiles(files, 'mygroup/app', multi, marking());
    expect(matched.map((f) => f.new_path)).toEqual([
      'charts/app/templates/deploy.yaml',
      'charts/app/templates/svc.yaml',
    ]);
  });

  it('unions the globs within a rule', () => {
    const multi = [rule({ globs: ['**/templates/*.yaml', 'src/*.ts'] })];
    const { matched } = selectFiles(files, 'mygroup/app', multi, marking());
    expect(matched.map((f) => f.new_path)).toContain('src/main.ts');
    expect(matched).toHaveLength(3);
  });

  it('ignores comment lines when matching', () => {
    const commented = [rule({ globs: ['# generated charts', '**/templates/*.yaml'] })];
    const { matched } = selectFiles(files, 'mygroup/app', commented, marking());
    expect(matched).toHaveLength(2);
  });

  it('matches nothing when a rule is only comments', () => {
    const commented = [rule({ globs: ['# nothing here yet'] })];
    const { matched } = selectFiles(files, 'mygroup/app', commented, marking());
    expect(matched).toHaveLength(0);
  });

  it('honours project scoping', () => {
    const scoped = [rule({ project: 'other/**' })];
    const { matched, activeRules } = selectFiles(files, 'mygroup/app', scoped, marking());
    expect(activeRules).toHaveLength(0);
    expect(matched).toHaveLength(0);
  });

  it('matches project scopes case-insensitively at arbitrary depth', () => {
    const scoped = [rule({ project: 'MyGroup/**' })];
    const { activeRules } = selectFiles(files, 'mygroup/sub/deeper/app', scoped, marking());
    expect(activeRules).toHaveLength(1);
  });

  it('ignores disabled rules', () => {
    const { matched } = selectFiles(files, 'mygroup/app', [rule({ enabled: false })], marking());
    expect(matched).toHaveLength(0);
  });

  it('matches nothing when no rules are configured', () => {
    const { matched, skipped } = selectFiles(files, 'mygroup/app', [], marking());
    expect(matched).toHaveLength(0);
    expect(skipped).toHaveLength(files.length);
  });

  it('marks deleted files once enabled', () => {
    const { matched, skipped } = selectFiles(
      files,
      'mygroup/app',
      [rule()],
      marking({ markDeletedFiles: true }),
    );
    expect(matched.map((f) => f.new_path)).toContain('charts/app/templates/gone.yaml');
    expect(skipped.some((s) => s.reason === 'deleted')).toBe(false);
  });

  it('marks renamed files once enabled', () => {
    const { matched } = selectFiles(
      files,
      'mygroup/app',
      [rule()],
      marking({ markRenamedFiles: true }),
    );
    expect(matched.map((f) => f.new_path)).toContain('charts/app/templates/moved.yaml');
  });

  it('marks submodules once enabled', () => {
    const submodule = file({ new_path: 'charts/app/templates/mod.yaml', submodule: true });
    const { matched } = selectFiles(
      [submodule],
      'mygroup/app',
      [rule()],
      marking({ markSubmodules: true }),
    );
    expect(matched).toHaveLength(1);
  });

  it('skips new files once disabled, with the right reason', () => {
    const { matched, skipped } = selectFiles(
      files,
      'mygroup/app',
      [rule()],
      marking({ markNewFiles: false }),
    );
    expect(matched.map((f) => f.new_path)).toEqual(['charts/app/templates/deploy.yaml']);
    expect(skipped.find((s) => s.file.new_path === 'charts/app/templates/svc.yaml')?.reason).toBe(
      'new',
    );
  });

  it('always skips a file with no code_review_id, whatever the toggles say', () => {
    // GitLab renders no Viewed checkbox without one, so there is nothing to tick and
    // marking it would write a null into the id list.
    const orphan = file({ new_path: 'charts/app/templates/x.yaml', code_review_id: '' });
    const allOn = marking({
      markNewFiles: true,
      markDeletedFiles: true,
      markRenamedFiles: true,
      markSubmodules: true,
    });
    const { matched, skipped } = selectFiles([orphan], 'mygroup/app', [rule()], allOn);
    expect(matched).toHaveLength(0);
    expect(skipped[0]?.reason).toBe('no-checkbox');
  });

  it('scales to a large merge request', () => {
    const many = Array.from({ length: 450 }, (_, i) =>
      file({ new_path: `charts/svc-${i}/templates/deploy.yaml` }),
    );
    const { matched } = selectFiles(many, 'mygroup/app', [rule()], marking());
    expect(matched).toHaveLength(450);
  });
});

describe('groupByDirectory', () => {
  it('groups by parent directory and sorts both levels', () => {
    const grouped = groupByDirectory([
      file({ new_path: 'b/second.yaml' }),
      file({ new_path: 'a/z.yaml' }),
      file({ new_path: 'a/a.yaml' }),
    ]);
    expect(grouped).toEqual([
      { directory: 'a', files: ['a.yaml', 'z.yaml'] },
      { directory: 'b', files: ['second.yaml'] },
    ]);
  });

  it('puts repo-root files under "."', () => {
    expect(groupByDirectory([file({ new_path: '.gitlab-ci.yml' })])).toEqual([
      { directory: '.', files: ['.gitlab-ci.yml'] },
    ]);
  });
});
