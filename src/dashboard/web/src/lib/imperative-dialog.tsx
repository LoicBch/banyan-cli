/**
 * Tiny imperative dialog opener — mounts a component into a fresh root,
 * provides a `close` callback, and unmounts cleanly. Used by openProjectWizard,
 * openWorktreeDialog, etc. so calling code can fire-and-forget from a button.
 *
 * Tracks an open-dialog count via a body data attribute so the global
 * keyboard hook (useKeyboard) knows to suppress its bindings while
 * something is in front of the user. We also `mark()` from CommandPalette
 * (which lives in the React tree, not via openDialog) so detection stays
 * uniform.
 *
 * We avoid a global modal-state context here because there are at most one or
 * two dialogs open at once and the imperative API is a much smaller surface.
 */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

const BODY_ATTR = "data-banyan-dialog-open";
let openCount = 0;

function incrementOpen(): void {
  openCount += 1;
  if (openCount > 0) document.body.setAttribute(BODY_ATTR, String(openCount));
}

function decrementOpen(): void {
  openCount = Math.max(0, openCount - 1);
  if (openCount === 0) document.body.removeAttribute(BODY_ATTR);
  else document.body.setAttribute(BODY_ATTR, String(openCount));
}

/** True while any dialog (imperative or React-tree) is open. Used by
 *  global keyboard handlers to suppress page shortcuts. */
export function isAnyDialogOpen(): boolean {
  return openCount > 0;
}

/** React-tree dialogs (CommandPalette, future Radix Dialogs) call this in
 *  a useEffect tied to their open state so the count stays consistent. */
export function useDialogMark(isOpen: boolean): void {
  React.useEffect(() => {
    if (!isOpen) return;
    incrementOpen();
    return () => decrementOpen();
  }, [isOpen]);
}

export function openDialog(
  render: (close: () => void) => React.ReactElement,
): { close: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  incrementOpen();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    decrementOpen();
    root.unmount();
    container.remove();
  };

  root.render(render(close));
  return { close };
}
