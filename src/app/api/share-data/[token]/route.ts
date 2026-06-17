import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET — returns only hint + expiry status (no auth required, no sensitive data)
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { data: share } = await supabaseAdmin
    .from('client_shares').select('password_hint,expires_at').eq('token', params.token).maybeSingle()
  if (!share) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const expired = share.expires_at ? new Date(share.expires_at) < new Date() : false
  return NextResponse.json({ hint: share.password_hint || '', expired })
}

// POST — verifies password, returns client + policies (+ share type metadata)
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const { passwordHash } = await req.json()

  const { data: share } = await supabaseAdmin
    .from('client_shares').select('*').eq('token', params.token).maybeSingle()
  if (!share) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (share.expires_at && new Date(share.expires_at) < new Date())
    return NextResponse.json({ error: 'expired' }, { status: 410 })
  if (passwordHash !== share.password_hash)
    return NextResponse.json({ error: 'wrong_password' }, { status: 401 })

  const { data: client } = await supabaseAdmin
    .from('clients').select('name,age,dob').eq('id', share.client_id).maybeSingle()

  const { data: row } = await supabaseAdmin
    .from('fact_finding').select('data')
    .eq('client_id', share.client_id)
    .eq('section', 'protection_portfolio')
    .maybeSingle()

  const allPolicies: any[] = row?.data?.risk_management?.policies || []
  const shareType: string = share.share_type || 'portfolio'
  const includedPersons: string[] | null = share.included_persons || null

  // For payment_summary, filter to included life assureds
  let policies = allPolicies
  if (shareType === 'payment_summary' && includedPersons && includedPersons.length > 0) {
    policies = allPolicies.filter((p: any) =>
      includedPersons.includes(p.lifeAssured || p.person || '—')
    )
  } else if (shareType === 'portfolio') {
    // Existing behaviour: filter by person
    const person = share.person
    if (person && person !== 'all') {
      policies = allPolicies.filter((p: any) => p.person === person)
    }
  }

  return NextResponse.json({
    client,
    person: share.person,
    policies,
    shareType,
    includedPersons,
  })
}
