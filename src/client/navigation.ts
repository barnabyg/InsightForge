import type { MouseEvent } from 'react';

/** Follow a workspace link without interrupting an in-flight generation request. */
export function followWorkspaceLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
    || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.history.pushState(null, '', event.currentTarget.href);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}
