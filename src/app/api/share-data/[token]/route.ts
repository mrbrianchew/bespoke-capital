import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashSharePassword, verifySharePassword } from '@/lib/sharePassword'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Basic in-memory rate limiter (per server instance), keyed by token + IP.
// Blocks rapid password-guessing against a share link.
const attempts = new Map<string, number[]>()
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10
function tooManyAttempts(key: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(key) || []).filter(t => now - t < WINDOW_MS)
  recent.push(now)
  attempts.set(key, recent)
  return recent.length > MAX_ATTEMPTS
}

// GET — returns only hint + expiry status (no auth required, no sensitive data)
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { data: share } = await supabaseAdmin
    .from('client_shares').select('password_hint,expires_at').eq('token', params.token).maybeSingle()
  if (share) {
    const expired = share.expires_at ? new Date(share.expires_at) < new Date() : false
    return NextResponse.json({ hint: share.password_hint || '', expired })
  }

  // Not a client_shares token — check financial_plans
  const { data: plan } = await supabaseAdmin
    .from('financial_plans').select('password_hint,status').eq('share_token', params.token).maybeSingle()
  if (plan) {
    if (plan.status === 'archived') return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ hint: plan.password_hint || '', expired: false })
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

// POST — verifies password, returns client + policies (+ share type metadata)
//        or, for financial plans, the frozen snapshot directly
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (tooManyAttempts(`${params.token}:${ip}`)) {
    return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })
  }

  const { password } = await req.json()

  const { data: share } = await supabaseAdmin
    .from('client_shares').select('*').eq('token', params.token).maybeSingle()

  if (share) {
    if (share.expires_at && new Date(share.expires_at) < new Date())
      return NextResponse.json({ error: 'expired' }, { status: 410 })
    const { ok, legacy } = await verifySharePassword(password, share.password_hash)
    if (!ok) return NextResponse.json({ error: 'wrong_password' }, { status: 401 })
    if (legacy) {
      // Now that we have the plaintext, upgrade this row to a bcrypt hash
      // so future verifications no longer rely on the weaker legacy format.
      const upgraded = await hashSharePassword(password)
      await supabaseAdmin.from('client_shares').update({ password_hash: upgraded }).eq('token', params.token)
    }

    const { data: client } = await supabaseAdmin
      .from('clients').select('name,age,dob').eq('id', share.client_id).maybeSingle()

    const { data: row } = await supabaseAdmin
      .from('fact_finding').select('data')
      .eq('client_id', share.client_id)
      .eq('section', 'protection_portfolio')
      .maybeSingle()

    const { data: familyRows } = await supabaseAdmin
      .from('family_members').select('id,name,relationship').eq('client_id', share.client_id)

    // Canonical person-key → current display name, mirrors the dashboard's allPeople list.
    // Lets the share page resolve a policy's resolved `person` key (e.g. 'child_<id>')
    // to whatever that person's current name is, instead of trusting a frozen text snapshot.
    const personLabels: Record<string, string> = { client: client?.name || 'Client' }
    for (const m of familyRows || []) {
      if (m.relationship?.toLowerCase() === 'spouse') personLabels.spouse = m.name
      else personLabels[`child_${m.id}`] = m.name
    }

    const allPolicies: any[] = row?.data?.risk_management?.policies || []
    const statusOverrides: Record<string, string> = row?.data?.risk_management?.statusOverrides || {}
    const shareType: string = share.share_type || 'portfolio'
    const includedPersons: string[] | null = share.included_persons || null
    const hiddenPolicyIds: string[] = share.hidden_policy_ids || []

    let policies = allPolicies

    if (shareType === 'payment_summary') {
      // Filter by included persons (resolved person key, falling back to the frozen
      // life-assured text only for legacy policies that predate the person key)
      if (includedPersons && includedPersons.length > 0) {
        policies = policies.filter((p: any) =>
          includedPersons.includes(p.person || p.lifeAssured || '—')
        )
      }
      // Filter out hidden policy ids
      if (hiddenPolicyIds.length > 0) {
        policies = policies.filter((p: any) => !hiddenPolicyIds.includes(p.id))
      }
    } else {
      // Portfolio: existing person filter
      const person = share.person
      if (person && person !== 'all') {
        policies = policies.filter((p: any) => p.person === person)
      }
    }

    return NextResponse.json({
      client,
      person: share.person,
      policies,
      shareType,
      includedPersons,
      personLabels,
      statusOverrides: shareType === 'payment_summary' ? statusOverrides : undefined,
    })
  }

  // Not a client_shares token — check financial_plans
  const { data: plan } = await supabaseAdmin
    .from('financial_plans').select('*').eq('share_token', params.token).maybeSingle()

  if (!plan) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (plan.status === 'archived') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { ok, legacy } = await verifySharePassword(password, plan.password_hash)
  if (!ok) return NextResponse.json({ error: 'wrong_password' }, { status: 401 })
  if (legacy) {
    const upgraded = await hashSharePassword(password)
    await supabaseAdmin.from('financial_plans').update({ password_hash: upgraded }).eq('share_token', params.token)
  }

  return NextResponse.json({
    shareType: 'financial_plan',
    label: plan.label,
    snapshot: plan.snapshot_data,
  })
}
