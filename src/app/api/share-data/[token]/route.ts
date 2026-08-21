import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hashSharePassword, verifySharePassword } from '@/lib/sharePassword'

// Client-facing route — must never be cached by Vercel's fetch cache.
// Without this, a client could be served stale data after the advisor
// edits and saves new data (same bug class fixed on report-print).
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

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
      .from('family_members').select('id,name,relationship,dob,age').eq('client_id', share.client_id)

    // Canonical person-key → current display name, mirrors the dashboard's allPeople list.
    // Lets the share page resolve a policy's resolved `person` key (e.g. 'child_<id>')
    // to whatever that person's current name is, instead of trusting a frozen text snapshot.
    const personLabels: Record<string, string> = { client: client?.name || 'Client' }
    for (const m of familyRows || []) {
      if (m.relationship?.toLowerCase() === 'spouse') personLabels.spouse = m.name
      else personLabels[`child_${m.id}`] = m.name
    }

    // Canonical person-key → age, using the app-wide year-only convention
    // (currentYear - birthYear), never calendar-precise DOB math. Needed so the
    // Portfolio share view's Coverage Timeline chart can compute maturity ages
    // against the actual shared person (spouse/child), not always the client.
    const currentYear = new Date().getFullYear()
    const ageOf = (dob?: string | null, ageCol?: number | null): number | null => {
      if (dob) return currentYear - new Date(dob).getFullYear()
      if (ageCol != null) return ageCol
      return null
    }
    const personAges: Record<string, number | null> = { client: ageOf(client?.dob, client?.age) }
    for (const m of familyRows || []) {
      const a = ageOf(m.dob, m.age)
      if (m.relationship?.toLowerCase() === 'spouse') personAges.spouse = a
      else personAges[`child_${m.id}`] = a
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
    } else if (shareType === 'claims') {
      // Claims-only share link — never expose protection_portfolio policy data
      // through this side channel, even though the row was fetched above.
      policies = []
    } else {
      // Portfolio: existing person filter
      const person = share.person
      if (person === 'dependents') {
        // 'dependents' is a UI grouping label, not a literal person key —
        // individual policies are tagged with their specific child_<id> key.
        // Match any of them, not the literal string 'dependents'.
        policies = policies.filter((p: any) => typeof p.person === 'string' && p.person.startsWith('child_'))
      } else if (person && person !== 'all') {
        policies = policies.filter((p: any) => p.person === person)
      }
    }

    // Resolve the actual person this Portfolio share is for, so the recipient
    // page can header/timeline against them instead of always the client.
    // - 'client' / 'spouse': single unambiguous person → their own name + age.
    // - 'dependents': can bundle multiple children with different ages. If the
    //   filtered policies belong to exactly one child, treat as that single
    //   child. With 2+ children, there's no single age to chart against, so
    //   the label falls back to "Dependents" and age is left null — the share
    //   page skips the Coverage Timeline in that case rather than guess.
    // - 'all' / unset: whole-household view → client's own name + age.
    let sharedPersonName: string = client?.name || 'Client'
    let sharedPersonAge: number | null = personAges.client
    if (shareType !== 'payment_summary' && shareType !== 'claims') {
      const person = share.person
      if (person === 'spouse') {
        sharedPersonName = personLabels.spouse || 'Spouse'
        sharedPersonAge = personAges.spouse ?? null
      } else if (person === 'dependents') {
        const childKeys = Array.from(new Set(policies.map((p: any) => p.person).filter((k: string) => k?.startsWith('child_'))))
        if (childKeys.length === 1) {
          sharedPersonName = personLabels[childKeys[0]] || 'Dependent'
          sharedPersonAge = personAges[childKeys[0]] ?? null
        } else {
          sharedPersonName = 'Dependents'
          sharedPersonAge = null
        }
      }
    }

    // Claims share — advisor-selected claims (share.claim_ids), each broken down
    // by section (pre/in/post) with full line-item detail (status + amounts only,
    // no internal remarks/notes — those stay advisor-side).
    let claimsShareData: any[] = []
    if (shareType === 'claims') {
      const claimIds: string[] = share.claim_ids || []
      if (claimIds.length > 0) {
        const { data: claimRows } = await supabaseAdmin
          .from('claims').select('id,life_assured_person,label,opened_date')
          .eq('client_id', share.client_id)
          .in('id', claimIds)
        const { data: lineRows } = await supabaseAdmin
          .from('claim_line_items').select('id,claim_id,section,type,panel_status,date_from,invoice_no,description,amount_claimed,approved,amount_approved')
          .in('claim_id', claimIds)
          .order('date_from', { ascending: true })
        claimsShareData = (claimRows || []).map((c: any) => {
          const lines = (lineRows || []).filter((l: any) => l.claim_id === c.id)
          const sections: Record<'pre' | 'in' | 'post', any[]> = { pre: [], in: [], post: [] }
          for (const l of lines) {
            if (sections[l.section as 'pre' | 'in' | 'post']) {
              sections[l.section as 'pre' | 'in' | 'post'].push({
                id: l.id, type: l.type, panel_status: l.panel_status,
                date_from: l.date_from, invoice_no: l.invoice_no, description: l.description,
                amount_claimed: l.amount_claimed || 0, approved: l.approved, amount_approved: l.amount_approved || 0,
              })
            }
          }
          return {
            id: c.id,
            label: c.label,
            life_assured_person: c.life_assured_person,
            life_assured_label: personLabels[c.life_assured_person] || c.life_assured_person,
            opened_date: c.opened_date,
            total_claimed: lines.reduce((s: number, l: any) => s + (l.amount_claimed || 0), 0),
            total_approved: lines.reduce((s: number, l: any) => s + (l.approved ? (l.amount_approved || 0) : 0), 0),
            pending_count: lines.filter((l: any) => !l.approved).length,
            resolved_count: lines.filter((l: any) => l.approved).length,
            sections,
          }
        }).sort((a: any, b: any) => (a.opened_date < b.opened_date ? 1 : -1))
      }
    }

    // Lifetime claims history — portfolio shares only, scoped to whichever
    // policies are already visible above (so hidden/other-person policies
    // never leak claims data through this side channel).
    let claimsHistory: any[] = []
    if (shareType === 'portfolio') {
      const visiblePolicyIds = new Set(policies.map((p: any) => p.id))
      const { data: claimRows } = await supabaseAdmin
        .from('claims').select('id,policy_id,life_assured_person,label,opened_date')
        .eq('client_id', share.client_id)
      const visibleClaims = (claimRows || []).filter((c: any) => visiblePolicyIds.has(c.policy_id))
      if (visibleClaims.length > 0) {
        const { data: lineRows } = await supabaseAdmin
          .from('claim_line_items').select('claim_id,amount_claimed,approved,amount_approved')
          .in('claim_id', visibleClaims.map((c: any) => c.id))
        claimsHistory = visibleClaims.map((c: any) => {
          const lines = (lineRows || []).filter((l: any) => l.claim_id === c.id)
          return {
            id: c.id,
            label: c.label,
            opened_date: c.opened_date,
            life_assured_person: c.life_assured_person,
            policy_id: c.policy_id,
            total_claimed: lines.reduce((s: number, l: any) => s + (l.amount_claimed || 0), 0),
            total_approved: lines.reduce((s: number, l: any) => s + (l.approved ? (l.amount_approved || 0) : 0), 0),
            line_item_count: lines.length,
          }
        }).sort((a: any, b: any) => (a.opened_date < b.opened_date ? 1 : -1))
      }
    }

    return NextResponse.json({
      client,
      person: share.person,
      sharedPersonName,
      sharedPersonAge,
      policies,
      claimsHistory,
      claimsShareData,
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