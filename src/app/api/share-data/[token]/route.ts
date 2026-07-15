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
    .from('client_shares').select('password_hint,expires_at,client_id').eq('token', params.token).maybeSingle()
  if (share) {
    const expired = share.expires_at ? new Date(share.expires_at) < new Date() : false
    const firm = await resolveFirmForClient(share.client_id)
    return NextResponse.json({ hint: share.password_hint || '', expired, firm })
  }

  // Not a client_shares token — check financial_plans
  const { data: plan } = await supabaseAdmin
    .from('financial_plans').select('password_hint,status,created_by').eq('share_token', params.token).maybeSingle()
  if (plan) {
    if (plan.status === 'archived') return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const firm = await resolveFirmForAdvisor(plan.created_by)
    return NextResponse.json({ hint: plan.password_hint || '', expired: false, firm })
  }

  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

// Resolves an advisor's firm name via a client's advisor_id. Never throws —
// falls back to null so the frontend can apply its own default branding.
async function resolveFirmForClient(clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null
  const { data: client } = await supabaseAdmin.from('clients').select('advisor_id').eq('id', clientId).maybeSingle()
  return resolveFirmForAdvisor(client?.advisor_id)
}
async function resolveFirmForAdvisor(advisorId: string | null | undefined): Promise<string | null> {
  if (!advisorId) return null
  const { data: advisor } = await supabaseAdmin.from('advisors').select('firm').eq('id', advisorId).maybeSingle()
  return advisor?.firm || null
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
      .from('clients').select('name,age,dob,advisor_id').eq('id', share.client_id).maybeSingle()

    const { data: advisor } = client?.advisor_id
      ? await supabaseAdmin.from('advisors').select('name,firm').eq('id', client.advisor_id).maybeSingle()
      : { data: null }

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
      advisorName: advisor?.name || null,
      firmName: advisor?.firm || null,
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

  const { data: planAdvisor } = plan.created_by
    ? await supabaseAdmin.from('advisors').select('name,firm').eq('id', plan.created_by).maybeSingle()
    : { data: null }

  return NextResponse.json({
    shareType: 'financial_plan',
    label: plan.label,
    snapshot: plan.snapshot_data,
    advisorName: planAdvisor?.name || null,
    firmName: planAdvisor?.firm || null,
  })
}
