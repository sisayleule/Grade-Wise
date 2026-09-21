'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  MdNotifications,
  MdBarChart,
  MdAssignment,
  MdMarkEmailRead,
  MdCircle,
  MdMessage,
} from 'react-icons/md';
import { useNotifCount } from '../NotifCountContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
  id:                string;
  title:             string;
  body:              string;
  notification_type: 'result_published' | 'activity_published' | 'student_message';
  link_type:         'result_batch' | 'activity' | null;
  link_id:           string | null;
  is_read:           boolean;
  created_at:        string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60_000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)   return `${days}d ago`;
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function typeIcon(type: Notification['notification_type']) {
  switch (type) {
    case 'result_published':   return <MdBarChart   size={18} />;
    case 'activity_published': return <MdAssignment size={18} />;
    case 'student_message':    return <MdMessage    size={18} />;
  }
}

function typeIconBg(type: Notification['notification_type']) {
  switch (type) {
    case 'result_published':   return 'bg-brand-50 text-brand-500 dark:bg-navy-700 dark:text-brand-400';
    case 'activity_published': return 'bg-purple-50 text-purple-500 dark:bg-purple-900/20 dark:text-purple-400';
    case 'student_message':    return 'bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-400';
  }
}

/** Convert a notification's link to the student portal URL */
function resolveLink(n: Notification): string | null {
  if (!n.link_type || !n.link_id) return null;
  if (n.link_type === 'result_batch') {
    // batchId may encode a composite Full-Year key joined by |
    return `/student/results/${encodeURIComponent(n.link_id)}`;
  }
  if (n.link_type === 'activity') {
    // Activities page does not have a per-activity drill-down yet —
    // navigate to the list; the student will see the item there.
    return '/student/activities';
  }
  return null;
}

// ── Notification card ─────────────────────────────────────────────────────────

function NotificationCard({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: (id: string) => void;
}) {
  const router = useRouter();
  const link   = resolveLink(notification);

  const handleClick = async () => {
    if (!notification.is_read) {
      onRead(notification.id);
      // Fire-and-forget the mark-read request — don't await so navigation
      // is instant. The parent state update already marks it read optimistically.
      fetch('/api/student/notifications', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: notification.id, is_read: true }),
      }).catch(() => {/* non-fatal */});
    }
    if (link) router.push(link);
  };

  return (
    <button
      onClick={handleClick}
      className={[
        'group flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition',
        notification.is_read
          ? 'border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800'
          : 'border-brand-200 bg-brand-50/60 dark:border-brand-700/40 dark:bg-brand-900/10',
        link ? 'cursor-pointer hover:border-brand-300 hover:shadow-sm dark:hover:border-brand-600' : 'cursor-default',
      ].join(' ')}
      aria-label={notification.is_read ? notification.title : `Unread: ${notification.title}`}
    >
      {/* Type icon */}
      <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${typeIconBg(notification.notification_type)}`}>
        {typeIcon(notification.notification_type)}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-bold leading-snug ${notification.is_read ? 'text-navy-700 dark:text-white' : 'text-navy-900 dark:text-white'}`}>
            {notification.title}
          </p>
          {/* Unread dot */}
          {!notification.is_read && (
            <MdCircle size={9} className="mt-1.5 shrink-0 text-brand-500" />
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {notification.body}
        </p>
        <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
          {timeAgo(notification.created_at)}
        </p>
      </div>
    </button>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6" aria-busy="true" aria-label="Loading notifications…">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-44 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
          <div className="h-4 w-56 animate-pulse rounded-lg bg-gray-100 dark:bg-navy-800" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="flex items-start gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-navy-700 dark:bg-navy-800"
        >
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 animate-pulse rounded-md bg-gray-200 dark:bg-navy-700" />
            <div className="h-3 w-full animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
            <div className="h-3 w-24 animate-pulse rounded-md bg-gray-100 dark:bg-navy-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudentNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [markingAll,    setMarkingAll]    = useState(false);

  // Sync the sidebar badge when this page marks notifications as read.
  const { refreshNotifCount } = useNotifCount();

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetch('/api/student/notifications')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed to load notifications')))
      .then((d) => { if (!cancelled) setNotifications(d.notifications ?? []); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => { load(); }, [load]);

  // Optimistic mark-one-read — also refreshes the sidebar badge
  const handleRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    // Kick the layout to re-fetch the true unread count from the server
    refreshNotifCount();
  };

  // Mark all read — also refreshes the sidebar badge
  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    // Optimistic update first
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      const res = await fetch('/api/student/notifications', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mark_all_read: true }),
      });
      if (!res.ok) throw new Error('Failed');
      // Success — sync the sidebar badge to 0
      refreshNotifCount();
    } catch {
      // Revert optimistic update on failure
      load();
    } finally {
      setMarkingAll(false);
    }
  };

  if (loading) return <Skeleton />;

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-navy-900 dark:text-white">Notifications</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : 'All caught up'}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50 dark:border-navy-700 dark:bg-navy-800 dark:text-gray-400 dark:hover:border-brand-600 dark:hover:text-brand-400"
          >
            <MdMarkEmailRead size={17} />
            Mark all as read
          </button>
        )}
      </div>

      {/* Empty state */}
      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-navy-700 dark:bg-navy-800">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-3xl text-brand-400 dark:bg-navy-700">
            <MdNotifications />
          </div>
          <h2 className="mt-5 text-lg font-bold text-navy-900 dark:text-white">
            No notifications yet
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            You'll be notified here when your teacher publishes results or activity scores.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onRead={handleRead}
            />
          ))}
        </div>
      )}
    </div>
  );
}
