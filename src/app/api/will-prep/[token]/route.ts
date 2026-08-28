import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifySharePassword } from '@/lib/sharePassword'

// Client-facing route — must never be cached by Vercel's fetch cache.
// Without this, a client could be served a stale draft after the advisor
// (or the client, from another tab) saves newer data.
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Client-facing Will Preparation endpoint.
//
// The public page (/will-prep/[token]) is unauthenticated, and estate_will_prep
// has RLS, so every read AND write goes through this route with the
// service-role key — the browser never touches Supabase directly. The token +
// bcrypt password gate is the auth, same pattern as /api/statement/[token].
//
// Writes only ever touch the estate_will_prep row itself. Nothing here can
// write into the client's live Estate record — that only happens advisor-side
// via the RLS-protected Apply action, which logs the previous value to
// estate_will_prep_apply_log for a one-step revert.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Basic in-memory rate limiter (per server instance), keyed by token + IP.
const attempts = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 20
function tooManyAttempts(key: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(key) || []).filter(t => now - t < WINDOW_MS)
  recent.push(now)
  attempts.set(key, recent)
  return recent.length > MAX_ATTEMPTS
}

async function resolveFirmForClient(clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null
  const { data: client } = await supabaseAdmin.from('clients').select('advisor_id').eq('id', clientId).maybeSingle()
  if (!client?.advisor_id) return null
  const { data: advisor } = await supabaseAdmin.from('advisors').select('firm').eq('id', client.advisor_id).maybeSingle()
  return advisor?.firm || null
}

async function resolveClientName(clientId: string | null | undefined): Promise<string> {
  if (!clientId) return 'Client'
  const { data: client } = await supabaseAdmin.from('clients').select('name').eq('id', clientId).maybeSingle()
  return client?.name || 'Client'
}

function isExpired(expiresAt: string | null): boolean {
  return expiresAt ? new Date(expiresAt) < new Date() : false
}

// GET — hint + expiry + status only. No data before password verification.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { data: prep } = await supabaseAdmin
    .from('estate_will_prep')
    .select('password_hint,expires_at,status,client_id')
    .eq('token', params.token)
    .maybeSingle()
  if (!prep) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const firm = await resolveFirmForClient(prep.client_id)
  const clientName = await resolveClientName(prep.client_id)
  return NextResponse.json({
    hint: prep.password_hint || '',
    expired: isExpired(prep.expires_at),
    status: prep.status,
    clientName,
    firm,
  })
}

// POST — action-based: unlock | save | submit. Password re-verified on every
// call so there is no session state to manage or steal.
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (tooManyAttempts(`${params.token}:${ip}`)) {
    return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const action: string = body?.action
  const password: string = body?.password || ''
  if (!['unlock', 'save', 'submit'].includes(action)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const { data: prep } = await supabaseAdmin
    .from('estate_will_prep').select('*').eq('token', params.token).maybeSingle()
  if (!prep) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (isExpired(prep.expires_at)) return NextResponse.json({ error: 'expired' }, { status: 410 })

  const { ok } = await verifySharePassword(password, prep.password_hash)
  if (!ok) return NextResponse.json({ error: 'wrong_password' }, { status: 401 })

  const firm = await resolveFirmForClient(prep.client_id)
  const clientName = await resolveClientName(prep.client_id)

  if (action === 'unlock') {
    return NextResponse.json({
      status: prep.status,
      data: prep.data || {},
      submittedAt: prep.submitted_at,
      clientName,
      firm,
    })
  }

  // save / submit — both are writes; once submitted, the client can no
  // longer edit (advisor would need to reopen it, not built in this route).
  if (prep.status === 'submitted') {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 })
  }

  const data = body?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  // Hard size cap so nobody can balloon the JSONB blob through the public route.
  if (JSON.stringify(data).length > 300_000) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    data,
    updated_at: now,
  }

  if (action === 'submit') {
    update.status = 'submitted'
    update.submitted_at = now
  }

  const { error } = await supabaseAdmin
    .from('estate_will_prep').update(update).eq('id', prep.id)
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  return NextResponse.json({ ok: true, status: action === 'submit' ? 'submitted' : 'draft', savedAt: now })
}