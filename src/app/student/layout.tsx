/**
 * Root student layout — intentionally minimal.
 *
 * /student/pending and /student/rejected render as standalone centered
 * screens (no sidebar). Only pages inside (portal) get the nav layout
 * (via their own nested layout.tsx).
 *
 * This file exists solely to satisfy Next.js segment layout resolution
 * and to set the shared font + background class at the student tree root.
 */
import type { ReactNode } from 'react';

export default function StudentRootLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
