import { getIronSession, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Auth gate per eng review A1: layout-based, Node runtime only.
 *
 * NO middleware. NO Edge runtime. Single password (env AUTH_PASSWORD)
 * sealed into an iron-session cookie. requireSession() guards pages
 * via the (app) layout. withSession() wraps route handlers.
 */

export type SessionData = {
  authed: true
  loggedInAt: number // ms epoch
}

const sessionPassword = process.env.SESSION_SECRET ?? ''
if (sessionPassword.length < 32) {
  // iron-session enforces 32+ chars. We surface this loudly at boot, not
  // silently at first request, because a too-short password breaks login.
  if (process.env.NODE_ENV !== 'test') {
    console.error(
      '[auth] SESSION_SECRET must be 32+ chars. Generate with: openssl rand -hex 32',
    )
  }
}

export const sessionOptions: SessionOptions = {
  cookieName: 'ainextleveler_session',
  password: sessionPassword.padEnd(32, '0'), // pad so dev doesn't crash before .env is set
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24, // 24h per design
    path: '/',
  },
}

/**
 * Server-component / page guard. Reads the cookie via next/headers.
 * Redirects to /login if invalid. Returns the session on success.
 */
export async function requireSession(): Promise<SessionData> {
  const cookieStore = await cookies()
  const session = await getIronSession<Partial<SessionData>>(
    cookieStore,
    sessionOptions,
  )
  if (!session.authed) {
    redirect('/login')
  }
  return session as SessionData
}

/**
 * Route-handler wrapper. Call as:
 *   export const POST = withSession(async (req, session) => { ... })
 * Returns 401 JSON if not authed.
 */
export function withSession<Args extends unknown[]>(
  handler: (
    req: NextRequest,
    session: SessionData,
    ...args: Args
  ) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ...args: Args): Promise<Response> => {
    const cookieStore = await cookies()
    const session = await getIronSession<Partial<SessionData>>(
      cookieStore,
      sessionOptions,
    )
    if (!session.authed) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    return handler(req, session as SessionData, ...args)
  }
}

/**
 * Verify password and create session. Used by /login form action.
 * Returns true on success. Sets cookie via passed-in cookie store.
 */
export async function logIn(password: string): Promise<boolean> {
  const expected = process.env.AUTH_PASSWORD
  if (!expected || password !== expected) return false
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions)
  session.authed = true
  session.loggedInAt = Date.now()
  await session.save()
  return true
}

/**
 * Clear the session cookie. Used by /logout form action.
 */
export async function logOut(): Promise<void> {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions)
  session.destroy()
}
