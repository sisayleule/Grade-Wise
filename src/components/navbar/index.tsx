'use client';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import Dropdown from 'components/dropdown';
import { FiAlignJustify } from 'react-icons/fi';
import NavLink from 'components/link/NavLink';
import navbarimage from '/public/img/layout/Navbar.png';
import { BsArrowBarUp } from 'react-icons/bs';
import { FiSearch } from 'react-icons/fi';
import { RiMoonFill, RiSunFill } from 'react-icons/ri';
import {
  IoMdNotificationsOutline,
  IoMdInformationCircleOutline,
} from 'react-icons/io';
import {
  MdBarChart,
  MdAssignment,
  MdMessage,
  MdMarkEmailRead,
  MdCircle,
} from 'react-icons/md';
import avatar from '/public/img/avatars/avatar4.png';
import Image from 'next/image';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeacherNotification {
  id:                string;
  title:             string;
  body:              string;
  notification_type: 'result_published' | 'activity_published' | 'student_message';
  link_type:         string | null;
  link_id:           string | null;
  is_read:           boolean;
  created_at:        string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60_000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `${days}d ago`;
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function typeIcon(type: TeacherNotification['notification_type']) {
  switch (type) {
    case 'result_published':   return <MdBarChart   size={20} className="text-brand-500" />;
    case 'activity_published': return <MdAssignment size={20} className="text-purple-500" />;
    case 'student_message':    return <MdMessage    size={20} className="text-cyan-500" />;
  }
}

// ── Notification item ─────────────────────────────────────────────────────────

function NotifItem({
  n,
  onMarkRead,
}: {
  n: TeacherNotification;
  onMarkRead: (id: string) => void;
}) {
  const handleClick = () => {
    if (!n.is_read) {
      onMarkRead(n.id);
      fetch('/api/notifications', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: n.id, is_read: true }),
      }).catch(() => {});
    }
  };

  return (
    <button
      onClick={handleClick}
      className={[
        'flex w-full items-start gap-3 rounded-xl p-3 text-left transition',
        n.is_read
          ? 'hover:bg-gray-50 dark:hover:bg-navy-700/50'
          : 'bg-brand-50/60 hover:bg-brand-50 dark:bg-brand-900/10 dark:hover:bg-brand-900/20',
      ].join(' ')}
    >
      {/* Icon */}
      <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gray-100 dark:bg-navy-700">
        {typeIcon(n.notification_type)}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-bold leading-snug text-navy-700 dark:text-white line-clamp-1">
            {n.title}
          </p>
          {!n.is_read && (
            <MdCircle size={8} className="mt-1.5 shrink-0 text-brand-500" />
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-2">
          {n.body}
        </p>
        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
          {timeAgo(n.created_at)}
        </p>
      </div>
    </button>
  );
}

// ── Main Navbar ───────────────────────────────────────────────────────────────

const Navbar = (props: {
  onOpenSidenav: () => void;
  brandText: string;
  secondary?: boolean | string;
  [x: string]: any;
}) => {
  const { onOpenSidenav, brandText, mini, hovered } = props;
  const [darkmode, setDarkmode] = React.useState(
    document.body.classList.contains('dark'),
  );

  // ── Notification state ──────────────────────────────────────────────────
  const [notifications, setNotifications] = useState<TeacherNotification[]>([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [notifLoading,  setNotifLoading]  = useState(false);
  const fetchedRef = useRef(false);

  const loadNotifications = useCallback(async () => {
    if (notifLoading) return;
    setNotifLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      // non-fatal — keep previous state
    } finally {
      setNotifLoading(false);
    }
  }, [notifLoading]);

  // Load once on mount
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    loadNotifications();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optimistic mark-one-read
  const handleMarkOne = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  // Mark all read
  const handleMarkAll = async () => {
    if (unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    await fetch('/api/notifications', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mark_all_read: true }),
    }).catch(() => {});
  };

  return (
    <nav className="sticky top-4 z-40 flex flex-row flex-wrap items-center justify-between rounded-xl bg-white/10 p-2 backdrop-blur-xl dark:bg-[#0b14374d]">
      <div className="ml-[6px]">
        <div className="h-6 w-[224px] pt-1">
          <a
            className="text-sm font-normal text-navy-700 hover:underline dark:text-white dark:hover:text-white"
            href=" "
          >
            Pages
            <span className="mx-1 text-sm text-navy-700 hover:text-navy-700 dark:text-white">
              {' '}
              /{' '}
            </span>
          </a>
          <NavLink
            className="text-sm font-normal capitalize text-navy-700 hover:underline dark:text-white dark:hover:text-white"
            href="#"
          >
            {brandText}
          </NavLink>
        </div>
        <p className="shrink text-[33px] capitalize text-navy-700 dark:text-white">
          <NavLink
            href="#"
            className="font-bold capitalize hover:text-navy-700 dark:hover:text-white"
          >
            {brandText}
          </NavLink>
        </p>
      </div>

      <div className="relative mt-[3px] flex h-[61px] w-[355px] flex-grow items-center justify-around gap-2 rounded-full bg-white px-2 py-2 shadow-xl shadow-shadow-500 dark:!bg-navy-800 dark:shadow-none md:w-[365px] md:flex-grow-0 md:gap-1 xl:w-[365px] xl:gap-2">
        <div className="flex h-full items-center rounded-full bg-lightPrimary text-navy-700 dark:bg-navy-900 dark:text-white xl:w-[225px]">
          <p className="pl-3 pr-2 text-xl">
            <FiSearch className="h-4 w-4 text-gray-400 dark:text-white" />
          </p>
          <input
            type="text"
            placeholder="Search..."
            className="block h-full w-full rounded-full bg-lightPrimary text-sm font-medium text-navy-700 outline-none placeholder:!text-gray-400 dark:bg-navy-900 dark:text-white dark:placeholder:!text-white sm:w-fit"
          />
        </div>
        <span
          className="flex cursor-pointer text-xl text-gray-600 dark:text-white xl:hidden"
          onClick={onOpenSidenav}
        >
          <FiAlignJustify className="h-5 w-5" />
        </span>

        {/* ── Notifications bell ─────────────────────────────────────────── */}
        <Dropdown
          button={
            <div className="relative cursor-pointer">
              <IoMdNotificationsOutline className="h-4 w-4 text-gray-600 dark:text-white" />
              {/* Unread count badge — replaces the old static red dot */}
              {unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid min-w-[16px] place-items-center rounded-full bg-brand-500 px-1 py-px text-[9px] font-bold leading-none text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
          }
          animation="origin-[65%_0%] md:origin-top-right transition-all duration-300 ease-in-out"
          classNames={'py-2 top-4 -left-[230px] md:-left-[440px] w-max'}
        >
          <div className="flex w-[360px] flex-col rounded-[20px] bg-white shadow-xl shadow-shadow-500 dark:!bg-navy-700 dark:text-white dark:shadow-none sm:w-[400px]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-navy-600">
              <p className="text-base font-bold text-navy-700 dark:text-white">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-600 dark:bg-navy-600 dark:text-brand-300">
                    {unreadCount} new
                  </span>
                )}
              </p>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  <MdMarkEmailRead size={14} />
                  Mark all read
                </button>
              )}
            </div>

            {/* Notification list */}
            <div className="max-h-[360px] overflow-y-auto px-2 py-2">
              {notifLoading && notifications.length === 0 ? (
                /* Loading skeleton */
                <div className="space-y-2 p-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3 rounded-xl p-3">
                      <div className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-gray-100 dark:bg-navy-600" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3.5 w-3/4 animate-pulse rounded bg-gray-100 dark:bg-navy-600" />
                        <div className="h-3 w-full  animate-pulse rounded bg-gray-100 dark:bg-navy-600" />
                        <div className="h-2.5 w-1/3 animate-pulse rounded bg-gray-100 dark:bg-navy-600" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : notifications.length === 0 ? (
                /* Empty state */
                <div className="px-4 py-8 text-center">
                  <IoMdNotificationsOutline className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
                  <p className="mt-3 text-sm font-semibold text-gray-500 dark:text-gray-400">
                    No notifications yet
                  </p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Student messages will appear here.
                  </p>
                </div>
              ) : (
                notifications.map((n) => (
                  <NotifItem key={n.id} n={n} onMarkRead={handleMarkOne} />
                ))
              )}
            </div>
          </div>
        </Dropdown>

        {/* ── Info dropdown ─────────────────────────────────────────────── */}
        <Dropdown
          button={
            <p className="cursor-pointer">
              <IoMdInformationCircleOutline className="h-4 w-4 text-gray-600 dark:text-white" />
            </p>
          }
          classNames={'py-2 top-6 -left-[250px] md:-left-[330px] w-max'}
          animation="origin-[75%_0%] md:origin-top-right transition-all duration-300 ease-in-out"
        >
          <div className="flex w-[350px] flex-col gap-2 rounded-[20px] bg-white p-4 shadow-xl shadow-shadow-500 dark:!bg-navy-700 dark:text-white dark:shadow-none">
            <div
              style={{
                backgroundImage: `url(${navbarimage.src})`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'cover',
              }}
              className="mb-2 aspect-video w-full rounded-lg"
            />
            <a
              href="#!"
              className="px-full linear flex cursor-pointer items-center justify-center rounded-xl bg-brand-500 py-[11px] font-bold text-white transition duration-200 hover:bg-brand-600 hover:text-white active:bg-brand-700 dark:bg-brand-400 dark:hover:bg-brand-300 dark:active:bg-brand-200"
            >
              Download now
            </a>
            <a
              href="#!"
              className="px-full linear flex cursor-pointer items-center justify-center rounded-xl border py-[11px] font-bold text-navy-700 transition duration-200 hover:bg-gray-200 hover:text-navy-700 dark:!border-white/10 dark:text-white dark:hover:bg-white/20 dark:hover:text-white dark:active:bg-white/10"
            >
              See Documentation
            </a>
            <a
              href="#!"
              className="hover:bg-black px-full linear flex cursor-pointer items-center justify-center rounded-xl py-[11px] font-bold text-navy-700 transition duration-200 hover:text-navy-700 dark:text-white dark:hover:text-white"
            >
              Try GradeWise Free
            </a>
          </div>
        </Dropdown>

        {/* ── Dark mode toggle ─────────────────────────────────────────── */}
        <div
          className="cursor-pointer text-gray-600"
          onClick={() => {
            if (darkmode) {
              document.body.classList.remove('dark');
              setDarkmode(false);
            } else {
              document.body.classList.add('dark');
              setDarkmode(true);
            }
          }}
        >
          {darkmode ? (
            <RiSunFill className="h-4 w-4 text-gray-600 dark:text-white" />
          ) : (
            <RiMoonFill className="h-4 w-4 text-gray-600 dark:text-white" />
          )}
        </div>

        {/* ── Profile dropdown ─────────────────────────────────────────── */}
        <Dropdown
          button={
            <Image
              width="2"
              height="20"
              className="h-10 w-10 rounded-full"
              src={avatar}
              alt="Elon Musk"
            />
          }
          classNames={'py-2 top-8 -left-[180px] w-max'}
        >
          <div className="flex h-48 w-56 flex-col justify-start rounded-[20px] bg-white bg-cover bg-no-repeat shadow-xl shadow-shadow-500 dark:!bg-navy-700 dark:text-white dark:shadow-none">
            <div className="ml-4 mt-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-navy-700 dark:text-white">
                  👋 Hey, Adela
                </p>{' '}
              </div>
            </div>
            <div className="mt-3 h-px w-full bg-gray-200 dark:bg-white/20 " />

            <div className="ml-4 mt-3 flex flex-col">
              <a
                href=" "
                className="text-sm text-gray-800 dark:text-white hover:dark:text-white"
              >
                Profile Settings
              </a>
              <a
                href=" "
                className="mt-3 text-sm text-gray-800 dark:text-white hover:dark:text-white"
              >
                Newsletter Settings
              </a>
              <a
                href=" "
                className="mt-3 text-sm font-medium text-red-500 hover:text-red-500"
              >
                Log Out
              </a>
            </div>
          </div>
        </Dropdown>
      </div>
    </nav>
  );
};

export default Navbar;
