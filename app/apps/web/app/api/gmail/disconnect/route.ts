/**
 * /api/gmail/disconnect — clears stored Gmail connection state.
 *
 * This does not revoke the Google refresh token; Stage 3 can add token
 * revocation from Google's side. For Session B we remove our encrypted copy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { disconnectGmailAccount } from '@/lib/users';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-sub');
  if (!userId) {
    return new NextResponse('Missing authenticated user', { status: 401 });
  }

  await disconnectGmailAccount(userId);

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    return new NextResponse('APP_URL env var not set', { status: 500 });
  }
  return NextResponse.redirect(`${appUrl}/`);
}
