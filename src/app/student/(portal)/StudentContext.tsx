'use client';
/**
 * StudentContext — single source of truth for the student's own profile
 * within the student portal.
 *
 * WHY THIS EXISTS:
 * Before this context, three separate components each called /api/student/me
 * independently:
 *   1. StudentAvatar in layout.tsx (sidebar avatar + name)
 *   2. The profile page (student details page)
 *   3. Any other page that needed the student's name or grade
 *
 * This caused N duplicate HTTP round-trips to the same endpoint on every
 * page navigation. This context fetches /api/student/me ONCE when the portal
 * layout mounts and shares the result with all children via React context.
 *
 * USAGE:
 *   // In layout.tsx — wrap children once:
 *   <StudentProvider>{children}</StudentProvider>
 *
 *   // In any child component:
 *   const { student, loading } = useStudent();
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface StudentProfile {
  id:            string;
  student_code:  string;
  full_name:     string;
  grade:         string;
  section:       string;
  academic_year: string;
  school_id:     string;
  portal_status: string;
}

interface StudentContextValue {
  student: StudentProfile | null;
  loading: boolean;
  error:   string;
  /** Call this to force a re-fetch (e.g. after a profile update). */
  refresh: () => void;
}

// ── Context ───────────────────────────────────────────────────────────────────
const StudentContext = createContext<StudentContextValue>({
  student: null,
  loading: true,
  error:   '',
  refresh: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────
export function StudentProvider({ children }: { children: ReactNode }) {
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [tick,    setTick]    = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetch('/api/student/me')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load profile'))))
      .then((d) => {
        if (!cancelled) setStudent(d.student ?? null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tick]);

  const refresh = () => setTick((t) => t + 1);

  return (
    <StudentContext.Provider value={{ student, loading, error, refresh }}>
      {children}
    </StudentContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useStudent(): StudentContextValue {
  return useContext(StudentContext);
}
