'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Firm-wide Kanban over claim_line_items. This is a VIEW, not a second data
// model — every card here is a real claim_line_items row, and clicking one
// navigates into the per-client Medical Claims page (src/app/dashboard/
// servicing/claims/page.tsx) where it's actually edited. No duplicate entry.
//
// Card granularity is the LINE ITEM, not the claim (confirmed Aug 2026) — a
// claim with mixed-status line items (e.g. one Approved, one still Submitted)
// shows up as two separate cards in two different columns. A claim never
// gets falsely marked "done" just because one of its lines resolved first.

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface PolicyLite {
  id: string
  categoryCode: string
  companyName: string
  productName: string
}

interface ClaimRow {
  id: string
  client_id: string
  policy_id: string
  life_assured_person: string
  label: string | null
  opened_date: string
}

interface LineItemRow {
  id: string
  claim_id: string
  type: string | null
  description: string | null
  invoice_no: string | null
  amount_claimed: number
  amount_approved: number
  approved: boolean
  rejected: boolean
  rejection_reason: string | null
  followup_status: string | null
  submitted_date: string | null
  date_from: string | null
  updated_at: string
}

interface FamilyMember {
  id: string
  client_id: string
  name: string | null
  relationship: string
}

type ColumnId = 'docs' | 'submitted' | 'assessment' | 'resolved'

const COLUMNS: { id: ColumnId; title: string; hint: string }[] = [
  { id: 'docs', title: 'Documents Collection', hint: 'Pending Documents' },
  { id: 'submitted', title: 'Submitted to Insurer', hint: 'Submitted' },
  { id: 'assessment', title: 'Insurer Assessment', hint: 'Insurer Assessment' },
  { id: 'resolved', title: 'Approved / Rejected', hint: 'Last 30 days' },
]

const RESOLVED_VISIBLE_DAYS = 30
const STALE_DAYS = 14 // matches the per-client Medical Claims page's idle threshold

// ─── HELPERS ────────────────────────────────────────────────────────────────

function money(n: number | null | undefined) {
  return '$' + (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function columnFor(item: LineItemRow): ColumnId | null {
  if (item.approved || item.rejected) {
    const daysAgo = daysSince(item.updated_at)
    return daysAgo !== null && daysAgo <= RESOLVED_VISIBLE_DAYS ? 'resolved' : null // drops off the board
  }
  if (item.followup_status === 'Pending Documents') return 'docs'
  if (item.followup_status === 'Insurer Assessment') return 'assessment'
  return 'submitted' // 'Submitted' and any unrecognized/null value
}

interface CardData {
  item: LineItemRow
  claim: ClaimRow
  clientId: string
  clientName: string
  lifeAssuredLabel: string
  policyLabel: string
}

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(42,94,70,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)',
}

export default function BusinessClaimsBoardPage() {
  const { advisor, clients, authLoading, setActiveClient } = useDashboard()
  const router = useRouter()
  const supabase = createClient()

  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const [loading, setLoading] = useState(true)
  const [claims, setClaims] = useState<ClaimRow[]>([])
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([])
  const [policiesByClient, setPoliciesByClient] = useState<Record<string, PolicyLite[]>>({})

  // Route/feature guard — mirrors the per-client Medical Claims page's rule
  // so direct URL access without both flags doesn't work either.
  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  // Firm-wide load. RLS on claims/claim_line_items scopes through
  // clients.advisor_id, so a plain select (no client_id filter) already
  // returns only this advisor's rows — same trust boundary as every other
  // dashboard page, no service-role route needed here.
  useEffect(() => {
    if (authLoading || !hasAccess) { setLoading(false); return }
    let cancelled = false
    async function load() {
      setLoading(true)
      const [claimsRes, familyRes] = await Promise.all([
        supabase.from('claims').select('id, client_id, policy_id, life_assured_person, label, opened_date'),
        supabase.from('family_members').select('id, client_id, name, relationship'),
      ])
      if (cancelled) return
      const claimRows = (claimsRes.data || []) as ClaimRow[]
      setClaims(claimRows)
      setFamilyMembers(familyRes.data || [])

      const claimIds = claimRows.map(c => c.id)
      if (claimIds.length > 0) {
        const itemsRes = await supabase.from('claim_line_items')
          .select('id, claim_id, type, description, invoice_no, amount_claimed, amount_approved, approved, rejected, rejection_reason, followup_status, submitted_date, date_from, updated_at')
          .in('claim_id', claimIds)
        if (cancelled) return
        setLineItems((itemsRes.data || []) as LineItemRow[])
      } else {
        setLineItems([])
      }

      const clientIds = Array.from(new Set(claimRows.map(c => c.client_id))) // ES5 target — no Set spread
      if (clientIds.length > 0) {
        const ffRes = await supabase.from('fact_finding').select('client_id, data').eq('section', 'protection_portfolio').in('client_id', clientIds)
        if (cancelled) return
        const map: Record<string, PolicyLite[]> = {}
        ;(ffRes.data || []).forEach((row: any) => {
          const allPolicies: PolicyLite[] = row.data?.risk_management?.policies || []
          map[row.client_id] = allPolicies.filter(p => p.categoryCode === 'medical')
        })
        setPoliciesByClient(map)
      } else {
        setPoliciesByClient({})
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, hasAccess])

  const clientsById = useMemo(() => {
    const map: Record<string, string> = {}
    clients.forEach(c => { map[c.id] = c.name })
    return map
  }, [clients])

  const familyByClient = useMemo(() => {
    const map: Record<string, FamilyMember[]> = {}
    familyMembers.forEach(m => { (map[m.client_id] ||= []).push(m) })
    return map
  }, [familyMembers])

  function lifeAssuredLabel(clientId: string, personKey: string): string {
    if (personKey === 'client') return clientsById[clientId] || 'Client'
    const family = familyByClient[clientId] || []
    if (personKey === 'spouse') return family.find(m => m.relationship === 'Spouse')?.name || 'Spouse'
    if (personKey.startsWith('child_')) {
      const childId = personKey.slice('child_'.length)
      return family.find(m => m.id === childId)?.name || 'Child'
    }
    return personKey
  }

  function policyLabel(clientId: string, policyId: string): string {
    const p = (policiesByClient[clientId] || []).find(pp => pp.id === policyId)
    return p?.productName || p?.companyName || '—'
  }

  const claimsById = useMemo(() => {
    const map: Record<string, ClaimRow> = {}
    claims.forEach(c => { map[c.id] = c })
    return map
  }, [claims])

  const columns = useMemo(() => {
    const buckets: Record<ColumnId, CardData[]> = { docs: [], submitted: [], assessment: [], resolved: [] }
    lineItems.forEach(item => {
      const col = columnFor(item)
      if (!col) return
      const claim = claimsById[item.claim_id]
      if (!claim) return
      buckets[col].push({
        item, claim,
        clientId: claim.client_id,
        clientName: clientsById[claim.client_id] || 'Unknown client',
        lifeAssuredLabel: lifeAssuredLabel(claim.client_id, claim.life_assured_person),
        policyLabel: policyLabel(claim.client_id, claim.policy_id),
      })
    })
    ;(Object.keys(buckets) as ColumnId[]).forEach(col => {
      buckets[col].sort((a, b) => {
        if (col === 'resolved') return new Date(b.item.updated_at).getTime() - new Date(a.item.updated_at).getTime()
        const da = daysSince(a.item.submitted_date || a.item.date_from) ?? -1
        const db = daysSince(b.item.submitted_date || b.item.date_from) ?? -1
        return db - da // most idle first
      })
    })
    return buckets
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems, claimsById, clientsById, familyByClient, policiesByClient])

  function openCard(card: CardData) {
    const client = clients.find(c => c.id === card.clientId)
    if (client) {
      setActiveClient(client)
      localStorage.setItem('selectedClientId', client.id)
    }
    router.push(`/dashboard/servicing/claims?claimId=${card.claim.id}`)
  }

  if (!hasAccess) return null

  const totalInProgress = columns.docs.length + columns.submitted.length + columns.assessment.length

  return (
    <div style={{ padding: 24, background: 'var(--cream)', minHeight: '100%', borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.gold, fontWeight: 700 }}>Business Dashboard</div>
        <div className="font-serif" style={{ fontSize: 26, marginTop: 5, color: T.text }}>Claims Board</div>
        <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 4 }}>
          {loading ? 'Loading…' : `${totalInProgress} claim line item${totalInProgress === 1 ? '' : 's'} in progress across all clients`}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>Loading claims…</div>
      ) : (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
          {COLUMNS.map(col => (
            <div key={col.id} style={{ flex: '0 0 280px', minWidth: 280 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '2px 4px 10px' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{col.title}</div>
                  <div style={{ fontSize: 10.5, color: T.textFaint }}>{col.hint}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, background: 'var(--cream2)', padding: '2px 8px', borderRadius: 999 }}>
                  {columns[col.id].length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60 }}>
                {columns[col.id].length === 0 && (
                  <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic', padding: '10px 4px' }}>Nothing here</div>
                )}
                {columns[col.id].map(card => (
                  <ClaimCard key={card.item.id} card={card} onClick={() => openCard(card)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ClaimCard({ card, onClick }: { card: CardData; onClick: () => void }) {
  const { item } = card
  const resolved = item.approved || item.rejected
  const days = daysSince(item.submitted_date || item.date_from)
  const stale = !resolved && days !== null && days >= STALE_DAYS

  return (
    <button onClick={onClick} style={{
      textAlign: 'left', width: '100%', cursor: 'pointer',
      background: 'white', border: `1px solid ${T.line}`, borderRadius: 12, padding: 12,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{card.clientName}</div>
      <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1 }}>{card.lifeAssuredLabel} · {card.policyLabel}</div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.goldText, background: T.goldSoft, padding: '2px 7px', borderRadius: 5 }}>
          {item.type || '—'}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: T.text }}>{item.description || '(no description)'}</span>
      </div>

      <div className="font-mono" style={{ fontSize: 10.5, color: T.textFaint, marginTop: 6 }}>
        {item.invoice_no || '—'} · {money(item.amount_claimed)}
      </div>

      <div style={{ marginTop: 8 }}>
        {resolved ? (
          item.rejected ? (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: T.rose }}>
              Rejected{item.rejection_reason ? ` — ${item.rejection_reason}` : ''}
            </span>
          ) : (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: T.emerald }}>Approved {money(item.amount_approved)}</span>
          )
        ) : (
          days !== null && (
            <span style={{ fontSize: 10.5, fontWeight: stale ? 700 : 400, color: stale ? T.rose : T.textFaint }}>
              {days}d idle
            </span>
          )
        )}
      </div>
    </button>
  )
}