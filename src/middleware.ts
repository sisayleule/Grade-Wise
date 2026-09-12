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

  // IMPORTANT: no logic between createServerClient and getUser().
  const { data: { user } } = await supabase.auth.getUser();

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

  // ── 1. Unauthenticated ───────────────────────────────────────────────────
  if (!user && !isPublic) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // ── 2. Authenticated — determine account type ────────────────────────────
  if (user && !pathname.startsWith('/api/')) {

    // ── STUDENT check FIRST ───────────────────────────────────────────────
    // A student auth user may also have a phantom schools row (created by
    // the handle_new_user trigger before migration 011 fixed it). Checking
    // students first ensures students are never mis-routed as teachers.
    const { data: studentRow } = await supabase
      .from('students')
      .select('id, portal_status')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (studentRow) {
      const ps = studentRow.portal_status ?? 'pending';

      const studentDest = ps === 'pending'
        ? '/student/pending'
        : ps === 'rejected'
        ? '/student/rejected'
        : '/student';

      // Already on the right status page — let through
      if (pathname.startsWith(studentDest)) return supabaseResponse;

      // On a status page but status has changed → redirect to correct dest
      if (
        pathname.startsWith('/student/pending') ||
        pathname.startsWith('/student/rejected') ||
        pathname.startsWith('/student')
      ) {
        if (!pathname.startsWith(studentDest)) {
          const url = request.nextUrl.clone();
          url.pathname = studentDest;
          return NextResponse.redirect(url);
        }
        return supabaseResponse;
      }

      // Sign-in page → redirect to student portal
      if (pathname === '/auth/sign-in') {
        const url = request.nextUrl.clone();
        url.pathname = studentDest;
        url.searchParams.delete('next');
        return NextResponse.redirect(url);
      }

      // Any other page (teacher pages, reset-password etc.) → redirect to portal
      const studentAllowed = ['/student', '/auth/reset-password'];
      if (!studentAllowed.some((p) => pathname.startsWith(p))) {
        const url = request.nextUrl.clone();
        url.pathname = studentDest;
        return NextResponse.redirect(url);
      }

      return supabaseResponse;
    }

    // ── TEACHER / ADMIN check ─────────────────────────────────────────────
    const { data: school } = await supabase
      .from('schools')
      .select('status, is_admin')
      .eq('id', user.id)
      .single();

    if (school) {
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

      // Block teachers from student portal
      if (pathname.startsWith('/student')) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        return NextResponse.redirect(url);
      }

    } else {
      // Auth user is neither a student nor a school — orphaned account.
      if (pathname !== '/auth/sign-in') {
        const url = request.nextUrl.clone();
        url.pathname = '/auth/sign-in';
        return NextResponse.redirect(url);
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
