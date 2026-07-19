import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifySharePassword } from '@/lib/sharePassword'

// Client-facing Financial Statement endpoint.
//
// The public statement page (/statement/[token]) is unauthenticated, and all
// tables have RLS, so every read AND write goes through this route with the
// service-role key — the browser never touches Supabase directly. The token +
// bcrypt password gate is the auth. Writes only ever touch the
// financial_statements row itself; nothing here can write into fact_finding
// (that only happens advisor-side via the RLS-protected Apply action).

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

function isExpired(expiresAt: string | null): boolean {
  return expiresAt ? new Date(expiresAt) < new Date() : false
}

// GET — hint + expiry + year only. No data before password verification.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { data: stmt } = await supabaseAdmin
    .from('financial_statements')
    .select('password_hint,expires_at,year,status,client_id')
    .eq('token', params.token)
    .maybeSingle()
  if (!stmt) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const firm = await resolveFirmForClient(stmt.client_id)
  return NextResponse.json({
    hint: stmt.password_hint || '',
    expired: isExpired(stmt.expires_at),
    year: stmt.year,
    status: stmt.status,
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

  const { data: stmt } = await supabaseAdmin
    .from('financial_statements').select('*').eq('token', params.token).maybeSingle()
  if (!stmt) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (isExpired(stmt.expires_at)) return NextResponse.json({ error: 'expired' }, { status: 410 })

  const { ok } = await verifySharePassword(password, stmt.password_hash)
  if (!ok) return NextResponse.json({ error: 'wrong_password' }, { status: 401 })

  const firm = await resolveFirmForClient(stmt.client_id)

  if (action === 'unlock') {
    return NextResponse.json({
      year: stmt.year,
      status: stmt.status,
      data: stmt.data || {},
      clientName: stmt.client_name || '',
      clientOccupation: stmt.client_occupation || '',
      submittedAt: stmt.submitted_at,
      firm,
    })
  }

  // save / submit — both are writes; a submitted statement is locked.
  if (stmt.status === 'submitted') {
    return NextResponse.json({ error: 'already_submitted' }, { status: 409 })
  }

  const name: string = (body?.name || '').trim()
  const occupation: string = (body?.occupation || '').trim()
  if (!name || !occupation) {
    return NextResponse.json({ error: 'missing_identity' }, { status: 422 })
  }
  const data = body?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  // Hard size cap so nobody can balloon the JSONB blob through the public route.
  if (JSON.stringify(data).length > 200_000) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    data,
    client_name: name,
    client_occupation: occupation,
    updated_at: now,
  }

  if (action === 'submit') {
    if (body?.ack !== true) {
      return NextResponse.json({ error: 'missing_ack' }, { status: 422 })
    }
    update.status = 'submitted'
    update.acknowledged_at = now
    update.submitted_at = now
  }

  const { error } = await supabaseAdmin
    .from('financial_statements').update(update).eq('id', stmt.id)
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  return NextResponse.json({ ok: true, status: action === 'submit' ? 'submitted' : 'draft', savedAt: now })
}
