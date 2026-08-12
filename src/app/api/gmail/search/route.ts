import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireUser } from '@/lib/requireUser'
import { decryptToken } from '@/lib/tokenCrypto'
import { refreshAccessToken, searchGmailMessages } from '@/lib/googleGmail'

const MAX_SEARCHES_PER_MINUTE = 15
const MAX_TERM_LENGTH = 120
const MAX_TERMS = 5

export async function POST(req: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const claimId = body?.claimId
  const serviceRequestId = body?.serviceRequestId
  const newBusinessCaseId = body?.newBusinessCaseId
  // Exactly one target — mirrors the gmail_search_log_target_check constraint.
  const targetCount = [claimId, serviceRequestId, newBusinessCaseId].filter(Boolean).length
  if (targetCount !== 1) {
    return NextResponse.json({ error: 'Exactly one of claimId, serviceRequestId, or newBusinessCaseId is required' }, { status: 400 })
  }
  const rawTerms: unknown = body?.terms
  const terms = (Array.isArray(rawTerms) ? rawTerms : [])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim().slice(0, MAX_TERM_LENGTH))
    .slice(0, MAX_TERMS)
  if (terms.length === 0) {
    return NextResponse.json({ error: 'At least one search term is required' }, { status: 400 })
  }

  // Ownership check FIRST, using the advisor's own RLS-scoped session (anon
  // client + their cookies) rather than the service-role client. This means
  // an advisor cannot use this endpoint to probe claim/service-request IDs
  // belonging to another advisor's clients — if the row isn't visible to
  // them under RLS, it isn't visible here either, and we never even reach
  // their Gmail token.
  const cookieStore = cookies()
  const scopedSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  )
  if (claimId) {
    if (typeof claimId !== 'string') return NextResponse.json({ error: 'claimId is required' }, { status: 400 })
    const { data: claim, error: claimErr } = await scopedSupabase.from('claims').select('id').eq('id', claimId).maybeSingle()
    if (claimErr || !claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
  } else if (serviceRequestId) {
    if (typeof serviceRequestId !== 'string') return NextResponse.json({ error: 'serviceRequestId is required' }, { status: 400 })
    const { data: sr, error: srErr } = await scopedSupabase.from('service_requests').select('id').eq('id', serviceRequestId).maybeSingle()
    if (srErr || !sr) return NextResponse.json({ error: 'Service request not found' }, { status: 404 })
  } else {
    if (typeof newBusinessCaseId !== 'string') return NextResponse.json({ error: 'newBusinessCaseId is required' }, { status: 400 })
    const { data: nbc, error: nbcErr } = await scopedSupabase.from('new_business_cases').select('id').eq('id', newBusinessCaseId).maybeSingle()
    if (nbcErr || !nbc) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Rate limit: cap searches per advisor per rolling minute. Protects the
  // advisor's own Gmail quota and limits the blast radius if a session were
  // ever hijacked (bounds how much mail metadata could be pulled per minute).
  // Shared across claim and service-request searches — one advisor-level cap.
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
  const { count } = await supabase
    .from('gmail_search_log')
    .select('id', { count: 'exact', head: true })
    .eq('advisor_id', user.id)
    .gte('searched_at', oneMinuteAgo)
  if ((count || 0) >= MAX_SEARCHES_PER_MINUTE) {
    return NextResponse.json({ error: 'Too many searches — please wait a moment and try again.' }, { status: 429 })
  }

  const { data: conn } = await supabase
    .from('gmail_connections')
    .select('encrypted_refresh_token')
    .eq('advisor_id', user.id)
    .maybeSingle()
  if (!conn) {
    return NextResponse.json({ error: 'not_connected' }, { status: 409 })
  }

  let accessToken: string
  try {
    const refreshToken = decryptToken(conn.encrypted_refresh_token)
    const refreshed = await refreshAccessToken(refreshToken)
    accessToken = refreshed.access_token
  } catch (e: any) {
    console.error('[gmail/search] token refresh failed', e?.message || e)
    // Refresh almost always fails because the token was revoked or expired on
    // Google's side. Clear the stale connection so the advisor sees an
    // accurate "not connected" state and a clean reconnect path, instead of
    // this endpoint failing silently forever.
    await supabase.from('gmail_connections').delete().eq('advisor_id', user.id)
    return NextResponse.json({ error: 'reconnect_required' }, { status: 409 })
  }

  const query = terms.map(t => `"${t.replace(/"/g, '')}"`).join(' OR ')

  let matches
  try {
    matches = await searchGmailMessages(accessToken, query)
  } catch (e: any) {
    console.error('[gmail/search] Gmail API search failed', e?.message || e)
    return NextResponse.json({ error: 'Gmail search failed' }, { status: 502 })
  }

  // Audit log — who searched, which claim/service request/case, which
  // terms, how many results. Never logs a subject line, sender, or any
  // message content. Exactly one of claim_id/service_request_id/
  // new_business_case_id is set, matching gmail_search_log_target_check.
  await supabase.from('gmail_search_log').insert({
    advisor_id: user.id,
    claim_id: claimId || null,
    service_request_id: serviceRequestId || null,
    new_business_case_id: newBusinessCaseId || null,
    query_terms: terms.join(', '),
    result_count: matches.length,
  })

  return NextResponse.json({ matches })
}