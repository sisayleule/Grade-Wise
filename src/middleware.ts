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
  ];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  // ── 1. Unauthenticated users ─────────────────────────────────────────────
  if (!user && !isPublic) {
    // API routes: return 401 directly instead of redirecting to sign-in page
    // (a redirect would be followed by fetch() and return 200 from sign-in HTML)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // ── 2. Authenticated users on a public page ───────────────────────────────
  // Check their status before deciding where to send them.
  if (user) {
    // API routes handle their own 403 — don't redirect API calls here.
    const isApiRoute = pathname.startsWith('/api/');

    if (!isApiRoute) {
      // Fetch the school status (one extra DB round-trip, cached at edge).
      // We only do this for page navigations, not for asset/static requests.
      const { data: school } = await supabase
        .from('schools')
        .select('status, is_admin')
        .eq('id', user.id)
        .single();

      const status = school?.status ?? 'pending';
      const isAdmin = school?.is_admin ?? false;

      // ── Pending ─────────────────────────────────────────────────────────
      if (status === 'pending' && pathname !== '/auth/pending-approval') {
        const url = request.nextUrl.clone();
        url.pathname = '/auth/pending-approval';
        return NextResponse.redirect(url);
      }

      // ── Rejected / Suspended ────────────────────────────────────────────
      if (
        (status === 'rejected' || status === 'suspended') &&
        pathname !== '/auth/rejected'
      ) {
        const url = request.nextUrl.clone();
        url.pathname = '/auth/rejected';
        return NextResponse.redirect(url);
      }

      // ── Approved: redirect status pages back to app ─────────────────────
      if (
        status === 'approved' &&
        (pathname === '/auth/pending-approval' || pathname === '/auth/rejected')
      ) {
        const url = request.nextUrl.clone();
        url.pathname = isAdmin ? '/school-admin' : '/';
        return NextResponse.redirect(url);
      }

      // ── Admin gate: /school-admin is only for is_admin=true ─────────────
      if (pathname.startsWith('/school-admin') && !isAdmin) {
        const url = request.nextUrl.clone();
        url.pathname = '/';
        return NextResponse.redirect(url);
      }

      // ── Already logged in + approved → skip sign-in page ─────────────────
      if (pathname === '/auth/sign-in') {
        const url = request.nextUrl.clone();
        url.pathname = isAdmin ? '/school-admin' : '/';
        url.searchParams.delete('next');
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
