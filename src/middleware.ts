import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
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

  // Refresh session — IMPORTANT: no logic between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // ── Paths that never require authentication or approval ──────────────────
  const publicPaths = [
    '/auth/sign-in',
    '/auth/sign-up',
    '/auth/callback',
    '/auth/pending-approval',
    '/auth/rejected',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/api/auth/signup',
    '/student',   // student portal (placeholder for Phase 4)
  ];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  // ── 1. Unauthenticated users ─────────────────────────────────────────────
  if (!user && !isPublic) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // ── 2. Authenticated users ────────────────────────────────────────────────
  if (user) {
    const isApiRoute = pathname.startsWith('/api/');

    if (!isApiRoute) {
      // ── Determine account type ────────────────────────────────────────────
      // Check schools table first (fast path for teachers — the common case).
      const { data: school } = await supabase
        .from('schools')
        .select('status, is_admin')
        .eq('id', user.id)
        .single();

      if (school) {
        // ── TEACHER path ────────────────────────────────────────────────────
        const status  = school.status  ?? 'pending';
        const isAdmin = school.is_admin ?? false;

        if (status === 'pending' && pathname !== '/auth/pending-approval') {
          const url = request.nextUrl.clone();
          url.pathname = '/auth/pending-approval';
          return NextResponse.redirect(url);
        }

        if (
          (status === 'rejected' || status === 'suspended') &&
          pathname !== '/auth/rejected'
        ) {
          const url = request.nextUrl.clone();
          url.pathname = '/auth/rejected';
          return NextResponse.redirect(url);
        }

        if (
          status === 'approved' &&
          (pathname === '/auth/pending-approval' || pathname === '/auth/rejected')
        ) {
          const url = request.nextUrl.clone();
          url.pathname = isAdmin ? '/school-admin' : '/';
          return NextResponse.redirect(url);
        }

        if (pathname.startsWith('/school-admin') && !isAdmin) {
          const url = request.nextUrl.clone();
          url.pathname = '/';
          return NextResponse.redirect(url);
        }

        if (pathname === '/auth/sign-in') {
          const url = request.nextUrl.clone();
          url.pathname = isAdmin ? '/school-admin' : '/';
          url.searchParams.delete('next');
          return NextResponse.redirect(url);
        }

        // ── Block teachers from the student portal ────────────────────────
        if (pathname.startsWith('/student')) {
          const url = request.nextUrl.clone();
          url.pathname = '/';
          return NextResponse.redirect(url);
        }

      } else {
        // ── STUDENT path ────────────────────────────────────────────────────
        // No row in schools → check if this auth.uid() is a student portal account.
        const { data: studentRow } = await supabase
          .from('students')
          .select('id, portal_status')
          .eq('auth_user_id', user.id)
          .single();

        if (studentRow) {
          // Student is logged in — route them to /student, block teacher pages
          if (pathname === '/auth/sign-in') {
            const url = request.nextUrl.clone();
            url.pathname = '/student';
            url.searchParams.delete('next');
            return NextResponse.redirect(url);
          }

          // Block students from every teacher page and API (except public paths)
          const studentAllowed = ['/student', '/auth/reset-password', '/auth/sign-in'];
          if (!studentAllowed.some((p) => pathname.startsWith(p))) {
            const url = request.nextUrl.clone();
            url.pathname = '/student';
            return NextResponse.redirect(url);
          }
        } else {
          // Auth user exists but is neither a school nor a student — orphaned account.
          // Send to sign-in to avoid an infinite redirect loop.
          if (pathname !== '/auth/sign-in') {
            const url = request.nextUrl.clone();
            url.pathname = '/auth/sign-in';
            return NextResponse.redirect(url);
          }
        }
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|fonts|img|svg|manifest\\.json|robots\\.txt|pdf\\.worker).*)',
  ],
};
