import { NextRequest, NextResponse } from 'next/server';
import { signSession, SESSION_COOKIE, TTL_SECONDS } from '@/lib/session';
import { isTvUserAgent } from '@/lib/lock';

const API = 'https://api.akn.me.uk';

export async function GET(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const hasSession = cookieHeader.includes('__session=');

  if (!hasSession) {
    const callbackUrl = new URL('/api/auth/callback', req.url).toString();
    return NextResponse.redirect(`https://id.akn.me.uk?redirect=${encodeURIComponent(callbackUrl)}`);
  }

  try {
    const r = await fetch(`${API}/auth/session/refresh`, {
      method: 'POST',
      headers: { cookie: cookieHeader },
    });

    if (!r.ok) {
      const callbackUrl = new URL('/api/auth/callback', req.url).toString();
      return NextResponse.redirect(`https://id.akn.me.uk?redirect=${encodeURIComponent(callbackUrl)}`);
    }

    const user = await r.json() as {
      authenticated: boolean;
      uid: string;
      email: string;
      role: string;
      projects: string[];
    };

    const hasAccess =
      user.authenticated &&
      (user.role === 'admin' || user.projects?.includes('*') || user.projects?.includes('startpage'));

    if (!hasAccess) {
      return new NextResponse('Access not granted for startpage.', { status: 403 });
    }

    const token = await signSession({
      uid: user.uid,
      email: user.email ?? null,
      displayName: null,
      role: user.role ?? 'user',
      projects: user.projects ?? [],
      ...(isTvUserAgent(req.headers.get('user-agent')) ? { device: 'tv' as const } : {}),
    });

    const res = NextResponse.redirect(new URL('/', req.url));
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: TTL_SECONDS,
      path: '/',
    });

    // Write lastAccess to Firestore via API (fire-and-forget)
    fetch(`${API}/auth/project-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
      body: JSON.stringify({ project: 'startpage' }),
    }).catch(() => {});

    return res;
  } catch {
    const callbackUrl = new URL('/api/auth/callback', req.url).toString();
    return NextResponse.redirect(`https://id.akn.me.uk?redirect=${encodeURIComponent(callbackUrl)}`);
  }
}
