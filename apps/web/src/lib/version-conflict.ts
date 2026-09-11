/**
 * A version conflict is not a message to read and dismiss: the user has a form full of edits and
 * has to choose between reloading and keeping them (§7.7.4 rule 3). The dialog lives at the root,
 * so `handleApiError` opens it from anywhere through this tiny store.
 */
export interface VersionConflict {
  /** Refetches the record the form was editing. */
  onReload: () => void;
}

let conflict: VersionConflict | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const versionConflictStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): VersionConflict | null {
    return conflict;
  },
  open(next: VersionConflict): void {
    conflict = next;
    emit();
  },
  close(): void {
    conflict = null;
    emit();
  },
} as const;
