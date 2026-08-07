/**
 * File System Access pickers.
 *
 * TypeScript's DOM lib already declares `FileSystemFileHandle`, `createWritable` and
 * `FileSystemWritableFileStream` (they came in with OPFS), but not `showSaveFilePicker`
 * / `showOpenFilePicker` — those are not fully standardised, so they are omitted. Rather
 * than pull in `@types/wicg-file-system-access` for two signatures, declare just what is
 * used here.
 *
 * Both are feature-detected at the call site (`'showSaveFilePicker' in window`), because
 * declaring a type does not make the API exist.
 */

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string | string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  id?: string;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
  id?: string;
}

interface Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
