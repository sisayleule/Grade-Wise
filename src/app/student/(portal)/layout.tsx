'use client';
import { type ReactNode, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from 'lib/supabase/client';
import {
  MdSchool,
  MdBarChart,
  MdHistory,
  MdLogout,
  MdMenu,
  MdClose,
  MdPerson,
  MdAssignment,
  MdNotifications,
  MdSupportAgent,
} from 'react-icons/md';
import { StudentProvider, useStudent } from './StudentContext';
import { NotifCountContext, useNotifCount } from './NotifCountContext';

// ── Types ──────────────────────────────────────────────────────────────────────
interface NavItem {
  label:    string;
  href:     string;
  icon:     ReactNode;
  badgeKey?: 'notifications';
}

// ── Nav definition ────────────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { label: 'Profile',          href: '/student',               icon: <MdPerson        size={20} /> },
  { label: 'Results',          href: '/student/results',       icon: <MdBarChart      size={20} /> },
  { label: 'My Activities',    href: '/student/activities',    icon: <MdAssignment    size={20} /> },
  { label: 'Academic History', href: '/student/history',       icon: <MdHistory       size={20} /> },
  { label: 'Notifications',    href: '/student/notifications', icon: <MdNotifications size={20} />, badgeKey: 'notifications' },
  { label: 'Contact & Support',href: '/student/contact',       icon: <MdSupportAgent  size={20} /> },
];

// ── StudentAvatar ─────────────────────────────────────────────────────────────
// Data comes from StudentContext — no independent fetch.
function StudentAvatar() {
  const { student } = useStudent();
  const name = student?.full_name ?? '';
  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?';

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-blueSecondary text-sm font-bold text-white shadow">
        {initials}
      </div>
      {name && (
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-navy-900 dark:text-white">{name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Student</p>
        </div>
      )}
    </div>
  );
}

// ── SidebarContent ────────────────────────────────────────────────────────────
// Rendered twice (desktop sidebar + mobile drawer) but reads the notification
// count from context — never fetches independently.
function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();
  const { unreadCount } = useNotifCount();

  const badgeCounts: Record<string, number> = {
    notifications: unreadCount,
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth/sign-in');
    router.refresh();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="mb-6 flex items-center gap-2.5 px-3 pt-1">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary text-lg text-white shadow">
          <MdSchool />
        </div>
        <div>
          <p className="text-base font-black text-navy-900 dark:text-white leading-none">GradeWise</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">Student Portal</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ label, href, icon, badgeKey }) => {
          const isActive =
            href === '/student'
              ? pathname === '/student'
              : pathname.startsWith(href);

          const badgeCount = badgeKey ? (badgeCounts[badgeKey] ?? 0) : 0;

          return (
            <Link
              key={href}
              href={href}
              onClick={onNavClick}
              className={[
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-brand-500 text-white shadow-[0_4px_14px_rgba(67,24,255,0.3)]'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700',
              ].join(' ')}
            >
              {icon}
              <span className="flex-1">{label}</span>
              {badgeCount > 0 && (
                <span
                  className={[
                    'ml-auto grid min-w-[20px] place-items-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none',
                    isActive
                      ? 'bg-white/25 text-white'
                      : 'bg-brand-500 text-white',
                  ].join(' ')}
                >
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Avatar + sign-out */}
      <div className="mt-4 border-t border-gray-200 pt-4 dark:border-navy-700">
        <StudentAvatar />
        <button
          onClick={handleSignOut}
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700"
        >
          <MdLogout size={20} />
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Portal layout ─────────────────────────────────────────────────────────────
export default function StudentPortalLayout({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Notification unread count — single fetch, shared via context ──────────
  // Previously this lived inside SidebarContent, meaning it ran twice on every
  // mount (desktop sidebar + mobile drawer), and again every time the mobile
  // drawer opened (remount). Moving it here means exactly one fetch per layout
  // mount, regardless of how many times SidebarContent renders.
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifTick,   setNotifTick]   = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/student/notifications?limit=1&unread=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setUnreadCount(d.unread_count ?? 0); })
      .catch(() => {/* non-fatal — badge stays at 0 */});
    return () => { cancelled = true; };
  }, [notifTick]);

  // Exposed via context so the Notifications page can refresh the badge after
  // marking all notifications as read.
  const refreshNotifCount = useCallback(() => setNotifTick((t) => t + 1), []);

  return (
    <StudentProvider>
      <NotifCountContext.Provider value={{ unreadCount, refreshNotifCount }}>
        <div className="flex min-h-screen bg-lightPrimary font-dm dark:bg-navy-900">

          {/* ── Desktop sidebar ──────────────────────────────────────────── */}
          <aside className="hidden w-64 shrink-0 lg:flex lg:flex-col">
            <div className="sticky top-0 h-screen overflow-y-auto border-r border-gray-200 bg-white px-4 py-6 dark:border-navy-700 dark:bg-navy-800">
              <SidebarContent />
            </div>
          </aside>

          {/* ── Mobile drawer backdrop ───────────────────────────────────── */}
          {drawerOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/40 lg:hidden"
              onClick={() => setDrawerOpen(false)}
            />
          )}

          {/* ── Mobile drawer ────────────────────────────────────────────── */}
          <aside
            className={[
              'fixed inset-y-0 left-0 z-40 w-64 border-r border-gray-200 bg-white px-4 py-6 transition-transform dark:border-navy-700 dark:bg-navy-800 lg:hidden',
              drawerOpen ? 'translate-x-0' : '-translate-x-full',
            ].join(' ')}
          >
            <button
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700"
              aria-label="Close menu"
            >
              <MdClose size={22} />
            </button>
            <SidebarContent onNavClick={() => setDrawerOpen(false)} />
          </aside>

          {/* ── Main content ─────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile topbar */}
            <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-navy-700 dark:bg-navy-800 lg:hidden">
              <button
                onClick={() => setDrawerOpen(true)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700"
                aria-label="Open menu"
              >
                <MdMenu size={24} />
              </button>
              <div className="flex items-center gap-2">
                <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-blueSecondary text-sm text-white">
                  <MdSchool />
                </div>
                <span className="text-sm font-black text-navy-900 dark:text-white">GradeWise</span>
              </div>
            </header>

            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
              {children}
            </main>
          </div>

        </div>
      </NotifCountContext.Provider>
    </StudentProvider>
  );
}
