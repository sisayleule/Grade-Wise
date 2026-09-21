import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// ── Role-cache cookie ─────────────────────────────────────────────────────────
// After the first DB lookup, we store the user's role in a short-lived
// first-party cookie so that subsequent navigations skip the two Supabase DB
// round-trips entirely.  Only getUser() remains mandatory on every request
// because it handles JWT refresh.
//
// Cookie name:  gw-role
// Cookie value: one of:
//   "student:active"
//   "student:pending"
//   "student:rejected"
//   "teacher:approved"
//   "teacher:pending"
//   "teacher:rejected"
//   "teacher:suspended"
//   "admin:approved"
//
// Max-age: 5 minutes.  Short enough that a portal_status change (e.g. teacher
// approving a student) is reflected quickly; long enough to eliminate the DB
// hit on typical browsing sessions.
const ROLE_COOKIE  = 'gw-role';
const ROLE_MAX_AGE = 5 * 60; // seconds

function parseRoleCookie(value: string | undefined): { kind: 'student' | 'teacher' | 'admin'; status: string } | null {
  if (!value) return null;
  const [kind, status] = value.split(':');
  if ((kind === 'student' || kind === 'teacher' || kind === 'admin') && status) {
    return { kind: kind as 'student' | 'teacher' | 'admin', status };
  }
  return null;
}

export async function middleware(request: NextRequest) {
  // ── Cookie-refresh scaffolding ────────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() must run before anything else — it handles JWT refresh.
  const { data: { user } } = await supabase.auth.getUser();

  // ── Helper: redirect while preserving refreshed auth cookies ─────────────
  function redirect(pathname: string, extraParams?: Record<string, string>) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = '';
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        url.searchParams.set(k, v);
      }
    }
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach(({ name, value, ...opts }) => {
      res.cookies.set(name, value, opts as any);
    });
    return res;
  }

  // ── Helper: attach role cookie to a response ──────────────────────────────
  function withRoleCookie(res: NextResponse, roleValue: string): NextResponse {
    res.cookies.set(ROLE_COOKIE, roleValue, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ROLE_MAX_AGE,
      // secure: only in production (HTTPS)
      secure: process.env.NODE_ENV === 'production',
    });
    return res;
  }

  const { pathname } = request.nextUrl;

  // ── Public paths — never require auth ────────────────────────────────────
  const publicPaths = [
    '/auth/sign-in',
    '/auth/sign-up',
    '/auth/callback',
    '/auth/pending-approval',
    '/auth/rejected',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/student-sign-up',
    '/api/auth/signup',
    '/api/auth/student-signup',
    '/student/pending',
    '/student/rejected',
  ];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  // ── 1. Unauthenticated ────────────────────────────────────────────────────
  if (!user && !isPublic) {
    // Clear any stale role cookie on sign-out
    supabaseResponse.cookies.delete(ROLE_COOKIE);
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return redirect('/auth/sign-in', { next: pathname });
  }

  // ── 2. Authenticated — route based on role ────────────────────────────────
  if (user && !pathname.startsWith('/api/')) {

    // ── Fast path: trust the cached role cookie ───────────────────────────
    // Only used for non-auth-page navigations where the role is already known.
    // We always re-validate on auth pages (sign-in) to ensure correct redirect.
    const cachedRole = parseRoleCookie(request.cookies.get(ROLE_COOKIE)?.value);

    if (cachedRole && pathname !== '/auth/sign-in') {
      const { kind, status } = cachedRole;

      if (kind === 'student') {
        const studentDest = status === 'pending'
          ? '/student/pending'
          : status === 'rejected'
          ? '/student/rejected'
          : '/student';

        // Already on the correct student area — let through
        if (pathname.startsWith(studentDest)) return supabaseResponse;

        // On a different student status page — redirect to correct one
        if (pathname.startsWith('/student/pending') ||
            pathname.startsWith('/student/rejected') ||
            pathname.startsWith('/student')) {
          if (!pathname.startsWith(studentDest)) return redirect(studentDest);
          return supabaseResponse;
        }

        // Anywhere else — redirect to student portal
        return redirect(studentDest);
      }

      if (kind === 'teacher' || kind === 'admin') {
        const isAdmin = kind === 'admin';

        if (status === 'pending' && pathname !== '/auth/pending-approval') {
          return redirect('/auth/pending-approval');
        }
        if ((status === 'rejected' || status === 'suspended') && pathname !== '/auth/rejected') {
          return redirect('/auth/rejected');
        }
        if (status === 'approved' && (pathname === '/auth/pending-approval' || pathname === '/auth/rejected')) {
          return redirect(isAdmin ? '/school-admin' : '/');
        }
        if (pathname.startsWith('/school-admin') && !isAdmin) {
          return redirect('/');
        }
        // Block teachers from student portal
        if (pathname.startsWith('/student')) return redirect('/');

        return supabaseResponse;
      }
    }

    // ── Slow path: query the DB to determine role (first visit or cookie expired)
    const [{ data: studentRow }, { data: school }] = await Promise.all([
      supabase
        .from('students')
        .select('id, portal_status')
        .eq('auth_user_id', user.id)
        .maybeSingle(),
      supabase
        .from('schools')
        .select('status, is_admin')
        .eq('id', user.id)
        .maybeSingle(),
    ]);

    if (studentRow) {
      const ps = studentRow.portal_status ?? 'pending';

      const studentDest = ps === 'pending'
        ? '/student/pending'
        : ps === 'rejected'
        ? '/student/rejected'
        : '/student';

      if (pathname.startsWith(studentDest)) {
        return withRoleCookie(supabaseResponse, `student:${ps}`);
      }

      if (
        pathname.startsWith('/student/pending') ||
        pathname.startsWith('/student/rejected') ||
        pathname.startsWith('/student')
      ) {
        if (!pathname.startsWith(studentDest)) return redirect(studentDest);
        return withRoleCookie(supabaseResponse, `student:${ps}`);
      }

      if (pathname === '/auth/sign-in') {
        const res = redirect(studentDest);
        return withRoleCookie(res, `student:${ps}`);
      }

      const studentAllowed = ['/student', '/auth/reset-password'];
      if (!studentAllowed.some((p) => pathname.startsWith(p))) {
        return redirect(studentDest);
      }

      return withRoleCookie(supabaseResponse, `student:${ps}`);
    }

    // ── Teacher / Admin path ──────────────────────────────────────────────
    if (school) {
      const status  = school.status  ?? 'pending';
      const isAdmin = school.is_admin ?? false;
      const roleValue = `${isAdmin ? 'admin' : 'teacher'}:${status}`;

      if (status === 'pending' && pathname !== '/auth/pending-approval') {
        return withRoleCookie(redirect('/auth/pending-approval'), roleValue);
      }

      if (
        (status === 'rejected' || status === 'suspended') &&
        pathname !== '/auth/rejected'
      ) {
        return withRoleCookie(redirect('/auth/rejected'), roleValue);
      }

      if (
        status === 'approved' &&
        (pathname === '/auth/pending-approval' || pathname === '/auth/rejected')
      ) {
        return withRoleCookie(redirect(isAdmin ? '/school-admin' : '/'), roleValue);
      }

      if (pathname.startsWith('/school-admin') && !isAdmin) {
        return withRoleCookie(redirect('/'), roleValue);
      }

      if (pathname === '/auth/sign-in') {
        return withRoleCookie(redirect(isAdmin ? '/school-admin' : '/'), roleValue);
      }

      if (pathname.startsWith('/student')) {
        return withRoleCookie(redirect('/'), roleValue);
      }

      return withRoleCookie(supabaseResponse, roleValue);

    } else {
      // Orphaned auth user — clear role cookie and send to sign-in
      supabaseResponse.cookies.delete(ROLE_COOKIE);
      if (pathname !== '/auth/sign-in') return redirect('/auth/sign-in');
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|fonts|img|svg|manifest\\.json|robots\\.txt|pdf\\.worker).*)',
  ],
};
