import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

  return NextResponse.json({
    client,
    person: share.person,
    policies: row?.data?.risk_management?.policies || [],
  })
}
