import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMetadataEndpoint,
  clearViewedIds,
  deriveMrPath,
  detectIncompleteMetadata,
  getDiffsApp,
  getMetadataEndpoint,
  getProjectFullPath,
  mergeViewedIds,
  parseViewedIds,
  resolveMrPath,
  storageKeyFor,
} from './gitlab';
import type { DiffFile, DiffsMetadata } from './types';

function diffFiles(count: number): DiffFile[] {
  return Array.from({ length: count }, (_, i) => ({
    added_lines: 1,
    removed_lines: 0,
    new_path: `file-${i}.yaml`,
    old_path: `file-${i}.yaml`,
    new_file: false,
    deleted_file: false,
    submodule: false,
    file_identifier_hash: `fih-${i}`,
    file_hash: `fh-${i}`,
    code_review_id: `crid-${i}`,
    conflict_type: null,
  }));
}

function metadata(overrides: Partial<DiffsMetadata> = {}): DiffsMetadata {
  const diff_files = overrides.diff_files ?? [];
  return {
    diff_files,
    size: diff_files.length,
    real_size: String(diff_files.length),
    render_overflow_warning: false,
    has_encoded_file_paths: false,
    ...overrides,
  };
}

describe('deriveMrPath', () => {
  it('extracts the merge-request path from the diffs endpoint', () => {
    expect(deriveMrPath('/mygroup/proj/-/merge_requests/42/diffs.json?diff_head=true')).toBe(
      '/mygroup/proj/-/merge_requests/42',
    );
  });

  it('keeps a self-hosted relative URL root', () => {
    // This value becomes the localStorage key GitLab itself reads, so it must
    // reproduce GitLab's computation exactly -- root included.
    expect(deriveMrPath('/gitlab/mygroup/proj/-/merge_requests/7/diffs.json')).toBe(
      '/gitlab/mygroup/proj/-/merge_requests/7',
    );
  });

  it('handles arbitrary subgroup nesting', () => {
    expect(deriveMrPath('/a/b/c/d/proj/-/merge_requests/1/diffs.json')).toBe(
      '/a/b/c/d/proj/-/merge_requests/1',
    );
  });

  it('handles names containing hyphens', () => {
    expect(deriveMrPath('/my-group/my-proj/-/merge_requests/9/diffs.json')).toBe(
      '/my-group/my-proj/-/merge_requests/9',
    );
  });

  it('returns null for anything that is not an MR diff endpoint', () => {
    expect(deriveMrPath('/mygroup/proj/-/issues/42')).toBeNull();
    expect(deriveMrPath('')).toBeNull();
  });
});

describe('buildMetadataEndpoint', () => {
  const MR = '/g/p/-/merge_requests/1';

  it('builds the bare URL when there is nothing to carry over', () => {
    expect(buildMetadataEndpoint(MR, '')).toBe(`${MR}/diffs_metadata.json`);
    expect(buildMetadataEndpoint(MR, '?view=inline&w=1')).toBe(`${MR}/diffs_metadata.json`);
  });

  it('carries over only the params that select a different MR version', () => {
    // These change which blobs are diffed, and code_review_id is derived from blob_id,
    // so dropping them would produce ids that never match anything on screen.
    expect(buildMetadataEndpoint(MR, '?diff_id=42')).toBe(`${MR}/diffs_metadata.json?diff_id=42`);
    expect(buildMetadataEndpoint(MR, '?start_sha=abc&view=parallel')).toBe(
      `${MR}/diffs_metadata.json?start_sha=abc`,
    );
    expect(buildMetadataEndpoint(MR, '?commit_id=deadbeef')).toBe(
      `${MR}/diffs_metadata.json?commit_id=deadbeef`,
    );
  });
});

describe('storageKeyFor', () => {
  it('prefixes the MR path', () => {
    expect(storageKeyFor('/mygroup/proj/-/merge_requests/42')).toBe(
      'code-review-/mygroup/proj/-/merge_requests/42',
    );
  });
});

describe('DOM readers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete document.body.dataset.projectFullPath;
  });

  const MR = '/g/p/-/merge_requests/1';

  it('prefers the diffs app dataset when the element is still present', () => {
    document.body.innerHTML = `
      <div id="js-diffs-app"
           data-endpoint="${MR}/diffs.json?diff_head=true"
           data-endpoint-metadata="${MR}/diffs_metadata.json?diff_head=true&view=inline&w=1"></div>`;
    expect(getDiffsApp(document)).not.toBeNull();
    expect(resolveMrPath(document, `${MR}/diffs`)).toBe(MR);
    expect(getMetadataEndpoint(document, MR, '')).toContain('w=1');
  });

  it('works when the diffs app element is gone, which is the normal case', () => {
    // GitLab mounts with `new Vue({ el })`, and Vue 2 replaces the mount element --
    // so #js-diffs-app is absent from the live DOM. Everything must still resolve.
    expect(getDiffsApp(document)).toBeNull();
    expect(resolveMrPath(document, `${MR}/diffs`)).toBe(MR);
    expect(getMetadataEndpoint(document, MR, '')).toBe(`${MR}/diffs_metadata.json`);
  });

  it('resolves the same mrPath from the URL as from data-endpoint', () => {
    const fromEndpoint = deriveMrPath(`${MR}/diffs.json?diff_head=true`);
    const fromLocation = deriveMrPath(`${MR}/diffs`);
    expect(fromLocation).toBe(fromEndpoint);
  });

  it('resolves from any merge request tab, not only Changes', () => {
    expect(resolveMrPath(document, MR)).toBe(MR);
    expect(resolveMrPath(document, `${MR}/commits`)).toBe(MR);
  });

  it('returns null off a merge request page', () => {
    expect(resolveMrPath(document, '/g/p/-/issues/4')).toBeNull();
  });

  it('prefers body[data-project-full-path]', () => {
    document.body.dataset.projectFullPath = 'gitlab-com/gl-infra/k8s-workloads/gitlab-com';
    expect(getProjectFullPath(document)).toBe('gitlab-com/gl-infra/k8s-workloads/gitlab-com');
  });

  it('falls back to .merge-request[data-project-path]', () => {
    document.body.innerHTML = `<div class="merge-request" data-project-path="mygroup/sub/proj"></div>`;
    expect(getProjectFullPath(document)).toBe('mygroup/sub/proj');
  });

  it('rejects a fallback value that looks like a URL', () => {
    // Guards against a future release swapping in the Rails route helper, which would
    // yield "/group/project" -- leading slash and relative-root-prefixed.
    document.body.innerHTML = `<div class="merge-request" data-project-path="/gitlab/mygroup/proj"></div>`;
    expect(getProjectFullPath(document)).toBeNull();
  });

  it('returns null rather than guessing', () => {
    expect(getProjectFullPath(document)).toBeNull();
  });
});

describe('detectIncompleteMetadata', () => {
  it('accepts a payload whose counts agree', () => {
    expect(detectIncompleteMetadata(metadata({ diff_files: diffFiles(3) }))).toBeNull();
  });

  it('accepts a large but complete payload', () => {
    // 400+ files is inside GitLab's default 1000-file listing limit, so this must pass.
    expect(detectIncompleteMetadata(metadata({ diff_files: diffFiles(450) }))).toBeNull();
  });

  it('rejects an overflowed collection signalled by a trailing +', () => {
    const reason = detectIncompleteMetadata(metadata({ real_size: '1000+' }));
    expect(reason).toMatch(/too large/i);
  });

  it('rejects an explicit overflow warning', () => {
    const reason = detectIncompleteMetadata(
      metadata({ real_size: '0', render_overflow_warning: true }),
    );
    expect(reason).toMatch(/truncated/i);
  });

  it('rejects a count mismatch', () => {
    const reason = detectIncompleteMetadata(metadata({ real_size: '5', diff_files: [] }));
    expect(reason).toMatch(/incomplete/i);
  });

  it('rejects non-UTF-8 paths, where a rename can look like an edit', () => {
    const reason = detectIncompleteMetadata(metadata({ has_encoded_file_paths: true }));
    expect(reason).toMatch(/non-UTF-8/i);
  });
});

describe('parseViewedIds', () => {
  it('reads an array of ids', () => {
    expect(parseViewedIds('["a","b"]')).toEqual(['a', 'b']);
  });

  it('treats a missing or empty value as an empty set', () => {
    expect(parseViewedIds(null)).toEqual([]);
    expect(parseViewedIds('')).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(parseViewedIds('["a",1,null,"b"]')).toEqual(['a', 'b']);
  });

  it('returns null for a present-but-unreadable value', () => {
    // Distinct from "empty" on purpose: overwriting an unparseable value would
    // discard review progress we cannot see, so the caller must abort.
    expect(parseViewedIds('not json')).toBeNull();
    expect(parseViewedIds('{"a":true}')).toBeNull();
  });
});

describe('clearViewedIds', () => {
  it('removes the key rather than writing an empty array', () => {
    // GitLab's own autosave() removes the key when nothing is viewed, so this leaves
    // the store in its native empty state rather than one only we produce.
    const store = new Map<string, string>([['code-review-/g/p/-/merge_requests/1', '["a","b"]']]);
    const removeItem = vi.fn((k: string) => void store.delete(k));
    const setItem = vi.fn();

    clearViewedIds(
      { removeItem, setItem } as unknown as Storage,
      'code-review-/g/p/-/merge_requests/1',
    );

    expect(removeItem).toHaveBeenCalledWith('code-review-/g/p/-/merge_requests/1');
    expect(setItem).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});

describe('mergeViewedIds', () => {
  it('unions rather than replaces', () => {
    // The one genuinely destructive failure mode: replacing would wipe every file the
    // user had already ticked by hand.
    const { ids, added } = mergeViewedIds(['manual-1', 'manual-2'], ['new-1']);
    expect(ids).toEqual(['manual-1', 'manual-2', 'new-1']);
    expect(added).toEqual(['new-1']);
  });

  it('reports only genuinely new ids, not everything incoming', () => {
    // `added` is what the self-check stashes and then asserts survived the reload.
    // Including ids that were already present would make the next run report a larger
    // number than it actually wrote.
    const { ids, added } = mergeViewedIds(['a', 'b'], ['b', 'c']);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(added).toEqual(['c']);
  });

  it('is a no-op when everything is already present', () => {
    const { ids, added } = mergeViewedIds(['a'], ['a']);
    expect(ids).toEqual(['a']);
    expect(added).toEqual([]);
  });

  it('deduplicates within the incoming set', () => {
    const { ids, added } = mergeViewedIds([], ['a', 'a']);
    expect(ids).toEqual(['a']);
    expect(added).toEqual(['a']);
  });
});
