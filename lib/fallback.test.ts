import { beforeEach, describe, expect, it } from 'vitest';
import { DIFF_FILE_SELECTOR, VIEWED_CHECKBOX_SELECTOR, clickMountedCheckboxes } from './fallback';

/**
 * Mirrors the classic diff view's structure: a `.diff-file[data-path]` wrapper around
 * a header containing the Viewed checkbox.
 *
 * Written out as GitLab emits it rather than generated from the selector constants --
 * a fixture derived from the thing under test would agree with any value of it. The
 * "fixture satisfies the exported selectors" case below is what ties the two together.
 */
function mountFile(path: string, options: { checked?: boolean; disabled?: boolean } = {}): void {
  const wrapper = document.createElement('div');
  wrapper.className = 'diff-file file-holder';
  wrapper.dataset.path = path;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.testid = 'fileReviewCheckbox';
  checkbox.checked = options.checked ?? false;
  checkbox.disabled = options.disabled ?? false;

  wrapper.append(checkbox);
  document.body.append(wrapper);
}

const checkboxes = () => [...document.querySelectorAll<HTMLInputElement>(VIEWED_CHECKBOX_SELECTOR)];

describe('clickMountedCheckboxes', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('exports selectors that match the markup GitLab actually renders', () => {
    // The two constants are the whole GitLab DOM contract for this path. If a future
    // release moves the checkbox or renames the wrapper, this fails here rather than
    // silently reducing the fallback to zero mounted files.
    mountFile('charts/a.yaml');

    const checkbox = document.querySelector(VIEWED_CHECKBOX_SELECTOR);
    expect(checkbox).not.toBeNull();
    expect(checkbox?.closest(DIFF_FILE_SELECTOR)).not.toBeNull();
  });

  it('ticks matching unchecked boxes', () => {
    mountFile('charts/a/templates/x.yaml');
    mountFile('src/main.ts');

    const result = clickMountedCheckboxes(document, (p) => p.endsWith('.yaml'));

    expect(result.clicked).toBe(1);
    expect(result.mounted).toBe(2);
    expect(checkboxes()[0]?.checked).toBe(true);
    expect(checkboxes()[1]?.checked).toBe(false);
  });

  it('never un-ticks an already-viewed file', () => {
    // .click() toggles, so an unguarded implementation would untick exactly the files
    // the user had already reviewed.
    mountFile('charts/a.yaml', { checked: true });

    const result = clickMountedCheckboxes(document, () => true);

    expect(result.clicked).toBe(0);
    expect(result.alreadyChecked).toBe(1);
    expect(checkboxes()[0]?.checked).toBe(true);
  });

  it('skips disabled checkboxes', () => {
    mountFile('charts/a.yaml', { disabled: true });

    const result = clickMountedCheckboxes(document, () => true);

    expect(result.clicked).toBe(0);
    expect(checkboxes()[0]?.checked).toBe(false);
  });

  it('counts files whose path cannot be read', () => {
    const orphan = document.createElement('input');
    orphan.type = 'checkbox';
    orphan.dataset.testid = 'fileReviewCheckbox';
    document.body.append(orphan);

    const result = clickMountedCheckboxes(document, () => true);

    expect(result.unknownPath).toBe(1);
    expect(result.clicked).toBe(0);
  });

  it('reports zero when nothing is mounted, rather than throwing', () => {
    expect(clickMountedCheckboxes(document, () => true)).toEqual({
      clicked: 0,
      alreadyChecked: 0,
      unknownPath: 0,
      mounted: 0,
    });
  });

  it('works bottom-to-top so collapsing a file does not shift unvisited ones', () => {
    const order: string[] = [];
    mountFile('a.yaml');
    mountFile('b.yaml');
    mountFile('c.yaml');
    for (const cb of checkboxes()) {
      cb.addEventListener('click', () => {
        const path = cb.closest<HTMLElement>(DIFF_FILE_SELECTOR)?.dataset.path;
        if (path) order.push(path);
      });
    }

    clickMountedCheckboxes(document, () => true);

    expect(order).toEqual(['c.yaml', 'b.yaml', 'a.yaml']);
  });
});
