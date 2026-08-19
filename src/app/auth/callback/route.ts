import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'lib/supabase/server';

/**
 * Supabase Auth callback handler.
 * Called after email confirmation or OAuth redirect.
 * Exchanges the auth code for a session and redirects to the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth failed — redirect to sign-in with error flag
  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_callback_failed`);
}
