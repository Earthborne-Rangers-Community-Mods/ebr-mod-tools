/**
 * Shared spine for the GUI's modal flow stores. This base owns the core state:
 * the `dir` open/close handle, the `runGuarded` lifecycle, the `isOpen` getter,
 * and a status reset. Subclasses add their own fields and run methods on top.
 */
export class FlowStore {
  /** Directory of the mod this flow acts on; non-null while the modal is open. */
  dir = $state<string | null>(null);

  /** True while the flow's async operation runs. */
  busy = $state(false);
  /** Error code from the last run, localized by the component, or null. */
  errorCode = $state<string | null>(null);
  /** Detail message from a failed run, surfaced with the error. */
  errorDetail = $state<string | null>(null);
  /** Live progress message during a run. */
  progress = $state<string | null>(null);

  /** Whether the modal is open. */
  get isOpen() {
    return this.dir !== null;
  }

  /** Clear the transient run state. */
  protected resetStatus() {
    this.errorCode = null;
    this.errorDetail = null;
    this.progress = null;
  }
}
