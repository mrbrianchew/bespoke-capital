import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { requireCreator } from '@/lib/requireCreator'

// Whitelist of togglable feature keys. Keeps this endpoint from becoming an
// arbitrary jsonb-array editor — add a new key here when a new feature is
// built behind a flag (see NAV_GROUPS_ALL in dashboard/layout.tsx for the
// first one, 'servicing').
const VALID_FEATURES = ['servicing']

export async function POST(req: Request) {
  // Only the creator may grant/revoke beta feature access. This is the
  // per-advisor rollout switch for in-progress features (e.g. the Client
  // Servicing nav group) — advisors without a flag never see the feature at
  // all, regardless of their account status.
  const creator = await requireCreator()
  if (!creator) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, feature, enabled } = await req.json()
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }
  if (!feature || typeof feature !== 'string' || !VALID_FEATURES.includes(feature)) {
    return NextResponse.json({ error: 'Invalid feature' }, { status: 400 })
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Invalid enabled flag' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: row, error: fetchErr } = await supabase
    .from('advisors').select('beta_features').eq('id', id).maybeSingle()
  if (fetchErr || !row) return NextResponse.json({ error: 'Advisor not found' }, { status: 404 })

  const current: string[] = Array.isArray(row.beta_features) ? row.beta_features : []
  const next = enabled
    ? Array.from(new Set([...current, feature])) // tsconfig targets ES5 — no Set spread
    : current.filter(f => f !== feature)

  const { error: updateErr } = await supabase
    .from('advisors').update({ beta_features: next }).eq('id', id)
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  return NextResponse.json({ success: true, beta_features: next })
}