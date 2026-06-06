/**
 * Tiny imperative dialog opener — mounts a component into a fresh root,
 * provides a `close` callback, and unmounts cleanly. Used by openProjectWizard,
 * openWorktreeDialog, etc. so calling code can fire-and-forget from a button.
 *
 * We avoid a global modal-state context here because there are at most one or
 * two dialogs open at once and the imperative API is a much smaller surface.
 */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";

export function openDialog(
  render: (close: () => void) => React.ReactElement,
): { close: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const close = () => {
    root.unmount();
    container.remove();
  };

  root.render(render(close));
  return { close };
}
