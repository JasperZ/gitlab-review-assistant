/**
 * Options page: the rule list, the marking toggles, and import/export of both.
 *
 * Saves are debounced. `storage.sync` throttles at 120 writes/minute, and a naive
 * save-on-every-keystroke blows through that in seconds and starts throwing.
 *
 * Rows hold a reference to their `Rule` object rather than an index, so reordering
 * or removal can't leave a stale handler mutating the wrong row.
 */
import { formatGlobLines, parseGlobLines } from '@/lib/match';
import { showDangerConfirm } from '@/lib/overlay';
import {
  ALL_PROJECTS,
  DEFAULT_MARKING_OPTIONS,
  debounce,
  loadMarkingOptions,
  loadRules,
  newRule,
  saveMarkingOptions,
  saveRules,
  validateRule,
} from '@/lib/settings';
import { DEFAULT_FILENAME, parseSettingsFile, serializeSettings } from '@/lib/transfer';
import type { MarkingOptions, Rule } from '@/lib/types';

const SAVE_DEBOUNCE_MS = 600;
const STATUS_CLEAR_MS = 2000;
const MIN_TEXTAREA_ROWS = 3;
const MAX_TEXTAREA_ROWS = 14;

const rowsEl = document.querySelector<HTMLTableSectionElement>('#rows')!;
const emptyEl = document.querySelector<HTMLElement>('#empty')!;
const addEl = document.querySelector<HTMLButtonElement>('#add')!;
const exportEl = document.querySelector<HTMLButtonElement>('#export')!;
const importEl = document.querySelector<HTMLButtonElement>('#import')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;

let rules: Rule[] = [];
let marking: MarkingOptions = { ...DEFAULT_MARKING_OPTIONS };

/** Checkbox ids match the MarkingOptions keys, so the wiring stays declarative. */
const MARKING_KEYS = Object.keys(DEFAULT_MARKING_OPTIONS) as Array<keyof MarkingOptions>;

/** The marking checkboxes, looked up once. Absent ids are a broken build, not a state. */
function markingBoxes(): Array<[keyof MarkingOptions, HTMLInputElement]> {
  return MARKING_KEYS.flatMap((key) => {
    const box = document.querySelector<HTMLInputElement>(`#${key}`);
    return box ? [[key, box] as [keyof MarkingOptions, HTMLInputElement]] : [];
  });
}

const queueSaveMarking = debounce(() => {
  void persistMarking();
}, SAVE_DEBOUNCE_MS);

async function persistMarking(): Promise<void> {
  try {
    await saveMarkingOptions(marking);
    setStatus('Saved');
  } catch (error) {
    setStatus(`Save failed: ${message(error)}`, true);
  }
}

function renderMarking(): void {
  for (const [key, box] of markingBoxes()) box.checked = marking[key];
}

function bindMarking(): void {
  for (const [key, box] of markingBoxes()) {
    box.addEventListener('change', () => {
      marking[key] = box.checked;
      queueSaveMarking();
    });
  }
}

const queueSave = debounce(() => {
  void persist();
}, SAVE_DEBOUNCE_MS);

async function persist(): Promise<void> {
  try {
    await saveRules(rules);
    setStatus('Saved');
  } catch (error) {
    setStatus(`Save failed: ${message(error)}`, true);
  }
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function setStatus(text: string, sticky = false): void {
  statusEl.textContent = text;
  if (statusTimer !== undefined) clearTimeout(statusTimer);
  if (!sticky) {
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, STATUS_CLEAR_MS);
  }
}

function render(): void {
  rowsEl.replaceChildren(...rules.map((rule, index) => renderRow(rule, index)));
  emptyEl.hidden = rules.length > 0;
}

function renderRow(rule: Rule, index: number): HTMLTableRowElement {
  const row = document.createElement('tr');
  const position = index + 1;

  const enabledCell = document.createElement('td');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = rule.enabled;
  enabled.setAttribute('aria-label', `Enable rule ${position}`);
  enabled.addEventListener('change', () => {
    rule.enabled = enabled.checked;
    queueSave();
  });
  enabledCell.append(enabled);

  const projectCell = document.createElement('td');
  projectCell.append(projectField(rule, `Project glob for rule ${position}`));

  const globsCell = document.createElement('td');
  globsCell.append(globsField(rule, `File path globs for rule ${position}`));

  const actionsCell = document.createElement('td');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.setAttribute('aria-label', `Remove rule ${position}`);
  remove.addEventListener('click', () => {
    const at = rules.indexOf(rule);
    if (at === -1) return;
    rules.splice(at, 1);
    render();
    void persist();
  });
  actionsCell.append(remove);

  row.append(enabledCell, projectCell, globsCell, actionsCell);
  return row;
}

/**
 * Renders the problem list for one field and toggles the invalid state.
 * Validation happens in place; a full re-render would steal focus mid-typing.
 *
 * The caller must append `element` and call `refresh()` once to show the initial state.
 */
function problemBinding(
  control: HTMLElement,
  field: 'project' | 'globs',
  rule: Rule,
): { element: HTMLElement; refresh: () => void } {
  const element = document.createElement('div');
  element.className = 'problem';

  const refresh = () => {
    const messages = validateRule(rule)
      .filter((p) => p.field === field)
      .map((p) => p.message);

    element.replaceChildren(
      ...messages.map((text) => {
        const line = document.createElement('div');
        line.textContent = text;
        return line;
      }),
    );

    if (messages.length > 0) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  };

  return { element, refresh };
}

function projectField(rule: Rule, label: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const input = document.createElement('input');
  input.type = 'text';
  input.value = rule.project;
  input.placeholder = ALL_PROJECTS;
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.setAttribute('aria-label', label);

  const { element, refresh } = problemBinding(input, 'project', rule);

  input.addEventListener('input', () => {
    rule.project = input.value;
    refresh();
    queueSave();
  });

  refresh();
  fragment.append(input, element);
  return fragment;
}

/** One glob per line. Comment lines are kept so notes survive a reload. */
function globsField(rule: Rule, label: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  const textarea = document.createElement('textarea');
  textarea.value = formatGlobLines(rule.globs);
  textarea.placeholder = '**/templates/*.yaml\n**/*.gen.ts\n# notes start with #';
  textarea.spellcheck = false;
  textarea.autocapitalize = 'off';
  textarea.setAttribute('aria-label', label);

  const autoGrow = () => {
    // Grow with content rather than scrolling a tiny box; the whole point is seeing
    // the list at a glance.
    const lines = textarea.value.split('\n').length;
    textarea.rows = Math.min(Math.max(lines, MIN_TEXTAREA_ROWS), MAX_TEXTAREA_ROWS);
  };

  const { element, refresh } = problemBinding(textarea, 'globs', rule);

  textarea.addEventListener('input', () => {
    rule.globs = parseGlobLines(textarea.value);
    autoGrow();
    refresh();
    queueSave();
  });

  autoGrow();
  refresh();
  fragment.append(textarea, element);
  return fragment;
}

/**
 * Writes the whole configuration — rules and marking options — to a file the user chooses.
 *
 * Uses the File System Access picker so the file can live anywhere — a repo, a dotfiles
 * directory — rather than being confined to ~/Downloads. Both this and import run inside
 * a click, which is why neither hits the permission decay that makes "write on every
 * change" impractical: the grant only has to last for this one write.
 */
async function exportSettings(): Promise<void> {
  const text = serializeSettings(rules, marking);

  try {
    if ('showSaveFilePicker' in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName: DEFAULT_FILENAME,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
    } else {
      downloadFallback(text);
    }
    setStatus(`Exported ${rules.length} rule(s) and your marking options`);
  } catch (error) {
    // Cancelling the picker is a normal outcome, not a failure worth reporting.
    if (isAbort(error)) return;
    setStatus(`Export failed: ${message(error)}`, true);
  }
}

/** For the unlikely case that the picker is unavailable. Lands in ~/Downloads. */
function downloadFallback(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = DEFAULT_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Replaces the whole configuration from a file.
 *
 * Replacing discards the current rules, so it is confirmed whenever there is anything to
 * lose — reusing the same danger dialog as Unmark all rather than a second implementation.
 */
async function importSettings(): Promise<void> {
  let text: string;
  try {
    if (!('showOpenFilePicker' in window)) {
      setStatus('This browser cannot open a file picker.', true);
      return;
    }
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    if (!handle) return;
    text = await (await handle.getFile()).text();
  } catch (error) {
    if (isAbort(error)) return;
    setStatus(`Import failed: ${message(error)}`, true);
    return;
  }

  const result = parseSettingsFile(text);
  if (!result.ok) {
    setStatus(result.reason, true);
    return;
  }

  if (rules.length > 0) {
    const confirmed = await showDangerConfirm(document, {
      title: 'Replace your rules?',
      body:
        `This replaces your ${rules.length} rule(s) with ${result.rules.length} from ` +
        'the file, and overwrites which file categories may be marked. Your current settings ' +
        'are not kept anywhere else — export them first if you want them back.',
      confirmLabel: `Replace with ${result.rules.length} rule(s)`,
    });
    if (!confirmed) return;
  }

  rules = result.rules;
  marking = result.marking;
  render();
  renderMarking();
  await Promise.all([persist(), persistMarking()]);

  const notes = [
    result.skipped > 0 ? `${result.skipped} unrecognised entr(y/ies) skipped` : null,
    result.warning ?? null,
  ].filter((n): n is string => n !== null);

  // Last word, after the two persists have each set "Saved". Sticky when there is a note,
  // so it cannot be cleared before it has been read.
  setStatus(
    `Imported ${result.rules.length} rule(s)${notes.length ? ` — ${notes.join('; ')}` : ''}`,
    notes.length > 0,
  );
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

exportEl.addEventListener('click', () => void exportSettings());
importEl.addEventListener('click', () => void importSettings());

addEl.addEventListener('click', () => {
  rules.push(newRule());
  render();
  // Focus the globs field: the project scope already defaults to "every project".
  rowsEl.querySelector<HTMLTextAreaElement>('tr:last-child textarea')?.focus();
});

/**
 * Loads stored configuration into the page.
 *
 * A failed read must not look like an empty configuration: the rules are still in sync
 * storage, and an empty table would invite the user to retype them and save over the
 * lot. So the error is sticky, and the Add button stays usable but the page says why
 * it is blank.
 */
async function init(): Promise<void> {
  try {
    [rules, marking] = await Promise.all([loadRules(), loadMarkingOptions()]);
  } catch (error) {
    setStatus(
      `Couldn't load your saved settings (${message(error)}). ` +
        'Nothing shown below is your configuration — reload before editing anything.',
      true,
    );
    return;
  }
  render();
  renderMarking();
  bindMarking();
}

void init();
