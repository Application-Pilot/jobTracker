/**
 * /api/gmail/connect — starts direct Google OAuth for gmail.readonly.
 *
 * Middleware protects this route, so only signed-in app users can start
 * the Gmail consent flow. The route uses the same stateless signed state
 * helper as Cognito sign-in.
 */
import { NextResponse } from 'next/server';
import { getGmailLoginUrl } from '@/lib/gmail-oauth';
import { signState } from '@/lib/state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = await signState();
  return NextResponse.redirect(getGmailLoginUrl(state));
}
