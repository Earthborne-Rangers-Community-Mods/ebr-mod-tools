/**
 * A store {@link runGuarded} can drive: it exposes the reactive `busy` and
 * `errorCode` fields the guard toggles.
 * @typedef {{ busy: boolean, errorCode: string | null }} GuardableStore
 */

/**
 * Shared busy-guard for async store operations. Bail if already busy,
 * flip `busy` on, clear the error, run the work, record an error code on throw,
 * and always clear `busy`.
 *
 * The store's `busy` and `errorCode` are Svelte `$state` fields; assigning them
 * from here is reactive because they are reactive properties on the instance.
 *
 * @template T
 * @param {GuardableStore} store - The reactive store instance.
 * @param {string} errorCode - Error code to set on the store if `fn` throws.
 * @param {() => Promise<T>} fn - The async operation. Sub-flags it sets should be
 *   reset via `finalize`, not left to this runner.
 * @param {object} [hooks]
 * @param {(err: unknown) => void} [hooks.onError] - Runs after `errorCode` is set,
 *   e.g. to capture the thrown message into a detail field.
 * @param {() => void} [hooks.finalize] - Runs in `finally` after `busy` is cleared,
 *   e.g. to reset a per-operation sub-flag or progress.
 * @returns {Promise<void>}
 */
export async function runGuarded(store, errorCode, fn, { onError, finalize } = {}) {
  if (store.busy) return;
  store.busy = true;
  store.errorCode = null;
  try {
    await fn();
  } catch (err) {
    store.errorCode = errorCode;
    onError?.(err);
  } finally {
    store.busy = false;
    finalize?.();
  }
}
