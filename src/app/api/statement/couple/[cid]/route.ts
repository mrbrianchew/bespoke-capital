import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifySharePassword } from '@/lib/sharePassword'

// Couple link endpoint (/statement/couple/[cid]).
//
// One link + one password for a client and their spouse. This route only does the
// front door: it shows the hint, checks the password once, and hands back each
// person's own statement token. Every save, submit and read of the figures still goes
// through /api/statement/[token], exactly as for a single-person link, so each person
// keeps their own draft, their own Submit and their own lock. Nothing here writes.
//
// Tokens are only returned after the password is verified against that person's own
// stored hash, so a wrong or outdated password never reveals them.

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isExpired = (expiresAt: string | null) => (expiresAt ? new Date(expiresAt) < new Date() : false)

async function firmFor(clientId: string): Promise<string | null> {
  const { data: client } = await supabaseAdmin.from('clients').select('advisor_id').eq('id', clientId).maybeSingle()
  if (!client?.advisor_id) return null
  const { data: advisor } = await supabaseAdmin.from('advisors').select('firm').eq('id', client.advisor_id).maybeSingle()
  return advisor?.firm || null
}

async function nameFor(clientId: string, person: string): Promise<string> {
  if (person === 'spouse') {
    const { data: fam } = await supabaseAdmin.from('family_members').select('name').eq('client_id', clientId).eq('relationship', 'Spouse').maybeSingle()
    return fam?.name || 'Spouse'
  }
  const { data: client } = await supabaseAdmin.from('clients').select('name').eq('id', clientId).maybeSingle()
  return client?.name || 'Client'
}

async function loadRows(cid: string) {
  if (!UUID_RE.test(cid)) return []
  const { data } = await supabaseAdmin
    .from('financial_statements')
    .select('id,client_id,year,person,token,password_hash,password_hint,expires_at,status')
    .eq('couple_id', cid)
  return (data || []) as {
    id: string; client_id: string; year: number; person: 'client' | 'spouse'; token: string
    password_hash: string; password_hint: string | null; expires_at: string | null; status: string
  }[]
}

// GET: hint, year, expiry and the names only. No tokens, no figures.
export async function GET(_req: Request, { params }: { params: { cid: string } }) {
  const rows = await loadRows(params.cid)
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const first = rows.find(r => r.person === 'client') || rows[0]
  const [firm, people] = await Promise.all([
    firmFor(first.client_id),
    Promise.all(rows.map(async r => ({ person: r.person, name: await nameFor(r.client_id, r.person) }))),
  ])
  return NextResponse.json({
    firm,
    year: first.year,
    hint: first.password_hint || '',
    // Expired only when every person's link has expired; one expired person is shown on their own tab.
    expired: rows.every(r => isExpired(r.expires_at)),
    people: people.sort((a, b) => (a.person === 'client' ? -1 : 1)),
  })
}

// POST { password }: verify once, return each person's token.
export async function POST(req: Request, { params }: { params: { cid: string } }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (tooManyAttempts(`${params.cid}:${ip}`)) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const password: string = typeof body?.password === 'string' ? body.password : ''
  if (!password) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const rows = await loadRows(params.cid)
  if (rows.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (rows.every(r => isExpired(r.expires_at))) return NextResponse.json({ error: 'expired' }, { status: 410 })

  const checks = await Promise.all(rows.map(async r => ({ r, ok: (await verifySharePassword(password, r.password_hash)).ok })))
  if (!checks.some(c => c.ok)) return NextResponse.json({ error: 'wrong_password' }, { status: 401 })

  const firm = await firmFor(rows[0].client_id)
  const people = await Promise.all(checks.map(async ({ r, ok }) => ({
    person: r.person,
    name: await nameFor(r.client_id, r.person),
    status: r.status,
    expired: isExpired(r.expires_at),
    // Only hand out the token where this password really opens that person's statement.
    token: ok && !isExpired(r.expires_at) ? r.token : null,
  })))
  return NextResponse.json({ firm, year: rows[0].year, people: people.sort((a, b) => (a.person === 'client' ? -1 : 1)) })
}