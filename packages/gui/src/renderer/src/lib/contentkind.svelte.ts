/**
 * Base for a single "Add content" kind flow. Each kind is a
 * pick -> preview -> apply -> report sub-flow with the same shape.
 *
 * The launcher ({@link AddContentFlow}) composes one instance per kind and drives
 * them through `begin`/`reset`; the dialog reads the active instance's state.
 */
import { FlowStore } from "./flowstore.svelte.js";

export abstract class ContentKindFlow extends FlowStore {
  /** True while an async preview is in flight. */
  previewing = $state(false);

  /** Monotonic guard so a stale preview cannot overwrite a newer selection. */
  protected previewToken = 0;

  /**
   * Injected by the launcher: drop the launcher's open state when this flow
   * routes the user away (e.g. an include that hit conflicts leaves for the
   * Conflict page). Null until the launcher wires it.
   */
  onDismiss: (() => void) | null = null;

  /** Seed this kind's selection for a mod and kick off its first preview. */
  abstract begin(dir: string): void;

  /**
   * Discard this kind's transient state and any in-flight preview. Called by the
   * launcher on back/cancel. Subclasses clear their own fields via
   * {@link clearResult}.
   */
  reset() {
    this.previewToken++;
    this.previewing = false;
    this.dir = null;
    this.resetStatus();
    this.clearResult();
  }

  /** Clear the kind's selection, preview, and report fields. */
  protected abstract clearResult(): void;

  /** Map a core error to a localized error code the dialog renders. */
  protected classifyError(_err: unknown): string {
    return "add-failed";
  }

  /**
   * Run a token-guarded async preview: bump the token, run `load`, and apply the
   * result via `assign` only if the selection has not changed underneath it. A
   * stale result (the user switched selection or left) is discarded.
   */
  protected async runPreview<T>(load: () => Promise<T>, assign: (result: T) => void) {
    const token = ++this.previewToken;
    this.previewing = true;
    this.resetStatus();
    try {
      const result = await load();
      if (token !== this.previewToken) return;
      assign(result);
    } catch (err) {
      if (token !== this.previewToken) return;
      this.errorCode = this.classifyError(err);
      this.errorDetail = (err as Error)?.message ?? null;
    } finally {
      if (token === this.previewToken) this.previewing = false;
    }
  }

  /**
   * Leave the launcher after routing the user elsewhere (the Conflict page).
   * Resets this flow, then asks the launcher to drop its open state. Bypasses no
   * busy guard - it runs mid-apply, with the `busy` lifecycle left to
   * `runGuarded`.
   */
  protected dismiss() {
    this.reset();
    this.onDismiss?.();
  }
}
