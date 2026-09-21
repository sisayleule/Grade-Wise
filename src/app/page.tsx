'use client';
import { ChangeEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from 'lib/supabase/client';

// ── Lazy-loaded page components ───────────────────────────────────────────────
// Each loads only when the teacher first clicks that nav item.
// This keeps the initial JS bundle small and makes every nav click instant —
// the component chunk is fetched once in the background; subsequent clicks
// are instant from cache.
const Report               = dynamic(() => import('components/sgms/Report'),       { ssr: false });
const RosterComponent      = dynamic(() => import('components/sgms/Roster'),       { ssr: false });
const AssessmentsComponent = dynamic(() => import('components/sgms/Assessments'),  { ssr: false });
const GeminiKeyField       = dynamic(() => import('components/sgms/GeminiKeyField'), { ssr: false });
const Charts               = dynamic(() => import('./Charts'),                      { ssr: false });
import {
  ALL_VALID_PERIODS,
  Batch,
  basePeriods,
  buildAnnual,
  buildAnnualFromBatches,
  computeResults,
  getLetterGrade,
  initialRows,
  PeriodSystem,
  QUARTER_PERIODS,
  Result,
  School,
  ScoreRow,
  validateRows,
} from 'lib/grades';
import { extractFromFile } from 'lib/extract';
import {
  MdAdd,
  MdAdminPanelSettings,
  MdArrowBack,
  MdAssignment,
  MdCheckCircle,
  MdChevronRight,
  MdClose,
  MdCloudUpload,
  MdDarkMode,
  MdDashboard,
  MdDeleteOutline,
  MdDescription,
  MdDownload,
  MdEmojiEvents,
  MdErrorOutline,
  MdFormatListBulleted,
  MdGridOn,
  MdGroups,
  MdHelpOutline,
  MdHourglassTop,
  MdImage,
  MdLayers,
  MdLightMode,
  MdLogout,
  MdMenu,
  MdMessage,
  MdNotificationsNone,
  MdPeopleAlt,
  MdSend,
  MdSupportAgent,
  MdPictureAsPdf,
  MdPublish,
  MdSchool,
  MdSearch,
  MdSettings,
  MdTableChart,
  MdTrendingUp,
  MdUpload,
  MdWarningAmber,
  MdWorkspacePremium,
} from 'react-icons/md';

type Page =
  | 'dashboard'
  | 'upload'
  | 'roster'
  | 'assessments'
  | 'students'
  | 'classes'
  | 'rankings'
  | 'reports'
  | 'settings'
  | 'messages';
const nav: { id: Page; label: string; icon: any }[] = [
  { id: 'dashboard',   label: 'Dashboard',            icon: MdDashboard },
  { id: 'upload',      label: 'Upload Results',        icon: MdCloudUpload },
  { id: 'roster',      label: 'Class Roster',          icon: MdFormatListBulleted },
  { id: 'assessments', label: 'Assessments',           icon: MdAssignment },
  { id: 'students',    label: 'Students',              icon: MdGroups },
  { id: 'classes',     label: 'Grades / Classes',      icon: MdSchool },
  { id: 'rankings',    label: 'Rankings',              icon: MdEmojiEvents },
  { id: 'reports',     label: 'Student Reports',       icon: MdDescription },
  { id: 'messages',    label: 'Messages',              icon: MdSupportAgent },
  { id: 'settings',    label: 'Settings',              icon: MdSettings },
];
const classOptions = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`);
const sectionOptions = Array.from({ length: 10 }, (_, i) =>
  String.fromCharCode(65 + i)
);
const gradeOf = (className: string) =>
  (className.match(/^Grade \d+/) || [className])[0];
const sectionOf = (className: string) =>
  className.replace(/^Grade \d+/, '') || 'A';
const migrateBatch = (b: any): Batch => {
  const grade = b.grade || gradeOf(b.className || '');
  const section = b.section || sectionOf(b.className || '');
  return { ...b, grade, section, className: `${grade}${section}` };
};
const gradientRing = [
  'from-brand-500 to-blueSecondary',
  'from-purple-500 to-pink-500',
  'from-blue-500 to-cyan-500',
  'from-orange-400 to-pink-500',
  'from-horizonGreen-500 to-horizonTeal-500',
];

export default function Home() {
  const router = useRouter();
  const [page, setPage] = useState<Page>('dashboard');
  const [menu, setMenu] = useState(false);
  const [school, setSchool] = useState<School>({ name: '', teacher: '', principal: '', logo: '', footer: '' });
  const [batches, setBatches] = useState<Batch[]>([]);
  const [year, setYear] = useState('2025 / 2026');
  const [grade, setGrade] = useState('Grade 8');
  const [section, setSection] = useState('A');
  const [semester, setSemester] = useState('Semester 1');
  const classLabel = `${grade}${section}`;
  const [draft, setDraft] = useState<ScoreRow[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState<string>();
  const [extracting, setExtracting] = useState(false);
  const [selected, setSelected] = useState<Result>();
  const [query, setQuery] = useState('');
  const [dark, setDark] = useState(false);
  const [signOut, setSignOut] = useState(false);
  const [extractNote, setExtractNote] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [contactName, setContactName] = useState('');
  const [periodSystem, setPeriodSystem] = useState<PeriodSystem>('semester');
  const [schoolCode, setSchoolCode] = useState('');

  // ── Unread message count (for bell badge + Messages nav badge) ───────────
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  // Load once on mount; re-fetches whenever the teacher opens the Messages page
  const loadUnreadMsgCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=1&unread=true');
      if (res.ok) {
        const d = await res.json();
        setUnreadMsgCount(d.unread_count ?? 0);
      }
    } catch { /* non-fatal */ }
  }, []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Roster warnings returned by POST /api/batches when some result-sheet IDs
  // are not in the class roster.  Shown as an amber notice after a successful
  // save — does not block the save.
  const [rosterWarnings, setRosterWarnings] = useState<string[]>([]);
  // When the API returns 409 conflict, we store the existing batch info here
  // so the replace-or-cancel dialog can show it.
  const [replaceDialog, setReplaceDialog] = useState<{
    existing: { academic_year: string; grade: string; section: string; semester: string; uploaded_file_name: string; created_at: string };
    pendingPayload: object;
  } | null>(null);
  const [batchesLoading, setBatchesLoading] = useState(false);

  // ── Roster state — the canonical student list for the selected class ──────
  // Loaded from /api/roster whenever grade/section/year changes.
  // Used to show student count and names even when no result batch exists yet.
  const [rosterStudents, setRosterStudents] = useState<Array<{
    id: string;
    student_code: string;
    full_name: string;
    roll_number: string;
    sex: string;
    portal_status: string;
  }>>([]);

  // ── Load batches from DB ─────────────────────────────────────────────────
  const loadBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const res = await fetch('/api/batches');
      if (res.status === 401) {
        // Session expired — middleware will redirect on next navigation.
        // Also push explicitly so the teacher sees the sign-in page immediately
        // rather than staring at stale data.
        router.push('/auth/sign-in?next=/');
        return;
      }
      if (!res.ok) throw new Error('Failed to load results');
      const data = await res.json();
      setBatches((data.batches || []).map(migrateBatch));
    } catch (e) {
      // Non-fatal — app still works with empty batches
      console.error('[loadBatches]', e);
    } finally {
      setBatchesLoading(false);
    }
  }, []);

  // ── Load roster for the selected class ────────────────────────────────────
  // Runs whenever year, grade, or section changes so the Dashboard and Students
  // page always reflect the real class list even before any results are uploaded.
  // Also called imperatively via onSaved from the Roster component after a save,
  // so the Dashboard count and Students list refresh without a selector change.
  const loadRoster = useCallback(() => {
    if (!year || !grade || !section) return;
    fetch(
      `/api/roster?year=${encodeURIComponent(year)}&grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}`
    )
      .then((r) => (r.ok ? r.json() : { students: [] }))
      .then((d) => setRosterStudents(d.students ?? []))
      .catch(() => setRosterStudents([]));
  }, [year, grade, section]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  // ── Load school profile + contact_name from DB; load batches ────────────
  useEffect(() => {
    loadBatches();
    loadUnreadMsgCount();
    // Check if the current user is admin (silent — 403 means not admin)
    fetch('/api/admin/schools').then(r => { if (r.ok) setIsAdmin(true); }).catch(() => {});
    // Load school profile and contact_name from DB
    (async () => {
      // /api/settings/profile now returns contact_name — no separate
      // Supabase browser call needed. Removed the old getUser() + schools
      // query that was duplicating work already done by this API route.
      try {
        const profileRes = await fetch('/api/settings/profile');
        if (profileRes.ok) {
          const p = await profileRes.json();
          setSchool({
            name:      p.name      ?? '',
            teacher:   p.teacher   ?? '',
            principal: p.principal ?? '',
            logo:      p.logo      ?? '',
            footer:    p.footer    ?? '',
          });
          if (p.contact_name) setContactName(p.contact_name);
          const ps: PeriodSystem = p.period_system === 'quarter' ? 'quarter' : 'semester';
          setPeriodSystem(ps);
          setSemester(ps === 'quarter' ? 'Quarter 1' : 'Semester 1');
          if (p.school_code) setSchoolCode(p.school_code);
        }
      } catch { /* non-fatal — app works with empty profile */ }
    })();
  }, [loadBatches, loadUnreadMsgCount]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // When the period system changes, reset the selected period to the first option
  // of the new system so we never show e.g. "Semester 1" in a quarter-mode school.
  useEffect(() => {
    setSemester(periodSystem === 'quarter' ? 'Quarter 1' : 'Semester 1');
  }, [periodSystem]);

  const issues = useMemo(() => validateRows(draft, subjects), [draft, subjects]);

  // ── Derived selector options from actual DB data ─────────────────────────
  // Years that have at least one batch for this school
  const availableYears = useMemo(() => {
    const fromDB = [...new Set(batches.map((b) => b.year))].sort().reverse();
    // Always include current and next year so the user can upload new data
    const defaults = ['2025 / 2026', '2026 / 2027'];
    const merged = [...new Set([...fromDB, ...defaults])].sort().reverse();
    return merged;
  }, [batches]);

  // Sections that have results for the current year+grade
  const sectionsWithData = useMemo(
    () =>
      [...new Set(
        batches
          .filter((b) => b.year === year && gradeOf(b.className) === grade)
          .map((b) => sectionOf(b.className))
      )].sort(),
    [batches, year, grade]
  );

  // Whether all periods exist for a Full Year view (2 for semester, 4 for quarter)
  const hasFullYear = useMemo(() => {
    const hasPeriod = (p: string) =>
      batches.some((b) => b.year === year && b.className === classLabel && b.semester === p);
    if (periodSystem === 'quarter') {
      return QUARTER_PERIODS.every(hasPeriod);
    }
    return hasPeriod('Semester 1') && hasPeriod('Semester 2');
  }, [batches, year, classLabel, periodSystem]);

  const semesterOptions = useMemo(
    () => [...basePeriods(periodSystem), ...(hasFullYear ? ['Full Year'] : [])],
    [hasFullYear, periodSystem]
  );

  const active = useMemo(() => {
    if (semester === 'Full Year') {
      if (periodSystem === 'quarter') {
        const quarters = QUARTER_PERIODS.map((q) =>
          batches.find((b) => b.year === year && b.className === classLabel && b.semester === q)
        );
        return buildAnnualFromBatches(quarters) ?? null;
      }
      // Semester system
      const s1 = batches.find(
        (b) => b.year === year && b.className === classLabel && b.semester === 'Semester 1'
      );
      const s2 = batches.find(
        (b) => b.year === year && b.className === classLabel && b.semester === 'Semester 2'
      );
      return buildAnnual(s1, s2) ?? null;
    }
    return batches.find(
      (b) => b.year === year && b.className === classLabel && b.semester === semester
    ) ?? null;
  }, [batches, year, classLabel, semester, periodSystem]);

  const rows = active?.rows ?? [];
  const activeSubjects = active?.subjects ?? subjects;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
      )
    : rows;

  // When semester/grade/section changes, re-anchor selected to the matching
  // student in the new rows list (by ID). Without this, object-reference
  // mismatch causes Reports to silently fall back to rows[0].
  const reanchoredSelected = useMemo(() => {
    if (!selected) return undefined;
    return rows.find((r) => r.id === selected.id) ?? rows[0];
  }, [rows, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeGrade = (g: string) => {
    setGrade(g);
    const secs = [
      ...new Set(
        batches
          .filter((b) => b.year === year && gradeOf(b.className) === g)
          .map((b) => sectionOf(b.className))
      ),
    ].sort();
    setSection(secs[0] || 'A');
  };

  // ── Process results → save to DB ────────────────────────────────────────
  const handleProcess = async (force = false) => {
    if (issues.length) return;
    setSaving(true);
    setSaveError('');
    setRosterWarnings([]);

    const payload = {
      year,
      grade,
      section,
      semester,
      fileName,
      subjects,
      rows: draft,
      force,
    };

    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        // Duplicate — show replace-or-cancel dialog
        const data = await res.json();
        setReplaceDialog({ existing: data.existing, pendingPayload: payload });
        setSaving(false);
        return;
      }

      if (res.status === 401) {
        // Session expired — redirect to sign-in, return to this page after
        router.push('/auth/sign-in?next=/');
        setSaving(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save results');
      }

      const data = await res.json();
      const saved = migrateBatch(data.batch);
      // Merge the saved batch into local state (replace same slot if exists)
      setBatches((old) => [
        saved,
        ...old.filter(
          (b) =>
            !(
              b.year === saved.year &&
              b.className === saved.className &&
              b.semester === saved.semester
            )
        ),
      ]);
      setReplaceDialog(null);
      // Surface roster warnings (partial roster mismatches) without blocking
      if (data.roster_warnings?.length) {
        setRosterWarnings(data.roster_warnings);
        // Stay on the upload page so the teacher sees the warnings immediately
      } else {
        setPage('rankings');
      }
    } catch (err: any) {
      setSaveError(err.message || 'Could not save results. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmReplace = () => {
    setReplaceDialog(null);
    handleProcess(true);
  };
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setExtracting(true);
    setSource(
      file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    );
    try {
      const result = await extractFromFile(file);
      const defaults = [
        'Mathematics',
        'English',
        'Biology',
        'History',
        'Geography',
      ];
      const subjectsOut = result.subjects.length
        ? result.subjects
        : result.rows.length
        ? []
        : defaults;
      const rowsOut = result.rows.length
        ? result.rows
        : [
            {
              id: '',
              name: '',
              scores: Object.fromEntries(
                (result.subjects.length ? result.subjects : defaults).map(
                  (s) => [s, '']
                )
              ),
            },
          ];
      setSubjects(subjectsOut);
      setDraft(rowsOut);
      setExtractNote(
        result.note ||
          (result.rows.some((r) => r.uncertain?.length)
            ? 'A few values could not be read with certainty — check the highlighted cells.'
            : '')
      );
    } catch (error: any) {
      const msg: string = error?.message || 'Unable to extract this file.';
      // Session expired — redirect immediately rather than showing a confusing error
      if (/must be signed in|sign in and try again|401|unauthorized/i.test(msg)) {
        router.push('/auth/sign-in?next=/');
        return;
      }
      // Quota / rate-limit errors and "no key" errors → show inline in the amber
      // note banner so the table isn't left in a broken state.
      if (/daily.*limit|quota|try again after midnight|resource.exhausted|429|no gemini api key|add your gemini api key|settings.*gemini/i.test(msg)) {
        setExtractNote(msg);
      } else {
        alert(msg);
      }
    } finally {
      setExtracting(false);
      event.target.value = '';
    }
  };
  const editCell = (row: number, field: string, value: string) =>
    setDraft((old) =>
      old.map((r, i) =>
        i !== row
          ? r
          : field === 'id' || field === 'name'
          ? {
              ...r,
              [field]: value,
              uncertain: r.uncertain?.filter((x) => x !== field),
            }
          : {
              ...r,
              scores: { ...r.scores, [field]: value },
              uncertain: r.uncertain?.filter((x) => x !== field),
            }
      )
    );
  const addSubject = () => {
    const subject = `Subject ${subjects.length + 1}`;
    setSubjects([...subjects, subject]);
    setDraft((old) =>
      old.map((r) => ({ ...r, scores: { ...r.scores, [subject]: '' } }))
    );
  };
  const pageLabel = nav.find((x) => x.id === page)?.label || '';

  return (
    <main className="min-h-screen bg-lightPrimary font-dm text-navy-900 dark:bg-navy-900 dark:text-white">
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-navy-900/50 backdrop-blur-sm transition-opacity lg:hidden ${
          menu ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setMenu(false)}
      />
      {/* Sidebar */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-[290px] flex-col border-r border-gray-100 bg-white transition-transform dark:border-navy-700 dark:bg-navy-800 lg:translate-x-0 ${
          menu ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 px-7 pb-7 pt-8">
          <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-gradient-to-br from-brand-500 to-blueSecondary text-lg font-black text-white shadow-[0_8px_20px_rgba(67,24,255,0.35)]">
            G
          </div>
          <div>
            <p className="text-xl font-bold leading-tight text-navy-900 dark:text-white">
              GradeWise
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              School management
            </p>
          </div>
          <button
            className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-xl text-gray-600 hover:bg-lightPrimary lg:hidden dark:text-gray-400 dark:hover:bg-navy-700"
            onClick={() => setMenu(false)}
            aria-label="Close menu"
          >
            <MdClose />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setPage(item.id);
                  setMenu(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-bold transition ${
                  active
                    ? 'bg-lightPrimary text-navy-900 dark:bg-navy-700/60 dark:text-white'
                    : 'text-gray-600 hover:bg-lightPrimary hover:text-brand-500 dark:text-gray-400 dark:hover:bg-navy-700/60 dark:hover:text-white'
                }`}
              >
                <span
                  className={`text-xl ${active ? 'text-brand-500' : 'text-gray-400 dark:text-gray-500'}`}
                >
                  <Icon />
                </span>
                <span className="flex-1">{item.label}</span>
                {item.id === 'messages' && unreadMsgCount > 0 && (
                  <span className={`ml-auto grid min-w-[20px] place-items-center rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${active ? 'bg-brand-500 text-white' : 'bg-brand-500 text-white'}`}>
                    {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                  </span>
                )}
                {active && unreadMsgCount === 0 && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-brand-500" />
                )}
              </button>
            );
          })}
        
        </nav>
        <div className="px-4 pb-7 pt-4">
          <p className="mb-3 px-2 text-center text-xs leading-relaxed text-gray-400 dark:text-gray-500">
            Results are saved securely to your school's account.
          </p>
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 p-3 dark:border-navy-600">
            <Avatar name={contactName || school.teacher} className="h-11 w-11 text-base" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-navy-900 dark:text-white">
                {contactName || school.teacher || 'Teacher'}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Class teacher
              </p>
            </div>
            <button
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                router.push('/auth/sign-in');
                router.refresh();
              }}
              title="Sign out"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg text-gray-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-900/20"
            >
              <MdLogout />
            </button>
          </div>
        </div>
      </aside>

      <div className="no-print lg:pl-[290px]">
        {/* Header */}
        <header className="sticky top-0 z-30 flex min-h-[92px] items-center justify-between gap-3 border-b border-gray-100 bg-white/90 px-4 py-4 backdrop-blur-xl sm:px-6 dark:border-navy-700 dark:bg-navy-900/90">
          <div className="flex items-center gap-3 sm:gap-4">
            <button
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gray-200 text-xl text-navy-900 lg:hidden dark:border-navy-700 dark:text-white"
              onClick={() => setMenu(true)}
              aria-label="Open menu"
            >
              <MdMenu />
            </button>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {school.name}{' '}
                <span className="mx-1 text-gray-300 dark:text-gray-600">/</span>{' '}
                <span className="font-bold text-brand-500">{pageLabel}</span>
              </p>
              <h1 className="text-2xl font-bold leading-tight text-navy-900 sm:text-3xl dark:text-white">
                {pageLabel}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-xl bg-lightPrimary px-4 py-2.5 md:flex dark:bg-navy-700">
              <MdSearch className="text-lg text-gray-600 dark:text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search students…"
                className="w-36 bg-transparent text-sm font-medium text-navy-900 outline-none placeholder:text-gray-400 lg:w-48 dark:text-white"
              />
            </div>
            <button
              onClick={() => setPage('upload')}
              className="hidden items-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:opacity-90 sm:inline-flex"
            >
              <MdUpload className="text-base" /> Upload
            </button>
            <button
              onClick={() => setPage('upload')}
              className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-lg text-navy-900 sm:hidden dark:border-navy-700 dark:text-white"
              aria-label="Upload results"
            >
              <MdCloudUpload />
            </button>
            <button
              title="Notifications"
              onClick={() => { setPage('messages'); setMenu(false); }}
              className="relative grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-xl text-navy-900 transition hover:bg-lightPrimary dark:border-navy-700 dark:text-white dark:hover:bg-navy-800"
            >
              <MdNotificationsNone />
              {unreadMsgCount > 0 ? (
                <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-brand-500 px-1 py-px text-[9px] font-bold leading-none text-white ring-2 ring-white dark:ring-navy-900">
                  {unreadMsgCount > 99 ? '99+' : unreadMsgCount}
                </span>
              ) : (
                <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-horizonRed-500 ring-2 ring-white dark:ring-navy-900" />
              )}
            </button>
            <button
              title="Help & information"
              className="hidden h-10 w-10 place-items-center rounded-xl border border-gray-200 text-xl text-navy-900 transition hover:bg-lightPrimary sm:grid dark:border-navy-700 dark:text-white dark:hover:bg-navy-800"
              onClick={() =>
                alert(
                  'GradeWise works fully offline in this browser. Upload a result sheet (CSV, XLSX, PDF, DOCX, or photo) — extraction, validation and ranking all happen on your device.'
                )
              }
            >
              <MdHelpOutline />
            </button>
            <button
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setDark(!dark)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 text-xl text-navy-900 transition hover:bg-lightPrimary dark:border-navy-700 dark:text-white dark:hover:bg-navy-800"
            >
              {dark ? <MdLightMode /> : <MdDarkMode />}
            </button>
            <div className="hidden items-center gap-3 pl-1 xl:flex">
              <Avatar name={contactName || school.teacher} className="h-10 w-10 text-sm" />
              <div className="leading-tight">
                <p className="text-sm font-bold text-navy-900 dark:text-white">
                  {contactName || school.teacher || 'Teacher'}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Class teacher
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
          {/* ── Initial-load skeleton ─────────────────────────────────────
               Shown only on the very first load, while batches + profile are
               being fetched. Replaced by real content once data arrives.
               batchesLoading starts false and is set true immediately inside
               loadBatches, so `batchesLoading && batches.length === 0` is a
               reliable "first paint" gate. ──────────────────────────────── */}
          {batchesLoading && batches.length === 0 && (
            <div
              className="space-y-6"
              aria-busy="true"
              aria-label="Loading dashboard…"
            >
              {/* Selector bar skeleton */}
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-10 w-32 animate-pulse rounded-xl bg-gray-200 dark:bg-navy-700"
                  />
                ))}
              </div>
              {/* Stat cards skeleton */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-navy-700 dark:bg-navy-800"
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-navy-700" />
                        <div className="h-7 w-14 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
                      </div>
                      <div className="h-12 w-12 animate-pulse rounded-xl bg-gray-100 dark:bg-navy-700" />
                    </div>
                  </div>
                ))}
              </div>
              {/* Table skeleton */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-navy-700 dark:bg-navy-800">
                <div className="border-b border-gray-100 p-5 dark:border-navy-700">
                  <div className="h-5 w-40 animate-pulse rounded-lg bg-gray-200 dark:bg-navy-700" />
                </div>
                <div className="divide-y divide-gray-100 dark:divide-navy-700">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3">
                      <div className="h-4 w-6 animate-pulse rounded bg-gray-200 dark:bg-navy-700" />
                      <div className="h-4 flex-1 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                      <div className="h-4 w-16 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                      <div className="h-4 w-16 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                      <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-navy-700" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(!batchesLoading || batches.length > 0) && page !== 'settings' && page !== 'roster' && page !== 'assessments' && (
            <Selectors
              year={year}
              setYear={setYear}
              grade={grade}
              setGrade={changeGrade}
              section={section}
              setSection={setSection}
              semester={semester}
              setSemester={setSemester}
              sectionsWithData={sectionsWithData}
              availableYears={availableYears}
              semesterOptions={semesterOptions}
            />
          )}
          {(!batchesLoading || batches.length > 0) && (<>
          {page === 'dashboard' && (
            <Dashboard
              rows={rows}
              subjects={activeSubjects}
              batches={batches}
              className={classLabel}
              semester={semester}
              year={year}
              dark={dark}
              contactName={contactName}
              onUpload={() => setPage('upload')}
              rosterStudents={rosterStudents}
            />
          )}
          {page === 'upload' && (
            <Upload
              subjects={subjects}
              rows={draft}
              issues={issues}
              fileName={fileName}
              source={source}
              extracting={extracting}
              note={extractNote}
              onFile={readFile}
              onCell={editCell}
              addSubject={addSubject}
              renameSubject={(old: string, value: string) => {
                setSubjects(subjects.map((s) => (s === old ? value : s)));
                setDraft(
                  draft.map((r) => ({
                    ...r,
                    scores: {
                      ...Object.fromEntries(
                        Object.entries(r.scores).map(([k, v]) => [
                          k === old ? value : k,
                          v,
                        ])
                      ),
                    },
                  }))
                );
              }}
              addRow={() =>
                setDraft([
                  ...draft,
                  {
                    id: '',
                    name: '',
                    scores: Object.fromEntries(subjects.map((s) => [s, ''])),
                  },
                ])
              }
              removeRow={(i: number) =>
                setDraft(draft.filter((_, x) => x !== i))
              }
              onProcess={() => handleProcess(false)}
              saving={saving}
              saveError={saveError}
              rosterWarnings={rosterWarnings}
              onGoToRoster={() => setPage('roster')}
            />
          )}
          {page === 'roster' && (
            <RosterComponent
              year={year}
              grade={grade}
              section={section}
              onSaved={loadRoster}
            />
          )}
          {page === 'assessments' && (
            <AssessmentsComponent
              year={year}
              grade={grade}
              section={section}
              school={school}
              periodSystem={periodSystem}
            />
          )}
          {page === 'students' && (
            <Students
              rows={filtered}
              total={rows.length}
              className={classLabel}
              query={q}
              grade={grade}
              section={section}
              year={year}
              rosterStudents={rosterStudents}
              onReport={(r: Result) => {
                setSelected(r);
                setPage('reports');
              }}
            />
          )}
          {page === 'classes' && (
            <Classes
              batches={batches}
              grade={grade}
              section={section}
              onLoad={(g: string, s: string) => {
                setGrade(g);
                setSection(s);
                setPage('rankings');
              }}
              onUpload={() => setPage('upload')}
            />
          )}
          {page === 'rankings' && (
            <Rankings
              rows={filtered}
              batches={batches}
              setBatches={setBatches}
              grade={grade}
              section={section}
              semester={semester}
              year={year}
              query={q}
              school={school}
              active={active}
              periodSystem={periodSystem}
              onReport={(r: Result) => {
                setSelected(r);
                setPage('reports');
              }}
            />
          )}
          {page === 'reports' && (
            <Reports
              rows={filtered}
              subjects={activeSubjects}
              selected={reanchoredSelected}
              setSelected={setSelected}
              school={school}
              year={active?.year || year}
              grade={active?.grade || grade}
              section={active?.section || section}
              semester={active?.semester || semester}
              active={active}
              batches={batches}
              periodSystem={periodSystem}
            />
          )}
          {page === 'messages' && (
            <TeacherMessages onCountChange={setUnreadMsgCount} />
          )}
          {page === 'settings' && (
            <Settings school={school} setSchool={setSchool} periodSystem={periodSystem} setPeriodSystem={setPeriodSystem} schoolCode={schoolCode} />
          )}
          </>)}
        </section>
      </div>

      {/* Sign out modal — kept for graceful Supabase sign-out confirmation */}
      {signOut && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-navy-900/50 backdrop-blur-sm"
            onClick={() => setSignOut(false)}
          />
          <div className="relative w-full max-w-md rounded-[20px] bg-white p-7 text-center shadow-[0_18px_40px_rgba(17,24,58,0.25)] dark:bg-navy-800">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-500 dark:bg-navy-700">
              <MdLogout />
            </div>
            <h3 className="mt-4 text-xl font-bold text-navy-900 dark:text-white">
              Sign out of GradeWise?
            </h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              GradeWise runs entirely in this browser — there is no account
              session to end. Your data stays saved locally.
            </p>
            <button
              onClick={() => setSignOut(false)}
              className="mt-6 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-6 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:opacity-90"
            >
              Keep using GradeWise
            </button>
          </div>
        </div>
      )}

      {/* Replace-or-cancel dialog — shown when a batch already exists */}
      {replaceDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-navy-900/50 backdrop-blur-sm"
            onClick={() => !saving && setReplaceDialog(null)}
          />
          <div className="relative w-full max-w-md rounded-[20px] bg-white p-7 shadow-[0_18px_40px_rgba(17,24,58,0.25)] dark:bg-navy-800">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-2xl text-amber-500 dark:bg-navy-700">
              <MdWarningAmber />
            </div>
            <h3 className="mt-4 text-center text-xl font-bold text-navy-900 dark:text-white">
              Result already exists
            </h3>
            <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
              A result already exists for{' '}
              <b>
                {replaceDialog.existing.grade}
                {replaceDialog.existing.section} &middot;{' '}
                {replaceDialog.existing.semester} &middot;{' '}
                {replaceDialog.existing.academic_year}
              </b>
              {replaceDialog.existing.uploaded_file_name && (
                <> (from &ldquo;{replaceDialog.existing.uploaded_file_name}&rdquo;)</>
              )}
              {'. '}
              Do you want to replace it with the new data, or cancel?
            </p>
            <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
              Saved on {new Date(replaceDialog.existing.created_at).toLocaleDateString()}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setReplaceDialog(null)}
                disabled={saving}
                className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary disabled:opacity-50 dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
              >
                Cancel
              </button>
              <button
                onClick={confirmReplace}
                disabled={saving}
                className="flex-1 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(239,68,68,0.3)] transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Replacing…' : 'Replace'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------- Shared primitives ---------- */

function Card({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-[20px] border border-gray-200/70 bg-white shadow-[0_18px_40px_rgba(112,144,176,0.12)] dark:border-navy-700 dark:bg-navy-800 ${className}`}
    >
      {children}
    </div>
  );
}

function Avatar({
  name,
  className = 'h-10 w-10 text-sm',
}: {
  name: string;
  className?: string;
}) {
  const initial = name?.trim().charAt(0).toUpperCase() || '?';
  const g = gradientRing[(name?.length || 0) % gradientRing.length];
  return (
    <div
      className={`grid shrink-0 select-none place-items-center rounded-full bg-gradient-to-br ${g} font-bold text-white ${className}`}
    >
      {initial}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1
      ? 'bg-gradient-to-br from-[#FFB547] to-[#FF9B05] text-white shadow-[0_6px_16px_rgba(255,155,5,0.4)]'
      : rank === 2
      ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-white shadow-[0_6px_16px_rgba(150,160,180,0.35)]'
      : rank === 3
      ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-[0_6px_16px_rgba(217,119,6,0.35)]'
      : 'bg-lightPrimary text-navy-900 dark:bg-navy-700 dark:text-white';
  return (
    <div
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${cls}`}
    >
      {rank}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 block w-full cursor-pointer rounded-xl border border-gray-200 bg-lightPrimary px-4 py-3 text-sm font-bold text-navy-900 outline-none transition focus:border-brand-500 dark:border-navy-600 dark:bg-navy-700 dark:text-white"
      >
        {options.map((o: string) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      {hint && (
        <span className="mt-1.5 block text-[11px] font-medium text-gray-400 dark:text-gray-500">
          {hint}
        </span>
      )}
    </label>
  );
}

function Selectors({
  year,
  setYear,
  grade,
  setGrade,
  section,
  setSection,
  semester,
  setSemester,
  sectionsWithData,
  availableYears,
  semesterOptions,
}: any) {
  return (
    <div className="no-print mb-6 grid gap-4 rounded-[20px] border border-gray-200/70 bg-white p-5 shadow-[0_18px_40px_rgba(112,144,176,0.12)] sm:grid-cols-2 xl:grid-cols-4 dark:border-navy-700 dark:bg-navy-800">
      <Select
        label="Academic year"
        value={year}
        onChange={setYear}
        options={availableYears?.length ? availableYears : ['2025 / 2026', '2026 / 2027']}
      />
      <Select
        label="Grade"
        value={grade}
        onChange={setGrade}
        options={classOptions}
      />
      <Select
        label="Section"
        value={section}
        onChange={setSection}
        options={sectionOptions}
        hint={
          sectionsWithData?.length
            ? `Sections with results: ${sectionsWithData.join(', ')}`
            : 'No results saved for this grade yet'
        }
      />
      <Select
        label="Result period"
        value={semester}
        onChange={setSemester}
        options={semesterOptions?.length ? semesterOptions : ['Semester 1', 'Semester 2']}
      />
    </div>
  );
}

/* ---------- Dashboard ---------- */

function Metric({
  label,
  value,
  caption,
  icon,
  iconClass,
}: {
  label: string;
  value: string;
  caption: string;
  icon: any;
  iconClass: string;
}) {
  const Icon = icon;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-600 dark:text-gray-400">
            {label}
          </p>
          <p className="mt-2 truncate text-3xl font-bold text-navy-900 dark:text-white">
            {value}
          </p>
        </div>
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] text-2xl ${iconClass}`}
        >
          <Icon />
        </div>
      </div>
      <p className="mt-3 truncate text-xs font-medium text-gray-400 dark:text-gray-500">
        {caption}
      </p>
    </Card>
  );
}

function ChartCard({
  title,
  subtitle,
  className = '',
  children,
}: {
  title: string;
  subtitle: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={`p-5 sm:p-6 ${className}`}>
      <h3 className="text-lg font-bold text-navy-900 dark:text-white">
        {title}
      </h3>
      <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
        {subtitle}
      </p>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="grid h-[300px] place-items-center rounded-2xl bg-lightPrimary/60 text-sm text-gray-400 dark:bg-navy-700/40 dark:text-gray-500">
      No results yet — upload a result sheet to see charts.
    </div>
  );
}

function Dashboard({
  rows,
  subjects,
  batches,
  className,
  semester,
  year,
  dark,
  contactName,
  onUpload,
  rosterStudents,
}: any) {
  // Use result rows when available; fall back to roster size for the count
  const studentCount = rows.length > 0 ? rows.length : (rosterStudents?.length ?? 0);
  const average = rows.length
    ? rows.reduce((s: number, r: Result) => s + r.percentage, 0) / rows.length
    : 0;
  const top = rows[0];
  const hasData = rows.length > 0;

  const subjectAverages = subjects.map((s: string) => {
    const vals = rows
      .map((r: Result) => Number(r.scores[s]))
      .filter(Number.isFinite);
    return {
      name: s,
      value: vals.length
        ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length
        : 0,
    };
  });
  const batchAvg = (b: Batch | undefined, subs: string[]) =>
    subs.map((s: string) => {
      const vals = (b?.rows || [])
        .map((r: Result) => Number(r.scores[s]))
        .filter(Number.isFinite);
      return +(
        vals.length ? vals.reduce((a: number, x: number) => a + x, 0) / vals.length : 0
      ).toFixed(1);
    });
  const semSeries = (['Semester 1', 'Semester 2'] as const)
    .map((sem) => {
      const b = batches.find(
        (x: Batch) =>
          x.year === year && x.className === className && x.semester === sem
      );
      return b ? { name: sem, data: batchAvg(b, subjects) } : null;
    })
    .filter(Boolean);
  const activeSeries = semSeries.length
    ? semSeries
    : [{ name: semester, data: subjectAverages.map((x: any) => +x.value.toFixed(1)) }];

  return (
    <>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-navy-900 sm:text-3xl dark:text-white">
            {contactName ? `Welcome, ${contactName}.` : 'Welcome back.'}
          </h2>
          <p className="mt-1.5 text-gray-600 dark:text-gray-400">
            Here’s an overview of student achievement.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3.5 py-1.5 text-xs font-bold text-brand-600 dark:bg-navy-700 dark:text-brand-300">
            {className} · {semester} · {year}
          </p>
        </div>
        <button
          onClick={onUpload}
          className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-5 py-3 text-sm font-bold text-white shadow-[0_10px_27px_rgba(67,24,255,0.35)] transition hover:opacity-90 sm:self-auto"
        >
          <MdUpload className="text-base" /> Upload result sheet
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Total Students"
          value={`${studentCount}`}
          caption={rows.length > 0 ? `Enrolled in ${className}` : `In roster for ${className}`}
          icon={MdPeopleAlt}
          iconClass="bg-purple-50 text-purple-600 dark:bg-navy-700 dark:text-purple-300"
        />
        <Metric
          label="School Average"
          value={`${average.toFixed(1)}%`}
          caption={`Across ${subjects.length} subjects`}
          icon={MdTrendingUp}
          iconClass="bg-brand-50 text-brand-500 dark:bg-navy-700 dark:text-brand-300"
        />
        <Metric
          label="Top Score"
          value={top ? `${top.percentage.toFixed(0)}%` : '—'}
          caption={top ? `Held by ${top.name}` : 'No results yet'}
          icon={MdWorkspacePremium}
          iconClass="bg-pink-50 text-pink-600 dark:bg-navy-700 dark:text-pink-300"
        />
        <Metric
          label="Result Batches"
          value={`${batches.length}`}
          caption={`${batches.filter((b: Batch) => b.publishStatus === 'published').length} published · ${batches.filter((b: Batch) => b.publishStatus === 'processed' || b.publishStatus === 'reviewed').length} awaiting publish`}
          icon={MdLayers}
          iconClass="bg-horizonGreen-50 text-horizonGreen-600 dark:bg-navy-700 dark:text-horizonGreen-300"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <ChartCard
          title="Student performance overview"
          subtitle="Average percentage per student"
          className="lg:col-span-2"
        >
          {hasData ? (
            <Charts
              type="bar"
              distributed
              series={[
                {
                  name: 'Percentage',
                  data: rows.map((r: Result) => +r.percentage.toFixed(1)),
                },
              ]}
              categories={rows.map((r: Result) => r.name)}
              dark={dark}
              height={290}
            />
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
        <ChartCard
          title="Semester performance"
          subtitle="Class average by subject"
        >
          {hasData ? (
            <Charts
              type="area"
              series={activeSeries}
              categories={subjects}
              dark={dark}
              height={290}
            />
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <ChartCard
          title="Class performance"
          subtitle={`${className} · average score per subject`}
          className="lg:col-span-3"
        >
          {hasData ? (
            <Charts
              type="bar"
              distributed
              series={[
                {
                  name: 'Class average',
                  data: subjectAverages.map((x: any) => +x.value.toFixed(1)),
                },
              ]}
              categories={subjectAverages.map((x: any) => x.name)}
              dark={dark}
              height={290}
            />
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
        <Card className="p-5 sm:p-6 lg:col-span-2">
          <h3 className="text-lg font-bold text-navy-900 dark:text-white">
            Top students
          </h3>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
            Best performing in this class
          </p>
          <div className="mt-5 divide-y divide-gray-100 dark:divide-navy-700">
            {hasData ? (
              rows.slice(0, 5).map((r: Result) => (
                <div key={r.id} className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
                  <RankBadge rank={r.rank} />
                  <Avatar name={r.name} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-bold text-navy-900 dark:text-white">
                        {r.name}
                      </p>
                      <p className="text-sm font-bold text-navy-900 dark:text-white">
                        {r.percentage.toFixed(1)}%
                      </p>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Average {r.average.toFixed(1)} · {r.status} · <span className="font-bold text-navy-900 dark:text-white">{r.letterGrade}</span>
                    </p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-500 to-blueSecondary"
                        style={{ width: `${r.percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-gray-400">
                No results yet — upload a result sheet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ---------- Upload ---------- */

const uploadSteps = [
  { id: 'upload', label: 'Upload', icon: MdCloudUpload },
  { id: 'preview', label: 'Preview', icon: MdTableChart },
  { id: 'validate', label: 'Validate', icon: MdCheckCircle },
  { id: 'process', label: 'Process', icon: MdEmojiEvents },
];
const formatTiles = [
  { label: 'Image / Photo', ext: '.JPG · .PNG', icon: MdImage },
  { label: 'PDF', ext: '.PDF', icon: MdPictureAsPdf },
  { label: 'DOC / DOCX', ext: '.DOC · .DOCX', icon: MdDescription },
  { label: 'Excel / CSV', ext: '.XLSX · .XLS · .CSV', icon: MdGridOn },
];

function Upload({
  subjects,
  rows,
  issues,
  fileName,
  source,
  extracting,
  note,
  onFile,
  onCell,
  addSubject,
  renameSubject,
  addRow,
  removeRow,
  onProcess,
  saving,
  saveError,
  rosterWarnings,
  onGoToRoster,
}: any) {
  const activeStep = fileName ? (issues.length ? 2 : 3) : 0;
  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <Card className="px-6 py-5">
        <div className="flex items-center">
          {uploadSteps.map((s, i) => {
            const Icon = s.icon;
            const done = i < activeStep;
            const active = i === activeStep;
            return (
              <Fragment key={s.id}>
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={`grid h-11 w-11 place-items-center rounded-full text-lg transition ${
                      done
                        ? 'bg-gradient-to-br from-brand-500 to-blueSecondary text-white shadow-[0_6px_16px_rgba(67,24,255,0.35)]'
                        : active
                        ? 'border-2 border-brand-500 bg-white text-brand-500 ring-4 ring-brand-500/15 dark:bg-navy-700'
                        : 'bg-lightPrimary text-gray-400 dark:bg-navy-700 dark:text-gray-500'
                    }`}
                  >
                    <Icon />
                  </div>
                  <span
                    className={`text-[11px] font-bold ${
                      done || active
                        ? 'text-brand-500'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < uploadSteps.length - 1 && (
                  <div
                    className={`mx-2 mb-5 h-1 flex-1 rounded-full sm:mx-4 ${
                      i < activeStep
                        ? 'bg-gradient-to-r from-brand-500 to-blueSecondary'
                        : 'bg-gray-200 dark:bg-navy-700'
                    }`}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </Card>

      {/* Upload & extract */}
      <Card className="p-6 sm:p-8">
        <h2 className="text-2xl font-bold text-navy-900 dark:text-white">
          Bring in a result sheet
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
          Upload a structured spreadsheet, document, or photo. Subjects and
          scores are extracted automatically — amber cells only appear when a
          value genuinely could not be read.
        </p>
        <label className="mt-6 flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed border-brand-300 bg-brand-50/40 px-6 py-10 text-center transition hover:border-brand-500 hover:bg-brand-50 dark:border-navy-600 dark:bg-navy-700/30 dark:hover:border-brand-400">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-3xl text-brand-500 shadow-[0_10px_27px_rgba(67,24,255,0.2)] dark:bg-navy-800">
            <MdCloudUpload />
          </span>
          <b className="mt-4 text-lg text-navy-900 dark:text-white">
            {extracting ? 'Reading your file…' : 'Choose a result sheet'}
          </b>
          <span className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Drop a file here or click to browse
          </span>
          <span className="mt-6 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
            {formatTiles.map((t) => {
              const Icon = t.icon;
              return (
                <span
                  key={t.label}
                  className="rounded-2xl border border-gray-200 bg-white px-3 py-4 dark:border-navy-600 dark:bg-navy-800"
                >
                  <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-xl text-brand-500 dark:bg-navy-700 dark:text-brand-300">
                    <Icon />
                  </span>
                  <span className="mt-2 block text-xs font-bold text-navy-900 dark:text-white">
                    {t.label}
                  </span>
                  <span className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">
                    {t.ext}
                  </span>
                </span>
              );
            })}
          </span>
          <input
            disabled={extracting}
            onChange={onFile}
            className="hidden"
            type="file"
            accept=".csv,.xlsx,.xls,.docx,.doc,.pdf,image/jpeg,image/png"
          />
        </label>
        {fileName && (
          <p className="mt-4 text-sm font-bold text-navy-900 dark:text-white">
            Current source:{' '}
            <span className="font-medium text-gray-600 dark:text-gray-400">
              {fileName}
            </span>
          </p>
        )}
        {note && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <MdWarningAmber className="mt-0.5 shrink-0 text-sm" />
            <span>{note}</span>
          </div>
        )}
        {source && (
          <img
            className="mt-4 max-h-64 rounded-2xl border border-gray-200 object-contain dark:border-navy-700"
            src={source}
            alt="Uploaded result sheet preview"
          />
        )}
      </Card>

      {/* Review & correct */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-bold text-brand-500">REVIEW & CORRECT</p>
            <h2 className="mt-1 text-xl font-bold text-navy-900 dark:text-white">
              Extracted results
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addSubject}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
            >
              <MdAdd /> Subject
            </button>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
            >
              <MdAdd /> Student
            </button>
          </div>
        </div>
        {rows.some((r: ScoreRow) => r.uncertain?.length) && (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            <MdWarningAmber className="text-sm" /> A few cells could not be read
            with certainty — check the highlighted values before processing.
          </p>
        )}
        <div className="mt-5 overflow-x-auto rounded-2xl border border-gray-200 dark:border-navy-700">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-lightPrimary/70 text-left text-xs uppercase tracking-wide text-gray-600 dark:bg-navy-700 dark:text-gray-400">
              <tr>
                <th className="p-3.5 font-bold">Student ID</th>
                <th className="p-3.5 font-bold">Student name</th>
                {subjects.map((s: string) => (
                  <th className="p-2" key={s}>
                    <input
                      className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-navy-900 outline-none focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white"
                      value={s}
                      onChange={(e) => renameSubject(s, e.target.value)}
                    />
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r: ScoreRow, i: number) => (
                <tr
                  key={i}
                  className="border-t border-gray-100 dark:border-navy-700"
                >
                  <td className="p-2">
                    <input
                      className={`w-28 rounded-lg border px-3 py-2 text-navy-900 outline-none transition focus:border-brand-500 dark:text-white ${
                        r.uncertain?.includes('id')
                          ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/30'
                          : 'border-gray-200 bg-lightPrimary dark:border-navy-600 dark:bg-navy-700'
                      }`}
                      value={r.id}
                      onChange={(e) => onCell(i, 'id', e.target.value)}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      className={`w-36 rounded-lg border px-3 py-2 text-navy-900 outline-none transition focus:border-brand-500 dark:text-white ${
                        r.uncertain?.includes('name')
                          ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/30'
                          : 'border-gray-200 bg-lightPrimary dark:border-navy-600 dark:bg-navy-700'
                      }`}
                      value={r.name}
                      onChange={(e) => onCell(i, 'name', e.target.value)}
                    />
                  </td>
                  {subjects.map((s: string) => (
                    <td className="p-2" key={s}>
                      <input
                        inputMode="decimal"
                        className={`w-20 rounded-lg border px-3 py-2 text-navy-900 outline-none transition focus:border-brand-500 dark:text-white ${
                          r.uncertain?.includes(s)
                            ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/30'
                            : 'border-gray-200 bg-lightPrimary dark:border-navy-600 dark:bg-navy-700'
                        }`}
                        value={r.scores[s] ?? ''}
                        onChange={(e) => onCell(i, s, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="p-2 text-right">
                    <button
                      onClick={() => removeRow(i)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20"
                    >
                      <MdDeleteOutline className="text-base" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Validation */}
      <div
        className={`rounded-[20px] border p-5 shadow-[0_18px_40px_rgba(112,144,176,0.12)] ${
          issues.length
            ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
            : 'border-horizonGreen-200 bg-horizonGreen-50 dark:border-horizonGreen-700 dark:bg-horizonGreen-900/20'
        }`}
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl ${
                issues.length
                  ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40'
                  : 'bg-horizonGreen-100 text-horizonGreen-600 dark:bg-horizonGreen-900/40'
              }`}
            >
              {issues.length ? <MdErrorOutline /> : <MdCheckCircle />}
            </span>
            <div>
              <p className="font-bold text-navy-900 dark:text-white">
                {issues.length
                  ? `${issues.length} item${issues.length === 1 ? '' : 's'} need attention`
                  : 'Results are ready to process'}
              </p>
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {issues.length
                  ? 'Correct the highlighted data before calculations and ranks are saved.'
                  : 'All student names, IDs, subjects, and scores are valid.'}
              </p>
            </div>
          </div>
          <button
            disabled={!!issues.length || saving}
            onClick={onProcess}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-5 py-3 text-sm font-black text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-none disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none dark:disabled:bg-navy-700 dark:disabled:text-gray-500"
          >
            {saving ? 'Saving…' : <>Process results <MdChevronRight className="text-lg" /></>}
          </button>
        </div>
        {issues.length > 0 && (
          <ul className="mt-4 grid gap-2 text-sm">
            {issues.slice(0, 8).map((issue: any, i: number) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-xl bg-white p-3 text-navy-900 dark:bg-navy-800 dark:text-white"
              >
                <MdErrorOutline className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                  {issue.row ? `Row ${issue.row} · ` : ''}
                  <b>{issue.field}:</b> {issue.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        {saveError && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-900/20 dark:text-red-300">
            <MdErrorOutline className="mt-0.5 shrink-0" />
            <span>{saveError}</span>
          </div>
        )}
        {/* Roster warnings — partial mismatches after a successful save */}
        {rosterWarnings?.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-700/40 dark:bg-amber-900/20">
            <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
              <MdWarningAmber className="shrink-0" />
              Results saved — but {rosterWarnings.length} student ID{rosterWarnings.length !== 1 ? 's' : ''} {rosterWarnings.length !== 1 ? 'are' : 'is'} not in the class roster:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-400">
              {rosterWarnings.map((w: string, i: number) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            {onGoToRoster && (
              <button
                onClick={onGoToRoster}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 transition hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
              >
                Go to Class Roster →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Students ---------- */

function Students({ rows, total, className, query, grade, section, year, rosterStudents, onReport }: any) {
  // 1. School-wide pending portal requests — independent of all selectors
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading]   = useState(false);
  const [actionBusy, setActionBusy]           = useState<string | null>(null);

  // 2. Per-class portal status map for badges on result-student cards
  const [portalMap, setPortalMap] = useState<Record<string, { id: string; status: string; parent_name?: string; parent_phone?: string }>>({});

  const loadPending = () => {
    setPendingLoading(true);
    fetch(`/api/students?portal_status=pending`)
      .then(r => r.ok ? r.json() : { students: [] })
      .then(d => setPendingRequests(d.students ?? []))
      .catch(() => {})
      .finally(() => setPendingLoading(false));
  };

  const loadPortalMap = () => {
    if (!grade || !section || !year) return;
    fetch(`/api/students?grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}&academic_year=${encodeURIComponent(year)}`)
      .then(r => r.ok ? r.json() : { students: [] })
      .then(d => {
        const map: Record<string, { id: string; status: string; parent_name?: string; parent_phone?: string }> = {};
        for (const s of d.students ?? []) map[s.student_code] = { id: s.id, status: s.portal_status, parent_name: s.parent_name ?? undefined, parent_phone: s.parent_phone ?? undefined };
        setPortalMap(map);
      })
      .catch(() => {});
  };

  useEffect(() => { loadPending(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadPortalMap(); }, [grade, section, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = async (studentId: string, studentCode: string, newStatus: string) => {
    setActionBusy(studentId);
    try {
      const res = await fetch(`/api/students/${studentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal_status: newStatus }),
      });
      if (res.ok) {
        setPendingRequests(prev => prev.filter(s => s.id !== studentId));
        if (portalMap[studentCode]) {
          setPortalMap(prev => ({ ...prev, [studentCode]: { ...prev[studentCode], status: newStatus } }));
        }
      }
    } catch { /* non-fatal */ }
    finally { setActionBusy(null); }
  };

  const portalBadge = (code: string) => {
    const e = portalMap[code];
    if (!e) return null;
    if (e.status === `active`)   return { label: `Portal: Active`,   cls: `bg-horizonGreen-50 text-horizonGreen-700 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300` };
    if (e.status === `pending`)  return { label: `Portal: Pending`,  cls: `bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300` };
    if (e.status === `rejected`) return { label: `Portal: Rejected`, cls: `bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300` };
    return null;
  };

  return (
    <div className="space-y-6">
      {(pendingLoading || pendingRequests.length > 0) && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-700/40 dark:bg-amber-900/20">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-lg text-amber-600 dark:bg-amber-900/40">
              <MdHourglassTop />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-amber-800 dark:text-amber-300">
                {pendingLoading ? `Loading...` : `${pendingRequests.length} student${pendingRequests.length !== 1 ? `s` : ``} awaiting portal approval`}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                These students registered for the student portal and need your approval.
              </p>
            </div>
          </div>
          {!pendingLoading && (
            <div className="divide-y divide-gray-100 dark:divide-navy-700">
              {pendingRequests.map((s: any) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Avatar name={s.full_name || s.student_code} className="h-10 w-10 shrink-0 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-navy-900 dark:text-white">{s.full_name || `(no name)`}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      ID: {s.student_code}
                      {s.grade ? ` · ${s.grade}${s.section}` : ` · (grade not yet assigned)`}
                      {s.email ? ` · ${s.email}` : ``}
                    </p>
                    {(s.parent_name || s.parent_phone) && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-semibold text-gray-600 dark:text-gray-300">Parent: </span>
                        {[s.parent_name, s.parent_phone].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      disabled={actionBusy === s.id}
                      onClick={() => handleStatusChange(s.id, s.student_code, `active`)}
                      className="rounded-xl bg-horizonGreen-500 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-horizonGreen-600 disabled:opacity-50"
                    >
                      {actionBusy === s.id ? `...` : `Approve`}
                    </button>
                    <button
                      disabled={actionBusy === s.id}
                      onClick={() => handleStatusChange(s.id, s.student_code, `rejected`)}
                      className="rounded-xl border border-red-200 px-4 py-2.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-700/40 dark:hover:bg-red-900/20"
                    >
                      {actionBusy === s.id ? `...` : `Reject`}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-brand-500">STUDENT DIRECTORY</p>
            <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">Students</h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {(() => {
              const displayCount = rows.length > 0 ? rows.length : (rosterStudents?.length ?? 0);
              const label = rows.length > 0 ? 'students in' : 'students in roster for';
              return query
                ? `Showing ${rows.length} of ${displayCount} ${label} ${className}`
                : `${displayCount} ${label} ${className}`;
            })()}
          </p>
        </div>
        {rows.length ? (
          /* ── Result cards (batch data exists) ─────────────────────────── */
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r: Result) => {
              const badge = portalBadge(r.id);
              const parentEntry = portalMap[r.id];
              return (
                <Card key={r.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={r.name} className="h-12 w-12 text-base" />
                      <div className="min-w-0">
                        <p className="truncate font-bold text-navy-900 dark:text-white">{r.name}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{r.id} · {className}</p>
                        {(parentEntry?.parent_name || parentEntry?.parent_phone) ? (
                          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-semibold">Parent: </span>
                            {[parentEntry.parent_name, parentEntry.parent_phone].filter(Boolean).join(' · ')}
                          </p>
                        ) : parentEntry && (
                          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 italic">Parent: Not provided</p>
                        )}
                      </div>
                    </div>
                    <RankBadge rank={r.rank} />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
                    {[
                      { label: `Total`,      value: `${r.total}/${r.maximum}` },
                      { label: `Average`,    value: r.average.toFixed(1) },
                      { label: `Percentage`, value: `${r.percentage.toFixed(1)}%` },
                      { label: `Grade`,      value: r.letterGrade, chip: true },
                      { label: `Status`,     value: r.status, chip: true },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl bg-lightPrimary px-3 py-2.5 dark:bg-navy-700/60">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{s.label}</p>
                        <p className={`mt-0.5 truncate text-sm font-bold ${ (s as any).chip ? `text-brand-500` : `text-navy-900 dark:text-white` }`}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => onReport(r)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-brand-500 transition hover:bg-brand-50 dark:border-navy-600 dark:hover:bg-navy-700"
                    >
                      View report <MdChevronRight className="text-lg" />
                    </button>
                    {badge && (
                      <span className={`inline-flex items-center rounded-xl px-3 py-2.5 text-xs font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        ) : rosterStudents?.length ? (
          /* ── Roster-only cards (roster uploaded, no results yet) ──────── */
          <>
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-200">
              <MdHourglassTop className="shrink-0 text-base" />
              <span>
                Showing roster — no results uploaded yet for {className}. Upload a result sheet to see scores and rankings.
              </span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {(rosterStudents as any[])
                .filter((s: any) => {
                  if (!query) return true;
                  const q2 = query.toLowerCase();
                  return (
                    (s.full_name   ?? '').toLowerCase().includes(q2) ||
                    (s.student_code ?? '').toLowerCase().includes(q2)
                  );
                })
                .map((s: any) => {
                  const badge = portalBadge(s.student_code);
                  const sexLabel = s.sex === 'M' ? 'Male' : s.sex === 'F' ? 'Female' : s.sex || '—';
                  return (
                    <Card key={s.id} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={s.full_name || s.student_code} className="h-12 w-12 text-base" />
                          <div className="min-w-0">
                            <p className="truncate font-bold text-navy-900 dark:text-white">{s.full_name || '(no name)'}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              {s.student_code}
                              {s.roll_number ? ` · Roll ${s.roll_number}` : ''}
                              {` · ${className}`}
                            </p>
                            {(s.parent_name || s.parent_phone) ? (
                              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                <span className="font-semibold">Parent: </span>
                                {[s.parent_name, s.parent_phone].filter(Boolean).join(' · ')}
                              </p>
                            ) : (
                              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 italic">Parent: Not provided</p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-lightPrimary px-3 py-2.5 dark:bg-navy-700/60">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Sex</p>
                          <p className="mt-0.5 text-sm font-bold text-navy-900 dark:text-white">{sexLabel}</p>
                        </div>
                        <div className="rounded-xl bg-lightPrimary px-3 py-2.5 dark:bg-navy-700/60">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Results</p>
                          <p className="mt-0.5 text-sm font-bold text-amber-500">Not uploaded</p>
                        </div>
                      </div>
                      {badge && (
                        <div className="mt-3">
                          <span className={`inline-flex items-center rounded-xl px-3 py-2 text-xs font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                      )}
                    </Card>
                  );
                })}
            </div>
          </>
        ) : (
          /* ── True empty state (no roster, no results) ─────────────────── */
          <Card className="p-12 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-500 dark:bg-navy-700">
              <MdGroups />
            </div>
            <p className="mt-4 font-bold text-navy-900 dark:text-white">No students found for this class.</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Add students via <strong>Class Roster</strong>, then upload a result sheet to see scores.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------- Classes ---------- */

function Classes({ batches, grade, section, onLoad, onUpload }: any) {
  const avgOf = (list: Result[]) =>
    list.length
      ? list.reduce((s: number, r: Result) => s + r.percentage, 0) /
        list.length
      : 0;
  return (
    <div>
      <div className="mb-5">
        <p className="text-sm font-bold text-brand-500">GRADES & SECTIONS</p>
        <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
          Grades / Classes
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Overview of saved results across all grades and sections.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {classOptions.map((g: string) => {
          const bs = batches.filter((b: Batch) => gradeOf(b.className) === g);
          const secs = [
            ...new Set(bs.map((b: Batch) => sectionOf(b.className))),
          ].sort();
          const active = g === grade;
          const totalStudents = bs.reduce(
            (s: number, b: Batch) => s + b.rows.length,
            0
          );
          const avg = bs.length
            ? bs.reduce((s: number, b: Batch) => s + avgOf(b.rows), 0) /
              bs.length
            : 0;
          return (
            <Card
              key={g}
              className={`p-5 ${active ? 'ring-2 ring-brand-500/30' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-[14px] bg-brand-50 text-2xl text-brand-500 dark:bg-navy-700 dark:text-brand-300">
                    <MdSchool />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-navy-900 dark:text-white">
                      {g}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {active
                        ? `Section ${section} selected`
                        : secs.length
                        ? `${secs.length} section${secs.length === 1 ? '' : 's'} with results`
                        : 'No results yet'}
                    </p>
                  </div>
                </div>
                {active && (
                  <span className="rounded-full bg-brand-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                    Active
                  </span>
                )}
              </div>
              <div className="mt-5">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Sections
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sectionOptions.map((s: string) => {
                    const hasData = secs.includes(s);
                    return (
                      <button
                        key={s}
                        disabled={!hasData}
                        onClick={() => hasData && onLoad(g, s)}
                        title={
                          hasData
                            ? `View ${g}${s} results`
                            : `No results for ${g}${s} yet`
                        }
                        className={`h-8 min-w-8 rounded-lg px-2 text-xs font-bold transition ${
                          hasData
                            ? s === section && active
                              ? 'bg-brand-500 text-white'
                              : 'bg-brand-50 text-brand-500 hover:bg-brand-100 dark:bg-navy-700 dark:text-brand-300 dark:hover:bg-navy-600'
                            : 'cursor-not-allowed bg-lightPrimary text-gray-300 dark:bg-navy-700/40 dark:text-gray-600'
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  { label: 'Students', value: `${totalStudents}` },
                  { label: 'Batches', value: `${bs.length}` },
                  { label: 'Average', value: avg ? `${avg.toFixed(1)}%` : '—' },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl bg-lightPrimary px-3 py-2.5 text-center dark:bg-navy-700/60"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {s.label}
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-navy-900 dark:text-white">
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>
              <button
                onClick={() =>
                  bs.length ? onLoad(g, secs[0]) : onUpload()
                }
                className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-bold text-brand-500 transition hover:bg-brand-50 dark:border-navy-600 dark:hover:bg-navy-700"
              >
                {bs.length ? (
                  <>
                    View results <MdChevronRight className="text-lg" />
                  </>
                ) : (
                  <>
                    Upload results <MdUpload className="text-base" />
                  </>
                )}
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Rankings ---------- */

function gradeRankingRows(
  batches: Batch[],
  year: string,
  grade: string,
  semester: string
) {
  const gradeBatches = batches.filter(
    (b) => b.year === year && gradeOf(b.className) === grade
  );
  const subjectSet = new Set<string>();
  const merged: (ScoreRow & { section: string })[] = [];
  const add = (b: Batch, rows: Result[], section: string) => {
    b.subjects.forEach((s) => subjectSet.add(s));
    rows.forEach((r) => merged.push({ ...r, section }));
  };
  if (semester === 'Full Year') {
    const sections = [
      ...new Set(gradeBatches.map((b) => sectionOf(b.className))),
    ];
    sections.forEach((sec) => {
      const s1 = gradeBatches.find(
        (b) => sectionOf(b.className) === sec && b.semester === 'Semester 1'
      );
      const s2 = gradeBatches.find(
        (b) => sectionOf(b.className) === sec && b.semester === 'Semester 2'
      );
      const annual = buildAnnual(s1, s2);
      if (annual) add(annual, annual.rows, sec);
    });
    gradeBatches
      .filter((b) => b.semester === 'Full Year')
      .forEach((b) => add(b, b.rows, sectionOf(b.className)));
  } else {
    gradeBatches
      .filter((b) => b.semester === semester)
      .forEach((b) => add(b, b.rows, sectionOf(b.className)));
  }
  const subjects = [...subjectSet];
  const normalized: ScoreRow[] = merged.map((r) => ({
    ...r,
    scores: Object.fromEntries(subjects.map((s) => [s, r.scores[s] ?? ''])),
  }));
  return { rows: computeResults(normalized, subjects), subjects };
}

function Rankings({
  rows,
  batches,
  setBatches,
  grade,
  section,
  semester,
  year,
  query,
  school,
  active,
  periodSystem,
  onReport,
}: any) {
  const [mode, setMode] = useState<'section' | 'grade'>('section');
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const currentStatus = active?.publishStatus ?? null;
  const canPublish = currentStatus === 'processed' || currentStatus === 'reviewed';
  const isPublished = currentStatus === 'published';

  const publishBatch = async (studentIds?: string[]) => {
    if (!active?.id) return;
    setPublishing(true);
    setPublishMsg('');
    try {
      const body: Record<string, any> = { publish_status: 'published' };
      if (studentIds) body.published_student_ids = studentIds;
      const res = await fetch(`/api/batches/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const d = await res.json();
      // Update local batches state
      setBatches((old: Batch[]) => old.map((b) =>
        b.id === active.id
          ? { ...b, publishStatus: 'published', publishedStudentIds: d.published_student_ids ?? [] }
          : b
      ));
      setPublishMsg(studentIds ? `Published ${studentIds.length} student${studentIds.length !== 1 ? 's' : ''}.` : 'Published to all students.');
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (e: any) {
      setPublishMsg(e.message || 'Publish failed.');
    } finally {
      setPublishing(false);
      setTimeout(() => setPublishMsg(''), 4000);
    }
  };

  // ── Edit scores state ────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<Result | null>(null);
  const [editScores, setEditScores] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [confirmPublishedEdit, setConfirmPublishedEdit] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const openEdit = (r: Result) => {
    setEditTarget(r);
    setEditScores(
      Object.fromEntries(
        (active?.subjects ?? []).map((s: string) => [s, String(r.scores[s] ?? '')])
      )
    );
    setEditError('');
    setConfirmPublishedEdit(false);
  };

  const closeEdit = () => {
    setEditTarget(null);
    setEditScores({});
    setEditError('');
    setConfirmPublishedEdit(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sendEdit = async (confirmed: boolean) => {
    if (!active?.id || !editTarget) return;
    setEditSaving(true);
    setEditError('');
    try {
      const body: Record<string, any> = {
        student_id: editTarget.id,
        scores:     Object.fromEntries(
          Object.entries(editScores).map(([k, v]) => [k, Number(v)])
        ),
      };
      if (confirmed) body.confirmed_published_edit = true;

      const res = await fetch(`/api/batches/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 428) {
        // Published batch — need confirmation
        setConfirmPublishedEdit(true);
        setEditSaving(false);
        return;
      }

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to save');
      }

      // Success — reload batches to get recomputed ranks
      const refreshed = await fetch('/api/batches');
      if (refreshed.ok) {
        const d = await refreshed.json();
        setBatches(d.batches.map((b: any) => {
          const grade = b.grade || b.className?.match(/^Grade \d+/)?.[0] || '';
          const section = b.section || b.className?.replace(/^Grade \d+/, '') || 'A';
          return { ...b, grade, section, className: `${grade}${section}` };
        }));
      }
      setLastUpdated(new Date().toLocaleString());
      closeEdit();
    } catch (e: any) {
      setEditError(e.message || 'Could not save changes.');
    } finally {
      setEditSaving(false);
    }
  };
  const q = (query || '').trim().toLowerCase();
  const gradeData = useMemo(
    () =>
      mode === 'grade'
        ? gradeRankingRows(batches, year, grade, semester)
        : null,
    [batches, year, grade, semester, mode]
  );
  const list =
    mode === 'grade'
      ? (gradeData?.rows || []).filter(
          (r: Result) =>
            !q ||
            r.name.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q)
        )
      : rows;
  const shownClass = (r: Result) =>
    mode === 'grade'
      ? `${grade}${(r as any).section || section}`
      : `${grade}${section}`;
  const title =
    mode === 'grade' ? 'Grade rankings' : 'Class rankings';
  const subtitle =
    mode === 'grade'
      ? `All ${grade} sections · ${semester} · ${year}`
      : `${grade}${section} · ${semester} · ${year}`;
  return (
    <>
    <Card className="p-5 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-brand-500">
            {currentStatus ? `STATUS: ${currentStatus.toUpperCase()}` : 'PROCESSED RESULTS'}
          </p>
          <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
            {title}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {subtitle}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="inline-flex self-start rounded-xl border border-gray-200 bg-lightPrimary p-1 sm:self-auto dark:border-navy-600 dark:bg-navy-700/50">
            <button
              onClick={() => setMode('section')}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                mode === 'section'
                  ? 'bg-white text-brand-500 shadow-[0_4px_12px_rgba(112,144,176,0.25)] dark:bg-navy-800 dark:text-white'
                  : 'text-gray-500 hover:text-navy-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              Section ranking
            </button>
            <button
              onClick={() => setMode('grade')}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                mode === 'grade'
                  ? 'bg-white text-brand-500 shadow-[0_4px_12px_rgba(112,144,176,0.25)] dark:bg-navy-800 dark:text-white'
                  : 'text-gray-500 hover:text-navy-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              Grade ranking
            </button>
          </div>
          <button
            onClick={async () => {
              const { generateRankingDoc } = await import('lib/docx/generators');
              await generateRankingDoc({ rows: list, school, year, grade, section, semester, periodSystem, mode });
            }}
            className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary sm:self-auto dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
          >
            <MdDownload className="text-lg" /> Download Ranking DOC
          </button>

          {/* ── Publish controls (only in section mode for a real batch) ── */}
          {mode === 'section' && active?.id && (
            <div className="flex flex-wrap gap-2 self-start sm:self-auto">
              {isPublished ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-horizonGreen-50 px-3 py-2 text-xs font-bold text-horizonGreen-700 dark:bg-horizonGreen-900/20 dark:text-horizonGreen-300">
                  <MdCheckCircle /> Published
                </span>
              ) : canPublish ? (
                <>
                  <button
                    disabled={publishing}
                    onClick={() => publishBatch()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white shadow-[0_4px_12px_rgba(67,24,255,0.3)] transition hover:bg-brand-600 disabled:opacity-50"
                  >
                    <MdPublish /> {publishing ? 'Publishing…' : 'Publish to All'}
                  </button>
                  <button
                    onClick={() => setSelectMode(!selectMode)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-bold transition ${selectMode ? 'border-brand-500 bg-brand-50 text-brand-600 dark:bg-brand-900/20' : 'border-gray-200 text-navy-900 hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700'}`}
                  >
                    Select students
                  </button>
                  {selectMode && selectedIds.size > 0 && (
                    <button
                      disabled={publishing}
                      onClick={() => publishBatch(Array.from(selectedIds))}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
                    >
                      <MdPublish /> Publish {selectedIds.size} selected
                    </button>
                  )}
                </>
              ) : (
                <span className="inline-flex items-center rounded-xl bg-lightPrimary px-3 py-2 text-xs font-bold text-gray-500 dark:bg-navy-700 dark:text-gray-400">
                  {currentStatus ?? 'No batch'}
                </span>
              )}
            </div>
          )}
          {publishMsg && (
            <p className="self-start text-xs font-medium text-horizonGreen-700 dark:text-horizonGreen-300 sm:self-auto">
              {publishMsg}
            </p>
          )}
        </div>
      </div>

      {!list.length && (
        <p className="py-10 text-center text-sm text-gray-400">
          {mode === 'grade'
            ? `No saved results across ${grade} sections for ${semester} yet.`
            : semester === 'Full Year'
            ? `Both Semester 1 and Semester 2 results are needed to show Full Year rankings for ${grade}${section}.`
            : `No ${semester} results saved for ${grade}${section} yet.`}
        </p>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-y border-gray-200 bg-lightPrimary/60 text-left text-xs uppercase tracking-wide text-gray-600 dark:border-navy-700 dark:bg-navy-700/60 dark:text-gray-400">
              {selectMode && mode === 'section' && <th className="p-3.5 w-10" />}
              <th className="p-3.5 font-bold">Rank</th>
              <th className="p-3.5 font-bold">Student</th>
              <th className="p-3.5 font-bold">Class</th>
              <th className="p-3.5 font-bold">Total</th>
              <th className="p-3.5 font-bold">Average</th>
              <th className="p-3.5 font-bold">Percentage</th>
              <th className="p-3.5 font-bold">Grade</th>
              <th className="p-3.5" />
            </tr>
          </thead>
          <tbody>
            {list.map((r: Result) => (
              <tr
                key={r.id}
                className={`border-b border-gray-100 transition hover:bg-lightPrimary/50 dark:border-navy-700 dark:hover:bg-navy-700/40 ${
                  r.rank <= 3 ? 'bg-lightPrimary/70 dark:bg-navy-700/30' : ''
                }`}
              >
                {selectMode && mode === 'section' && (
                  <td className="p-3.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      className="h-4 w-4 cursor-pointer rounded accent-brand-500"
                    />
                  </td>
                )}
                <td className="p-3.5">
                  <RankBadge rank={r.rank} />
                </td>
                <td className="p-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} className="h-10 w-10 text-sm" />
                    <div>
                      <p className="font-bold text-navy-900 dark:text-white">
                        {r.name}
                      </p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        {r.id}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="p-3.5 text-gray-600 dark:text-gray-400">
                  {shownClass(r)}
                </td>
                <td className="p-3.5 font-bold text-navy-900 dark:text-white">
                  {r.total}/{r.maximum}
                </td>
                <td className="p-3.5 text-gray-600 dark:text-gray-400">
                  {r.average.toFixed(1)}
                </td>
                <td className="p-3.5">
                  <p className="font-bold text-navy-900 dark:text-white">
                    {r.percentage.toFixed(1)}%
                  </p>
                  <span className="mt-0.5 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-600 dark:bg-navy-700 dark:text-brand-300">
                    {r.status}
                  </span>
                </td>
                <td className="p-3.5">
                  <span className="inline-block rounded-full bg-navy-900 px-2.5 py-1 text-xs font-bold text-white dark:bg-brand-500">
                    {r.letterGrade}
                  </span>
                </td>
                <td className="p-3.5 text-right">
                  <div className="inline-flex items-center gap-1">
                    {mode === 'section' && active?.id && (
                      <button
                        onClick={() => openEdit(r)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-gray-500 transition hover:bg-lightPrimary hover:text-navy-900 dark:text-gray-400 dark:hover:bg-navy-700 dark:hover:text-white"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => onReport(r)}
                      className="inline-flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 font-bold text-brand-500 transition hover:bg-brand-50 dark:hover:bg-navy-700"
                    >
                      View report <MdChevronRight className="text-lg" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {list.map((r: Result) => (
          <div
            key={r.id}
            className="rounded-2xl border border-gray-200 p-4 dark:border-navy-600"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar name={r.name} className="h-10 w-10 text-sm" />
                <div>
                  <p className="font-bold text-navy-900 dark:text-white">
                    {r.name}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {r.id} · {shownClass(r)}
                  </p>
                </div>
              </div>
              <RankBadge rank={r.rank} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-lightPrimary px-3 py-2 dark:bg-navy-700/60">
                {r.total}/{r.maximum}
                <small className="block text-[10px] uppercase text-gray-500 dark:text-gray-400">
                  Total
                </small>
              </div>
              <div className="rounded-xl bg-lightPrimary px-3 py-2 dark:bg-navy-700/60">
                {r.average.toFixed(1)}
                <small className="block text-[10px] uppercase text-gray-500 dark:text-gray-400">
                  Average
                </small>
              </div>
              <div className="rounded-xl bg-lightPrimary px-3 py-2 dark:bg-navy-700/60">
                <b>{r.percentage.toFixed(1)}%</b>
                <small className="block text-[10px] uppercase text-gray-500 dark:text-gray-400">
                  {r.status}
                </small>
              </div>
              <div className="rounded-xl bg-navy-900 px-3 py-2 text-white dark:bg-brand-500">
                <b>{r.letterGrade}</b>
                <small className="block text-[10px] uppercase text-white/60">
                  Grade
                </small>
              </div>
            </div>
            <button
              onClick={() => onReport(r)}
              className="mt-3 inline-flex items-center gap-0.5 text-sm font-bold text-brand-500"
            >
              View report <MdChevronRight className="text-lg" />
            </button>
          </div>
        ))}
      </div>
    </Card>

    {/* ── Edit scores modal ─────────────────────────────────────────────── */}
    {editTarget && !confirmPublishedEdit && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-navy-900/60 backdrop-blur-sm" onClick={closeEdit} />
        <div className="relative w-full max-w-lg rounded-2xl bg-white p-7 shadow-2xl dark:bg-navy-800">
          <h3 className="text-lg font-bold text-navy-900 dark:text-white">Edit scores</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {editTarget.name} · {editTarget.id}
            {isPublished && (
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                Published batch — confirmation required to save
              </span>
            )}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {(active?.subjects ?? []).map((s: string) => (
              <label key={s} className="block text-sm font-bold text-navy-900 dark:text-white">
                {s}
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={editScores[s] ?? ''}
                  onChange={e => setEditScores(prev => ({ ...prev, [s]: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-lightPrimary px-3 text-sm font-normal text-navy-900 outline-none transition focus:border-brand-500 dark:border-navy-600 dark:bg-navy-700 dark:text-white"
                />
              </label>
            ))}
          </div>
          {editError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{editError}</p>
          )}
          <div className="mt-6 flex gap-3">
            <button onClick={closeEdit} disabled={editSaving} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary disabled:opacity-50 dark:border-navy-600 dark:text-white">
              Cancel
            </button>
            <button
              onClick={() => sendEdit(false)}
              disabled={editSaving}
              className="flex-1 rounded-xl bg-brand-500 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {editSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Published-edit confirmation dialog ───────────────────────────── */}
    {confirmPublishedEdit && editTarget && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-navy-900/60 backdrop-blur-sm" />
        <div className="relative w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl dark:bg-navy-800">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-2xl text-amber-500 dark:bg-amber-900/30">
            <MdWarningAmber />
          </div>
          <h3 className="mt-4 text-center text-xl font-bold text-navy-900 dark:text-white">
            Already published
          </h3>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            This result has already been published to students.<br />
            Save this change anyway?
          </p>
          {editError && (
            <p className="mt-3 text-center text-sm text-red-600 dark:text-red-400">{editError}</p>
          )}
          <div className="mt-6 flex gap-3">
            <button
              onClick={closeEdit}
              disabled={editSaving}
              className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary disabled:opacity-50 dark:border-navy-600 dark:text-white"
            >
              Cancel — discard
            </button>
            <button
              onClick={() => sendEdit(true)}
              disabled={editSaving}
              className="flex-1 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(217,119,6,0.3)] transition hover:opacity-90 disabled:opacity-60"
            >
              {editSaving ? 'Saving…' : 'Yes, save change'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Last updated timestamp ─────────────────────────────────────────── */}
    {lastUpdated && (
      <p className="mt-2 text-center text-xs text-gray-400 dark:text-gray-500">
        Last updated: {lastUpdated}
      </p>
    )}
  </>
  );
}

/* ---------- Reports ---------- */

function Reports({
  rows,
  subjects,
  selected,
  setSelected,
  school,
  year,
  grade,
  section,
  semester,
  active,
  batches,
  periodSystem,
}: any) {
  const student =
    selected && rows.some((r: Result) => r.id === selected.id)
      ? rows.find((r: Result) => r.id === selected.id)!
      : rows[0];

  // ── Parent contact: fetch for the selected student whenever they change ──
  const [parentData, setParentData] = useState<{ parent_name?: string; parent_phone?: string } | null>(null);
  useEffect(() => {
    if (!student?.id || !grade || !section || !year) return;
    let cancelled = false;
    fetch(`/api/students?grade=${encodeURIComponent(grade)}&section=${encodeURIComponent(section)}&academic_year=${encodeURIComponent(year)}`)
      .then(r => r.ok ? r.json() : { students: [] })
      .then(d => {
        if (cancelled) return;
        const found = (d.students ?? []).find((s: any) => s.student_code === student.id);
        setParentData(found ? { parent_name: found.parent_name ?? undefined, parent_phone: found.parent_phone ?? undefined } : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [student?.id, grade, section, year]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!student)
    return (
      <Card className="p-12 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-500 dark:bg-navy-700">
          <MdDescription />
        </div>
        <p className="mt-4 font-bold text-navy-900 dark:text-white">
          No reports yet
        </p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Process a result sheet to create student reports.
        </p>
      </Card>
    );
  return (
    <div className="space-y-5">
      <div className="no-print flex flex-col flex-wrap gap-4 rounded-[20px] border border-gray-200/70 bg-white p-5 shadow-[0_18px_40px_rgba(112,144,176,0.12)] sm:flex-row sm:items-end dark:border-navy-700 dark:bg-navy-800">
        <label className="flex-1">
          <span className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-400">
            Select student
          </span>
          <select
            value={student.id}
            onChange={(e) =>
              setSelected(rows.find((r: Result) => r.id === e.target.value))
            }
            className="mt-2 block w-full cursor-pointer rounded-xl border border-gray-200 bg-lightPrimary px-4 py-3 text-sm font-bold text-navy-900 outline-none transition focus:border-brand-500 dark:border-navy-600 dark:bg-navy-700 dark:text-white"
          >
            {rows.map((r: Result) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.id}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={async () => {
            const { generateStudentReportDoc } = await import('lib/docx/generators');
            // For Full Year, build periodScores array from actual period batches
            let periodScores: Array<{ periodLabel: string; scores: Record<string, string | number> }> | undefined;
            if (semester === 'Full Year' && batches) {
              const periodLabels = periodSystem === 'quarter'
                ? ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']
                : ['Semester 1', 'Semester 2'];
              periodScores = periodLabels.flatMap((label) => {
                const b = batches.find((b: any) => b.year === year && b.className === `${grade}${section}` && b.semester === label);
                const row = b?.rows?.find((r: any) => r.id === student.id);
                return row ? [{ periodLabel: label, scores: row.scores }] : [];
              });
            }
            await generateStudentReportDoc({ student, subjects, school, year, grade, section, semester, periodSystem, periodScores });
          }}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-brand-500 to-blueSecondary px-5 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(67,24,255,0.3)] transition hover:opacity-90"
        >
          <MdDownload className="text-lg" /> Download Student Report
        </button>
        <button
          onClick={async () => {
            const { generateClassReportDoc } = await import('lib/docx/generators');
            await generateClassReportDoc({ rows, subjects, school, year, grade, section, semester, periodSystem });
          }}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-200 px-5 py-3 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
        >
          <MdDownload className="text-lg" /> Download Class Report
        </button>
        {semester === 'Full Year' && batches && (
          <button
            onClick={async () => {
              const { generateFinalResultDoc } = await import('lib/docx/generators');
              const periodLabels = periodSystem === 'quarter'
                ? ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']
                : ['Semester 1', 'Semester 2'];
              const periods = periodLabels.flatMap((label) => {
                const b = batches.find((b: any) => b.year === year && b.className === `${grade}${section}` && b.semester === label);
                return b ? [{ periodLabel: label, rows: b.rows }] : [];
              });
              if (periods.length === periodLabels.length) {
                await generateFinalResultDoc({ rows, periods, subjects, school, year, grade, section, periodSystem });
              }
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-gray-200 px-5 py-3 text-sm font-bold text-navy-900 transition hover:bg-lightPrimary dark:border-navy-600 dark:text-white dark:hover:bg-navy-700"
          >
            <MdDownload className="text-lg" /> Download Final Result
          </button>
        )}
      </div>
      {/* ── Emergency Contact ────────────────────────────────────────────── */}
      {(() => {
        const hasContact = parentData?.parent_name || parentData?.parent_phone;
        return (
          <div className="no-print rounded-2xl border border-gray-200/70 bg-white px-5 py-4 shadow-[0_4px_16px_rgba(112,144,176,0.08)] dark:border-navy-700 dark:bg-navy-800">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Emergency Contact</p>
            {hasContact ? (
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
                {parentData?.parent_name && (
                  <p>
                    <span className="font-semibold text-gray-500 dark:text-gray-400">Parent / Guardian: </span>
                    <span className="font-bold text-navy-900 dark:text-white">{parentData.parent_name}</span>
                  </p>
                )}
                {parentData?.parent_phone && (
                  <p>
                    <span className="font-semibold text-gray-500 dark:text-gray-400">Phone: </span>
                    <span className="font-bold text-navy-900 dark:text-white">{parentData.parent_phone}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">
                {parentData === null ? 'No portal account — parent contact not available.' : 'Not provided — student has not entered parent contact details.'}
              </p>
            )}
          </div>
        );
      })()}
      <Report
        student={student}
        subjects={subjects}
        school={school}
        year={year}
        grade={grade}
        section={section}
        semester={semester}
      />
    </div>
  );
}

/* ---------- Settings ---------- */

function Settings({ school, setSchool, periodSystem, setPeriodSystem, schoolCode }: any) {
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save a single field to the DB 800 ms after the user stops typing
  const handleChange = (field: string, value: string) => {
    setSchool({ ...school, [field]: value });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving(true);
      setSaveMsg('');
      try {
        const res = await fetch('/api/settings/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value.trim() }),
        });
        if (!res.ok) throw new Error('Save failed');
        setSaveMsg('saved');
      } catch {
        setSaveMsg('error');
      } finally {
        setSaving(false);
        setTimeout(() => setSaveMsg(''), 3000);
      }
    }, 800);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="p-6 sm:p-8">
        <p className="text-sm font-bold text-brand-500">SCHOOL PROFILE</p>
        <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
          School settings
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          These details appear on every result document and are saved to your account.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {([
            ['name',      'School name'],
            ['teacher',   'Teacher name'],
            ['principal', 'Principal / authorized person'],
            ['logo',      'School logo URL'],
          ] as [string, string][]).map(([field, label]) => (
            <label key={field} className="block text-sm font-bold text-navy-900 dark:text-white">
              {label}
              <input
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-lightPrimary px-4 py-3 font-normal text-navy-900 outline-none transition focus:border-brand-500 dark:border-navy-600 dark:bg-navy-700 dark:text-white"
                value={school[field as keyof School] || ''}
                onChange={(e) => handleChange(field, e.target.value)}
              />
            </label>
          ))}
          <label className="block text-sm font-bold text-navy-900 sm:col-span-2 dark:text-white">
            Report footer
            <input
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-lightPrimary px-4 py-3 font-normal text-navy-900 outline-none transition focus:border-brand-500 dark:border-navy-600 dark:bg-navy-700 dark:text-white"
              value={school.footer || ''}
              onChange={(e) => handleChange('footer', e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 flex h-6 items-center">
          {saving && (
            <span className="text-xs text-gray-400 dark:text-gray-500">Saving…</span>
          )}
          {!saving && saveMsg === 'saved' && (
            <span className="flex items-center gap-1 text-xs font-medium text-horizonGreen-700 dark:text-horizonGreen-300">
              <MdCheckCircle /> Saved to your account
            </span>
          )}
          {!saving && saveMsg === 'error' && (
            <span className="text-xs text-red-500">Could not save — check your connection.</span>
          )}
        </div>
      </Card>

      {/* Academic period structure */}
      <Card className="p-6 sm:p-8">
        <p className="text-sm font-bold text-brand-500">ACADEMIC CALENDAR</p>
        <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
          Academic Period Structure
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          Choose how your school divides the academic year. This controls the
          period selector on every page. Existing saved results are not affected.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {([
            ['semester', 'Semester (2 terms)', 'Semester 1 and Semester 2'],
            ['quarter',  'Quarter (4 terms)',   'Quarter 1, 2, 3 and Quarter 4'],
          ] as [string, string, string][]).map(([val, title, sub]) => (
            <button
              key={val}
              type="button"
              onClick={() => {
                setPeriodSystem(val);
                fetch('/api/settings/profile', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ period_system: val }),
                });
              }}
              className={`rounded-xl border-2 p-4 text-left transition ${
                periodSystem === val
                  ? 'border-brand-500 bg-brand-50 dark:bg-navy-700/60'
                  : 'border-gray-200 hover:border-brand-300 dark:border-navy-600 dark:hover:border-brand-500'
              }`}
            >
              <p className={`font-bold ${periodSystem === val ? 'text-brand-600 dark:text-brand-300' : 'text-navy-900 dark:text-white'}`}>
                {title}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</p>
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
          Switching systems will reset the period selector. Re-upload results under the
          new period structure if needed.
        </p>
      </Card>

      {/* School Code — share with students */}
      {schoolCode && (
        <Card className="p-6 sm:p-8">
          <p className="text-sm font-bold text-brand-500">STUDENT PORTAL</p>
          <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
            Your School Code
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Share this code with your students so they can register their portal accounts.
          </p>
          <div className="mt-5 flex items-center gap-4">
            <div className="rounded-2xl bg-brand-50 px-6 py-4 dark:bg-navy-700">
              <p className="font-mono text-3xl font-black tracking-[0.2em] text-brand-600 dark:text-brand-300">
                {schoolCode}
              </p>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              <p>Students go to <strong>Sign In → Student? Create your account here</strong></p>
              <p className="mt-1">and enter this code along with their Student ID.</p>
            </div>
          </div>
        </Card>
      )}

      {/* Gemini API Key — stored securely in Supabase Vault */}
      <Card className="p-6 sm:p-8">
        <p className="text-sm font-bold text-brand-500">EXTRACTION ENGINE</p>
        <h2 className="mt-1 text-2xl font-bold text-navy-900 dark:text-white">
          Gemini API Key
        </h2>
        <p className="mt-2 mb-5 text-sm text-gray-600 dark:text-gray-400">
          Required for uploading image, PDF, and DOCX result sheets. Each school
          uses only their own key — your usage never affects another school's quota.
        </p>
        <GeminiKeyField />
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   TeacherMessages — full message management page embedded in the teacher SPA.

   Layout:
     Left panel  — filterable message list (status + category tabs)
     Right panel — selected thread detail with reply box + status actions

   On mount:
     • Loads the message list via GET /api/messages
     • Refreshes the unread notification count via onCountChange callback so the
       bell badge stays accurate after the teacher reads new messages here.

   Notification count refresh:
     Calls onCountChange(0) immediately on mount (teacher is "looking at" the
     messages page so the badge clears). A real re-fetch happens on mount too.
─────────────────────────────────────────────────────────────────────────────── */

type MsgStatus   = 'pending' | 'resolved' | 'archived';
type MsgCategory = 'complaint' | 'recommendation' | 'question' | 'other';

interface MsgListItem {
  id:          string;
  category:    MsgCategory;
  message:     string;
  status:      MsgStatus;
  created_at:  string;
  updated_at:  string;
  reply_count: number;
  student:     { full_name: string; student_code: string; grade: string; section: string } | null;
}

interface MsgReply {
  id:          string;
  sender_type: 'teacher' | 'student';
  reply_text:  string;
  created_at:  string;
}

interface MsgThread {
  id:         string;
  category:   MsgCategory;
  message:    string;
  status:     MsgStatus;
  created_at: string;
  updated_at: string;
  student:    MsgListItem['student'];
  replies:    MsgReply[];
}

const MSG_STATUS_CFG: Record<MsgStatus, { label: string; cls: string }> = {
  pending:  { label: 'Pending',  cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' },
  resolved: { label: 'Resolved', cls: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400' },
};

const MSG_CATEGORY_CFG: Record<MsgCategory, { label: string; cls: string }> = {
  complaint:      { label: 'Complaint',      cls: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300' },
  recommendation: { label: 'Recommendation', cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' },
  question:       { label: 'Question',       cls: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300' },
  other:          { label: 'Other',          cls: 'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-400' },
};

function msgFormatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

function msgTimeAgo(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return ''; }
}

function TeacherMessages({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [messages,       setMessages]       = useState<MsgListItem[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [statusFilter,   setStatusFilter]   = useState<MsgStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<MsgCategory | 'all'>('all');
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [thread,         setThread]         = useState<MsgThread | null>(null);
  const [threadLoading,  setThreadLoading]  = useState(false);
  const [replyText,      setReplyText]      = useState('');
  const [replying,       setReplying]       = useState(false);
  const [replyError,     setReplyError]     = useState('');
  // Mobile: show either the list or the thread panel (lg+ shows both side-by-side)
  const [mobileView,     setMobileView]     = useState<'list' | 'thread'>('list');

  // Load messages + clear bell badge on mount
  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter   !== 'all') params.set('status',   statusFilter);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      const res = await fetch(`/api/messages?${params}`);
      if (!res.ok) throw new Error('Failed to load messages');
      const d = await res.json();
      setMessages(d.messages ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    loadMessages();
    // When the teacher opens the Messages page, mark all student_message
    // notifications as read (they are now viewing the inbox) and sync the badge.
    fetch('/api/notifications', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mark_all_read: true }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(() => {
        // After marking all read, re-fetch the true unread count
        return fetch('/api/notifications?limit=1&unread=true')
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) onCountChange(d.unread_count ?? 0); });
      })
      .catch(() => {});
  }, [loadMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load thread when selection changes
  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    setThread(null);
    setReplyText('');
    setReplyError('');
    try {
      const res = await fetch(`/api/messages/${id}`);
      if (!res.ok) throw new Error('Failed to load thread');
      const d = await res.json();
      setThread(d.thread);
    } catch (e: any) {
      setReplyError(e.message);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    loadThread(id);
    setMobileView('thread');  // on mobile, switch to thread view
  };

  // Status update
  const handleStatusChange = async (newStatus: MsgStatus) => {
    if (!selectedId || !thread) return;
    try {
      const res = await fetch(`/api/messages/${selectedId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setThread(t => t ? { ...t, status: newStatus } : t);
      setMessages(prev => prev.map(m =>
        m.id === selectedId ? { ...m, status: newStatus } : m
      ));
    } catch (e: any) {
      setReplyError(e.message);
    }
  };

  // Reply
  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !replyText.trim()) return;
    setReplying(true);
    setReplyError('');
    try {
      const res = await fetch(`/api/messages/${selectedId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reply_text: replyText.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Failed to send reply');
      }
      const d = await res.json();
      setThread(t => t ? { ...t, replies: [...t.replies, d.reply] } : t);
      setMessages(prev => prev.map(m =>
        m.id === selectedId ? { ...m, reply_count: m.reply_count + 1 } : m
      ));
      setReplyText('');
    } catch (e: any) {
      setReplyError(e.message);
    } finally {
      setReplying(false);
    }
  };

  const filtered = messages; // server already filters; kept for future client-side use

  return (
    <div className="flex h-[calc(100vh-160px)] min-h-[500px] gap-4 overflow-hidden">

      {/* ── Left panel: message list ─────────────────────────────────────── */}
      {/* On mobile: hidden when a thread is open; visible otherwise.
          On lg+: always visible at a fixed 380px width. */}
      <div className={`flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800 lg:w-[380px] lg:shrink-0 lg:flex ${mobileView === 'list' ? 'w-full' : 'hidden lg:flex'}`}>

        {/* Filter bar */}
        <div className="border-b border-gray-100 p-4 dark:border-navy-700">
          <h2 className="mb-3 text-base font-bold text-navy-900 dark:text-white">Messages</h2>
          <div className="flex flex-wrap gap-2">
            {/* Status filter */}
            {(['all', 'pending', 'resolved', 'archived'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  statusFilter === s
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-400 dark:hover:bg-navy-600'
                }`}
              >
                {s === 'all' ? 'All' : MSG_STATUS_CFG[s].label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Category filter */}
            {(['all', 'complaint', 'recommendation', 'question', 'other'] as const).map(c => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  categoryFilter === c
                    ? 'bg-navy-700 text-white dark:bg-navy-600'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-500 dark:hover:bg-navy-600'
                }`}
              >
                {c === 'all' ? 'All types' : MSG_CATEGORY_CFG[c].label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-0 divide-y divide-gray-100 dark:divide-navy-700">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="p-4">
                  <div className="flex gap-2">
                    <div className="h-4 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
                    <div className="h-4 w-12 animate-pulse rounded-full bg-gray-100 dark:bg-navy-800" />
                  </div>
                  <div className="mt-2 h-3.5 w-full animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                  <div className="mt-1.5 h-3 w-24 animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="p-6 text-center text-sm text-red-500">{error}</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
              <MdMessage className="text-4xl text-gray-300 dark:text-gray-600" />
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                No messages
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Messages from students will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-navy-700">
              {filtered.map(m => {
                const statusCfg   = MSG_STATUS_CFG[m.status];
                const categoryCfg = MSG_CATEGORY_CFG[m.category];
                const isSelected  = m.id === selectedId;

                return (
                  <li key={m.id}>
                    <button
                      onClick={() => handleSelect(m.id)}
                      className={`w-full p-4 text-left transition ${
                        isSelected
                          ? 'bg-brand-50 dark:bg-brand-900/10'
                          : 'hover:bg-gray-50 dark:hover:bg-navy-700/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${categoryCfg.cls}`}>
                          {categoryCfg.label}
                        </span>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCfg.cls}`}>
                          {statusCfg.label}
                        </span>
                        {m.reply_count > 0 && (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">
                            {m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs text-navy-700 dark:text-gray-300">
                        {m.message}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                          {m.student?.full_name ?? 'Unknown student'}
                          {m.student ? ` · Grade ${m.student.grade}${m.student.section}` : ''}
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                          {msgTimeAgo(m.created_at)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Right panel: thread detail ───────────────────────────────────── */}
      {/* On mobile: shown when mobileView === 'thread', hidden otherwise.
          On lg+: always visible alongside the list. */}
      <div className={`flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-navy-700 dark:bg-navy-800 ${mobileView === 'thread' ? 'flex' : 'hidden lg:flex'}`}>
        {!selectedId ? (
          /* Empty state — only visible on lg+ since mobile starts on list view */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
            <MdMessage className="text-5xl text-gray-200 dark:text-gray-600" />
            <p className="text-base font-bold text-gray-400 dark:text-gray-500">
              Select a message to view the thread
            </p>
          </div>
        ) : threadLoading ? (
          /* Loading skeleton */
          <div className="flex flex-1 flex-col gap-4 p-6">
            {/* Mobile back button */}
            <button
              onClick={() => setMobileView('list')}
              className="flex items-center gap-1.5 self-start text-sm font-semibold text-brand-500 hover:underline lg:hidden"
            >
              <MdArrowBack size={18} /> Back to messages
            </button>
            <div className="flex gap-2">
              <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-gray-100 dark:bg-navy-800" />
            </div>
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-3">
                <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-navy-700" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-navy-700" />
                  <div className="h-3 w-full animate-pulse rounded bg-gray-100 dark:bg-navy-800" />
                </div>
              </div>
            ))}
          </div>
        ) : thread ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Thread header */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4 dark:border-navy-700 sm:p-5">
              <div className="flex items-start gap-3">
                {/* Mobile back button */}
                <button
                  onClick={() => setMobileView('list')}
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700 lg:hidden"
                  aria-label="Back to messages"
                >
                  <MdArrowBack size={18} />
                </button>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${MSG_CATEGORY_CFG[thread.category].cls}`}>
                      {MSG_CATEGORY_CFG[thread.category].label}
                    </span>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${MSG_STATUS_CFG[thread.status].cls}`}>
                      {MSG_STATUS_CFG[thread.status].label}
                    </span>
                  </div>
                  {thread.student && (
                    <p className="mt-1.5 text-sm font-semibold text-navy-700 dark:text-white">
                      {thread.student.full_name}
                      <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                        Grade {thread.student.grade}{thread.student.section} · {thread.student.student_code}
                      </span>
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                    {msgFormatDate(thread.created_at)}
                  </p>
                </div>
              </div>

              {/* Status action buttons */}
              <div className="flex flex-wrap gap-2">
                {thread.status !== 'pending' && (
                  <button
                    onClick={() => handleStatusChange('pending')}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300"
                  >
                    Mark Pending
                  </button>
                )}
                {thread.status !== 'resolved' && (
                  <button
                    onClick={() => handleStatusChange('resolved')}
                    className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700 transition hover:bg-green-100 dark:border-green-700/40 dark:bg-green-900/20 dark:text-green-300"
                  >
                    Mark Resolved
                  </button>
                )}
                {thread.status !== 'archived' && (
                  <button
                    onClick={() => handleStatusChange('archived')}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500 transition hover:bg-gray-100 dark:border-navy-600 dark:bg-navy-700 dark:text-gray-400"
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>

            {/* Messages + replies */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {/* Original message */}
              <div className="flex gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                  {thread.student?.full_name?.charAt(0).toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-navy-700 dark:text-white">
                    {thread.student?.full_name ?? 'Student'}
                  </p>
                  <div className="mt-1 rounded-2xl rounded-tl-none bg-gray-50 px-4 py-3 dark:bg-navy-700/60">
                    <p className="whitespace-pre-wrap text-sm text-navy-700 dark:text-gray-200">
                      {thread.message}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                    {msgFormatDate(thread.created_at)}
                  </p>
                </div>
              </div>

              {/* Replies */}
              {thread.replies.map(r => {
                const isTeacher = r.sender_type === 'teacher';
                return (
                  <div key={r.id} className={`flex gap-3 ${isTeacher ? 'flex-row-reverse' : ''}`}>
                    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                      isTeacher
                        ? 'bg-brand-500 text-white'
                        : 'bg-gray-200 text-gray-600 dark:bg-navy-700 dark:text-gray-300'
                    }`}>
                      {isTeacher ? 'T' : thread.student?.full_name?.charAt(0).toUpperCase() ?? 'S'}
                    </div>
                    <div className={`min-w-0 flex-1 ${isTeacher ? 'flex flex-col items-end' : ''}`}>
                      <p className="text-xs font-bold text-navy-700 dark:text-white">
                        {isTeacher ? 'You (Teacher)' : thread.student?.full_name ?? 'Student'}
                      </p>
                      <div className={`mt-1 inline-block max-w-[90%] rounded-2xl px-4 py-3 ${
                        isTeacher
                          ? 'rounded-tr-none bg-brand-50 dark:bg-brand-900/20'
                          : 'rounded-tl-none bg-gray-50 dark:bg-navy-700/60'
                      }`}>
                        <p className="whitespace-pre-wrap text-sm text-navy-700 dark:text-gray-200">
                          {r.reply_text}
                        </p>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                        {msgFormatDate(r.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reply box */}
            {thread.status !== 'archived' ? (
              <form onSubmit={handleReply} className="border-t border-gray-100 p-4 dark:border-navy-700">
                {replyError && (
                  <p className="mb-2 text-xs text-red-500">{replyError}</p>
                )}
                <div className="flex gap-3">
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="Write a reply…"
                    className="flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-navy-900 outline-none placeholder:text-gray-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-navy-600 dark:bg-navy-700 dark:text-white dark:placeholder:text-gray-500 dark:focus:border-brand-500"
                  />
                  <button
                    type="submit"
                    disabled={replying || !replyText.trim()}
                    className="grid h-11 w-11 shrink-0 place-items-center self-end rounded-xl bg-brand-500 text-white shadow transition hover:bg-brand-600 disabled:opacity-50"
                    aria-label="Send reply"
                  >
                    <MdSend className="text-base" />
                  </button>
                </div>
              </form>
            ) : (
              <p className="border-t border-gray-100 p-4 text-center text-xs text-gray-400 dark:border-navy-700 dark:text-gray-500">
                This thread is archived. Unarchive it to reply.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
