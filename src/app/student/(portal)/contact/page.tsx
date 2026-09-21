'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  MdSend,
  MdSupportAgent,
  MdCheckCircle,
  MdArchive,
  MdHourglassTop,
  MdExpandMore,
  MdExpandLess,
  MdPerson,
  MdSchool,
} from 'react-icons/md';

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = 'complaint' | 'recommendation' | 'question' | 'other';
type Status   = 'pending' | 'resolved' | 'archived';

interface MessageThread {
  id:          string;
  category:    Category;
  message:     string;
  status:      Status;
  created_at:  string;
  updated_at:  string;
  reply_count: number;
}

interface Reply {
  id:          string;
  sender_type: 'teacher' | 'student';
  reply_text:  string;
  created_at:  string;
}

interface Thread {
  id:         string;
  category:   Category;
  message:    string;
  status:     Status;
  created_at: string;
  replies:    Reply[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<Category, string> = {
  complaint:      'Complaint',
  recommendation: 'Recommendation',
  question:       'Question',
  other:          'Other',
};

const STATUS_CONFIG: Record<Status, { label: string; cls: string; icon: typeof MdHourglassTop }> = {
  pending:  { label: 'Pending',  cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',            icon: MdHourglassTop },
  resolved: { label: 'Resolved', cls: 'bg-horizonGreen-50 text-horizonGreen-700 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300', icon: MdCheckCircle },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400',                  icon: MdArchive },
};

const CATEGORY_BADGE: Record<Category, string> = {
  complaint:      'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  recommendation: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
  question:       'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
  other:          'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-400',
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

// ── New message form ──────────────────────────────────────────────────────────

function NewMessageForm({ onSent }: { onSent: () => void }) {
  const [category, setCategory] = useState<Category>('question');
  const [message,  setMessage]  = useState('');
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError('');
    setSuccess(false);

    try {
      const res = await fetch('/api/messages', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category, message: message.trim() }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to send message');
      }

      setMessage('');
      setCategory('question');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
      onSent();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-navy-700 dark:bg-navy-800"
    >
      <h2 className="mb-4 text-base font-bold text-navy-900 dark:text-white">
        Send a new message
      </h2>

      {/* Category */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          Category
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-navy-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
        >
          {(Object.entries(CATEGORY_LABELS) as [Category, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Message */}
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          Message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Describe your complaint, recommendation, or question…"
          className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-navy-900 outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
        />
        <p className="mt-1 text-right text-xs text-gray-400 dark:text-gray-500">
          {message.length} / 2000
        </p>
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {success && (
        <p className="mb-3 flex items-center gap-2 rounded-xl border border-horizonGreen-200 bg-horizonGreen-50 px-4 py-2.5 text-sm font-semibold text-horizonGreen-700 dark:border-horizonGreen-700/40 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300">
          <MdCheckCircle size={16} />
          Message sent! Your teacher will be notified.
        </p>
      )}

      <button
        type="submit"
        disabled={sending || !message.trim()}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(67,24,255,0.25)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MdSend size={16} />
        {sending ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  );
}

// ── Thread reply box ──────────────────────────────────────────────────────────

function ReplyBox({
  messageId,
  onReplied,
}: {
  messageId: string;
  onReplied: (reply: Reply) => void;
}) {
  const [text,    setText]    = useState('');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setError('');

    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reply_text: text.trim() }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to send reply');
      }

      const data = await res.json();
      setText('');
      onReplied(data.reply as Reply);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 border-t border-gray-100 pt-3 dark:border-navy-700">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Write a follow-up message…"
        className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-navy-900 outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:border-brand-500"
      />
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          <MdSend size={13} />
          {sending ? 'Sending…' : 'Reply'}
        </button>
      </div>
    </form>
  );
}

// ── Thread card ───────────────────────────────────────────────────────────────

function ThreadCard({ thread: initial }: { thread: MessageThread }) {
  const [open,    setOpen]    = useState(false);
  const [thread,  setThread]  = useState<Thread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const fetchedRef = useRef(false);

  const loadThread = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/messages/${initial.id}`);
      if (!res.ok) throw new Error('Failed to load thread');
      const d = await res.json();
      setThread(d.thread);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [initial.id, loading]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !fetchedRef.current) {
      fetchedRef.current = true;
      loadThread();
    }
  };

  const handleReplied = (reply: Reply) => {
    setThread((prev) =>
      prev ? { ...prev, replies: [...prev.replies, reply] } : prev
    );
  };

  const statusCfg = STATUS_CONFIG[initial.status];
  const StatusIcon = statusCfg.icon;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-navy-700 dark:bg-navy-800">
      {/* Summary row */}
      <button
        onClick={handleToggle}
        className="flex w-full items-start gap-3 p-5 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${CATEGORY_BADGE[initial.category]}`}>
              {CATEGORY_LABELS[initial.category]}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusCfg.cls}`}>
              <StatusIcon size={11} />
              {statusCfg.label}
            </span>
            {initial.reply_count > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {initial.reply_count} {initial.reply_count === 1 ? 'reply' : 'replies'}
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-navy-700 dark:text-gray-300">
            {initial.message}
          </p>
          <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
            {formatDate(initial.created_at)}
          </p>
        </div>
        <div className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500">
          {open ? <MdExpandLess size={20} /> : <MdExpandMore size={20} />}
        </div>
      </button>

      {/* Expanded thread */}
      {open && (
        <div className="border-t border-gray-100 px-5 pb-5 dark:border-navy-700">
          {loading && (
            <div className="space-y-3 pt-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-navy-700" />
                    <div className="h-3 w-full animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-500">{error}</p>
          )}

          {thread && (
            <>
              {/* Original message */}
              <div className="mt-4 flex gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                  <MdPerson size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-navy-700 dark:text-white">You</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                    {thread.message}
                  </p>
                  <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                    {formatDate(thread.created_at)}
                  </p>
                </div>
              </div>

              {/* Replies */}
              {thread.replies.map((r) => (
                <div key={r.id} className={`mt-3 flex gap-3 ${r.sender_type === 'teacher' ? '' : 'flex-row-reverse'}`}>
                  <div className={[
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm',
                    r.sender_type === 'teacher'
                      ? 'bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400'
                      : 'bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300',
                  ].join(' ')}>
                    {r.sender_type === 'teacher' ? <MdSchool size={15} /> : <MdPerson size={15} />}
                  </div>
                  <div className={`min-w-0 flex-1 ${r.sender_type === 'student' ? 'text-right' : ''}`}>
                    <p className="text-xs font-bold text-navy-700 dark:text-white">
                      {r.sender_type === 'teacher' ? 'Teacher' : 'You'}
                    </p>
                    <div className={[
                      'mt-0.5 inline-block max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm',
                      r.sender_type === 'teacher'
                        ? 'bg-gray-50 text-navy-700 dark:bg-navy-700/60 dark:text-gray-200'
                        : 'bg-brand-50 text-brand-800 dark:bg-brand-900/20 dark:text-brand-200',
                    ].join(' ')}>
                      <p className="whitespace-pre-wrap">{r.reply_text}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                      {formatDate(r.created_at)}
                    </p>
                  </div>
                </div>
              ))}

              {/* Reply box — only if not archived */}
              {thread.status !== 'archived' && (
                <ReplyBox messageId={thread.id} onReplied={handleReplied} />
              )}

              {thread.status === 'archived' && (
                <p className="mt-3 text-center text-xs text-gray-400 dark:text-gray-500">
                  This thread has been archived.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudentContactPage() {
  const [threads,  setThreads]  = useState<MessageThread[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [tick,     setTick]     = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/student/messages')
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('Failed to load messages')))
      .then((d) => { if (!cancelled) setThreads(d.messages ?? []); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick]);

  const handleSent = () => setTick((t) => t + 1);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-navy-900 dark:text-white">Contact &amp; Support</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Send a complaint, recommendation, question, or other message to your teacher.
        </p>
      </div>

      {/* New message form */}
      <NewMessageForm onSent={handleSent} />

      {/* Past messages */}
      <div>
        <h2 className="mb-3 text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Your messages
        </h2>

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-navy-700 dark:bg-navy-800">
                <div className="flex gap-2">
                  <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
                  <div className="h-5 w-16 animate-pulse rounded-full bg-gray-100 dark:bg-navy-800" />
                </div>
                <div className="mt-2 h-4 w-full animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                <div className="mt-1 h-3 w-24 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        ) : threads.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-navy-700 dark:bg-navy-800">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-3xl text-brand-400 dark:bg-navy-700">
              <MdSupportAgent />
            </div>
            <h3 className="mt-4 text-base font-bold text-navy-900 dark:text-white">
              No messages yet
            </h3>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
              Use the form above to send your first message to your teacher.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {threads.map((t) => (
              <ThreadCard key={t.id} thread={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
