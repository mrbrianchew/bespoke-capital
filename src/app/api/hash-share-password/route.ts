import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/requireUser'
import { hashSharePassword } from '@/lib/sharePassword'

// Basic in-memory rate limiter (per server instance), keyed by user id.
// Prevents this from being used as a bcrypt-hashing oracle.
const attempts = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 30
function tooManyAttempts(key: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(key) || []).filter(t => now - t < WINDOW_MS)
  recent.push(now)
  attempts.set(key, recent)
  return recent.length > MAX_ATTEMPTS
}

// POST — any logged-in advisor may hash a password for a share link they're
// about to create/update. The plaintext never touches storage; only the
// returned bcrypt hash is persisted by the caller's own (RLS-protected)
// insert/update.
export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (tooManyAttempts(user.id)) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })

  const { password } = await req.json()
  if (!password || typeof password !== 'string' || !password.trim()) {
    return NextResponse.json({ error: 'password_required' }, { status: 400 })
  }

  const hash = await hashSharePassword(password.trim())
  return NextResponse.json({ hash })
}
