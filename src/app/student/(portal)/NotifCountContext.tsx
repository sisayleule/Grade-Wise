'use client';
/**
 * NotifCountContext — shared notification unread count for the student portal.
 *
 * Lifted out of layout.tsx into its own file so that layout.tsx only has a
 * default export (required by Next.js App Router — named exports from layout
 * files must be recognised Next.js segment exports, not custom ones).
 *
 * The context is populated by StudentPortalLayout (layout.tsx) which fetches
 * the count once and shares it here. SidebarContent and the Notifications page
 * both read from this context rather than issuing independent fetches.
 */
import { createContext, useContext } from 'react';

export interface NotifCountCtx {
  unreadCount:       number;
  refreshNotifCount: () => void;
}

export const NotifCountContext = createContext<NotifCountCtx>({
  unreadCount:       0,
  refreshNotifCount: () => {},
});

/** Hook for any component that needs the badge count or wants to refresh it. */
export function useNotifCount(): NotifCountCtx {
  return useContext(NotifCountContext);
}
