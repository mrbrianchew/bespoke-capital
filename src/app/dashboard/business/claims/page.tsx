'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard, ClientRow } from '@/contexts/DashboardContext'

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
  policyTypeCode: string
  companyName: string
  productName: string
  person: string
}

interface ClaimRow {
  id: string
  client_id: string
  policy_id: string
  life_assured_person: string
  label: string | null
  status: 'open' | 'closed' | 'withdrawn'
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

// Drop zones are one level more specific than display columns — column 4
// splits into two zones (a drop needs to say which outcome, not just "done").
// This is also exactly the set of states a card can be dragged INTO; dragging
// out of resolved-approved/-rejected into any of the first three zones is how
// a card gets un-resolved.
type DropZone = 'docs' | 'submitted' | 'assessment' | 'resolved-approved' | 'resolved-rejected'

function effectiveZone(item: LineItemRow): DropZone {
  if (item.approved) return 'resolved-approved'
  if (item.rejected) return 'resolved-rejected'
  if (item.followup_status === 'Pending Documents') return 'docs'
  if (item.followup_status === 'Insurer Assessment') return 'assessment'
  return 'submitted'
}

// What a drop into each zone writes. Moving into docs/submitted/assessment
// always clears approved/rejected (that's the un-resolve path); amount_approved
// and rejection_reason are deliberately left untouched either way — they're
// edited on the per-client page, and clearing them on drag would lose data
// for no reason (same "deprecated columns stay in place" instinct as the rest
// of this codebase).
function patchFor(zone: DropZone): Partial<LineItemRow> {
  switch (zone) {
    case 'docs': return { followup_status: 'Pending Documents', approved: false, rejected: false }
    case 'submitted': return { followup_status: 'Submitted', approved: false, rejected: false }
    case 'assessment': return { followup_status: 'Insurer Assessment', approved: false, rejected: false }
    case 'resolved-approved': return { approved: true, rejected: false }
    case 'resolved-rejected': return { approved: false, rejected: true }
  }
}

const RESOLVED_VISIBLE_DAYS = 30
const STALE_DAYS = 14 // matches the per-client Medical Claims page's idle threshold

// Matches SECTION_LABEL on the per-client Medical Claims page exactly.
const SECTION_LABEL: Record<'pre' | 'in' | 'post', string> = {
  pre: 'Pre-Hospitalisation', in: 'Inpatient / Surgery', post: 'Post-Hospitalisation',
}

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

  // ── Drag-and-drop state ──
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverZone, setDragOverZone] = useState<DropZone | null>(null)
  // Set right after a drop lands on resolved-rejected with no existing reason —
  // captures it without blocking the drag itself. 'Skip' just closes it.
  const [rejectionPromptItemId, setRejectionPromptItemId] = useState<string | null>(null)
  const [rejectionDraft, setRejectionDraft] = useState('')

  // ── Add Claim modal state ──
  const [showAddClaim, setShowAddClaim] = useState(false)
  const [addClaimSearch, setAddClaimSearch] = useState('')
  const [addClaimSaving, setAddClaimSaving] = useState(false)
  const [addClaimError, setAddClaimError] = useState('')
  const [addClaimClient, setAddClaimClient] = useState<ClientRow | null>(null) // step 2: which client, waiting on section pick

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
        supabase.from('claims').select('id, client_id, policy_id, life_assured_person, label, status, opened_date'),
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

  // Same pattern as saveLineItem on the per-client Medical Claims page:
  // optimistic local update first, then the write, alert() on failure. No
  // rollback attempted on error — matches the existing page's behavior
  // (advisor sees the alert and can retry by dragging again).
  async function moveItem(id: string, zone: DropZone) {
    const patch = { ...patchFor(zone), updated_at: new Date().toISOString() }
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
    const { error } = await supabase.from('claim_line_items').update(patch).eq('id', id)
    if (error) alert('Move failed: ' + error.message)
  }

  function handleDrop(zone: DropZone) {
    setDragOverZone(null)
    const id = draggingId
    setDraggingId(null)
    if (!id) return
    const item = lineItems.find(i => i.id === id)
    if (!item || effectiveZone(item) === zone) return // no-op: dropped back where it started
    if (zone === 'resolved-rejected' && !item.rejection_reason) {
      setRejectionDraft('')
      setRejectionPromptItemId(id)
    }
    moveItem(id, zone)
  }

  // Item is already in resolved-rejected by the time this fires (moveItem ran
  // on drop) — this only ever patches rejection_reason, nothing else.
  async function saveRejectionReason(id: string, reason: string) {
    const trimmed = reason.trim() || null
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, rejection_reason: trimmed } : i))
    const { error } = await supabase.from('claim_line_items').update({ rejection_reason: trimmed }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  // Reuses the client's most recent existing claim if one exists (life_assured
  // = client themself — the same default the old flow used) rather than
  // creating a new claim container every time. Only inserts a new claims row
  // when this client genuinely has none yet. Either way, the actual line item
  // is added on the per-client page (via addSection) — not duplicated here.
  async function addLineItemForClient(client: ClientRow, section: 'pre' | 'in' | 'post') {
    setAddClaimSaving(true)
    setAddClaimError('')

    // Only reuse a claim that's actually still OPEN — a closed claim is a
    // finished event (per Brian: "one claim should end, then another opens").
    // If more than one happens to be open at once (shouldn't normally happen
    // if claims get closed promptly), most-recent is a reasonable fallback
    // rather than blocking on a picker for what should be a rare edge case.
    const existing = claims
      .filter(c => c.client_id === client.id && c.life_assured_person === 'client' && c.status === 'open')
      .sort((a, b) => new Date(b.opened_date).getTime() - new Date(a.opened_date).getTime())[0]

    let claimId = existing?.id
    if (!claimId) {
      const clientPolicies = (policiesByClient[client.id] || []).filter(p => p.person === 'client')
      const firstMain = clientPolicies.find(p => p.policyTypeCode?.toLowerCase() === 'main') || clientPolicies[0]
      if (!firstMain) {
        setAddClaimSaving(false)
        setAddClaimError(`${client.name} has no medical policy on file yet — add one on the Protection page first.`)
        return
      }
      const { data, error } = await supabase.from('claims').insert({
        client_id: client.id, policy_id: firstMain.id, life_assured_person: 'client',
        label: 'New Claim', status: 'open', opened_date: new Date().toISOString().slice(0, 10),
      }).select().maybeSingle()
      if (error || !data) {
        setAddClaimSaving(false)
        setAddClaimError('Could not create claim: ' + (error?.message || 'unknown error'))
        return
      }
      claimId = (data as { id: string }).id
    }

    setAddClaimSaving(false)
    setActiveClient(client)
    localStorage.setItem('selectedClientId', client.id)
    router.push(`/dashboard/servicing/claims?claimId=${claimId}&addSection=${section}`)
  }

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
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.gold, fontWeight: 700 }}>Business Dashboard</div>
          <div className="font-serif" style={{ fontSize: 26, marginTop: 5, color: T.text }}>Claims Board</div>
          <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 4 }}>
            {loading ? 'Loading…' : `${totalInProgress} claim line item${totalInProgress === 1 ? '' : 's'} in progress across all clients`}
          </div>
        </div>
        <button onClick={() => { setShowAddClaim(true); setAddClaimSearch(''); setAddClaimError(''); setAddClaimClient(null) }}
          style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 700, color: 'white', background: 'var(--charcoal)', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}>
          + Add Claim
        </button>
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

              {col.id === 'resolved' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <DropZoneList zone="resolved-approved" label="Approved" color={T.emerald}
                    cards={columns.resolved.filter(c => c.item.approved)}
                    dragOverZone={dragOverZone} setDragOverZone={setDragOverZone} onDrop={handleDrop}
                    draggingId={draggingId} setDraggingId={setDraggingId} onCardClick={openCard} />
                  <DropZoneList zone="resolved-rejected" label="Rejected" color={T.rose}
                    cards={columns.resolved.filter(c => c.item.rejected)}
                    dragOverZone={dragOverZone} setDragOverZone={setDragOverZone} onDrop={handleDrop}
                    draggingId={draggingId} setDraggingId={setDraggingId} onCardClick={openCard} />
                </div>
              ) : (
                <DropZoneList zone={col.id as DropZone} cards={columns[col.id]}
                  dragOverZone={dragOverZone} setDragOverZone={setDragOverZone} onDrop={handleDrop}
                  draggingId={draggingId} setDraggingId={setDraggingId} onCardClick={openCard} />
              )}
            </div>
          ))}
        </div>
      )}

      {rejectionPromptItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
          <div style={{ width: '100%', maxWidth: 420, background: 'white', borderRadius: 12 }}>
            <div style={{ padding: '20px 20px 4px' }}>
              <div className="font-serif" style={{ fontSize: 19, color: T.text }}>Rejection Reason</div>
              <div style={{ fontSize: 12, color: T.textFaint, marginTop: 4 }}>Optional — can also be added later on the client's Medical Claims page.</div>
            </div>
            <div style={{ padding: 20 }}>
              <input value={rejectionDraft} onChange={e => setRejectionDraft(e.target.value)} autoFocus
                placeholder="e.g. Pre-existing condition exclusion"
                style={{ width: '100%', padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 10, background: 'var(--cream)', color: T.text, fontSize: 13 }} />
            </div>
            <div style={{ padding: '0 20px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setRejectionPromptItemId(null)}
                style={{ padding: '8px 16px', fontSize: 13, color: T.textDim, border: `1px solid ${T.line}`, borderRadius: 8, background: 'none', cursor: 'pointer' }}>
                Skip
              </button>
              <button onClick={() => { saveRejectionReason(rejectionPromptItemId, rejectionDraft); setRejectionPromptItemId(null) }}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: 'white', borderRadius: 8, background: 'var(--charcoal)', border: 'none', cursor: 'pointer' }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}
          onClick={() => { if (!addClaimSaving) { setShowAddClaim(false); setAddClaimClient(null) } }}>
          <div style={{ width: '100%', maxWidth: 420, background: 'white', borderRadius: 12 }} onClick={e => e.stopPropagation()}>
            {!addClaimClient ? (
              <>
                <div style={{ padding: '20px 20px 4px' }}>
                  <div className="font-serif" style={{ fontSize: 19, color: T.text }}>Add Claim — Pick Client</div>
                  <div style={{ fontSize: 12, color: T.textFaint, marginTop: 4 }}>
                    Adds a line item to this client's existing claim, or starts a new one if they don't have one yet.
                  </div>
                </div>
                <div style={{ padding: '14px 20px 0' }}>
                  <input autoFocus value={addClaimSearch} onChange={e => setAddClaimSearch(e.target.value)}
                    placeholder="Search clients…"
                    style={{ width: '100%', padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 10, background: 'var(--cream)', color: T.text, fontSize: 13 }} />
                </div>
                <div style={{ maxHeight: 280, overflowY: 'auto', padding: '10px 12px 20px' }}>
                  {clients
                    .filter(c => c.name?.toLowerCase().includes(addClaimSearch.trim().toLowerCase()))
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map(c => (
                      <button key={c.id} onClick={() => { setAddClaimClient(c); setAddClaimError('') }}
                        style={{ width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: T.text }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--cream)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                        {c.name}
                      </button>
                    ))}
                  {clients.filter(c => c.name?.toLowerCase().includes(addClaimSearch.trim().toLowerCase())).length === 0 && (
                    <div style={{ padding: '10px', fontSize: 12.5, color: T.textFaint }}>No clients found</div>
                  )}
                </div>
                <div style={{ padding: '0 20px 20px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowAddClaim(false)}
                    style={{ padding: '8px 16px', fontSize: 13, color: T.textDim, border: `1px solid ${T.line}`, borderRadius: 8, background: 'none', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: '20px 20px 4px' }}>
                  <div className="font-serif" style={{ fontSize: 19, color: T.text }}>{addClaimClient.name}</div>
                  <div style={{ fontSize: 12, color: T.textFaint, marginTop: 4 }}>Which section is this line item for?</div>
                </div>
                {addClaimError && (
                  <div style={{ margin: '14px 20px 0', padding: '8px 10px', background: T.roseSoft, color: T.rose, fontSize: 12, borderRadius: 8 }}>{addClaimError}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 20px' }}>
                  {(['pre', 'in', 'post'] as const).map(sec => (
                    <button key={sec} disabled={addClaimSaving} onClick={() => addLineItemForClient(addClaimClient, sec)}
                      style={{
                        textAlign: 'left', padding: '11px 14px', borderRadius: 10, border: `1px solid ${T.line}`,
                        background: 'var(--cream)', cursor: addClaimSaving ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 600, color: T.text,
                      }}>
                      {SECTION_LABEL[sec]}
                    </button>
                  ))}
                </div>
                <div style={{ padding: '0 20px 20px', display: 'flex', justifyContent: 'space-between' }}>
                  <button onClick={() => { setAddClaimClient(null); setAddClaimError('') }} disabled={addClaimSaving}
                    style={{ padding: '8px 16px', fontSize: 13, color: T.textDim, border: `1px solid ${T.line}`, borderRadius: 8, background: 'none', cursor: addClaimSaving ? 'default' : 'pointer' }}>
                    ← Back
                  </button>
                  <button onClick={() => { setShowAddClaim(false); setAddClaimClient(null) }} disabled={addClaimSaving}
                    style={{ padding: '8px 16px', fontSize: 13, color: T.textDim, border: `1px solid ${T.line}`, borderRadius: 8, background: 'none', cursor: addClaimSaving ? 'default' : 'pointer' }}>
                    {addClaimSaving ? 'Working…' : 'Cancel'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DropZoneList({ zone, label, color, cards, dragOverZone, setDragOverZone, onDrop, draggingId, setDraggingId, onCardClick }: {
  zone: DropZone; label?: string; color?: string; cards: CardData[]
  dragOverZone: DropZone | null; setDragOverZone: (z: DropZone | null) => void
  onDrop: (zone: DropZone) => void
  draggingId: string | null; setDraggingId: (id: string | null) => void
  onCardClick: (card: CardData) => void
}) {
  const isOver = dragOverZone === zone
  return (
    <div
      onDragOver={e => { e.preventDefault(); if (dragOverZone !== zone) setDragOverZone(zone) }}
      onDragLeave={() => { if (dragOverZone === zone) setDragOverZone(null) }}
      onDrop={e => { e.preventDefault(); onDrop(zone) }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, minHeight: 60, borderRadius: 12, padding: 6,
        border: isOver ? `1.5px dashed ${color || T.gold}` : '1.5px dashed transparent',
        background: isOver ? (color ? `${color}0F` : T.goldSoft) : 'transparent',
      }}>
      {label && (
        <div style={{ fontSize: 10.5, fontWeight: 700, color: color || T.textFaint, textTransform: 'uppercase', letterSpacing: 0.4, padding: '0 4px' }}>
          {label} · {cards.length}
        </div>
      )}
      {cards.length === 0 && (
        <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic', padding: '10px 4px' }}>Nothing here</div>
      )}
      {cards.map(card => (
        <ClaimCard key={card.item.id} card={card}
          dragging={draggingId === card.item.id}
          onDragStart={() => setDraggingId(card.item.id)}
          onDragEnd={() => setDraggingId(null)}
          onClick={() => onCardClick(card)} />
      ))}
    </div>
  )
}

function ClaimCard({ card, dragging, onDragStart, onDragEnd, onClick }: {
  card: CardData; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onClick: () => void
}) {
  const { item } = card
  const resolved = item.approved || item.rejected
  const days = daysSince(item.submitted_date || item.date_from)
  const stale = !resolved && days !== null && days >= STALE_DAYS

  return (
    <button draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick} style={{
      textAlign: 'left', width: '100%', cursor: 'grab',
      background: 'white', border: `1px solid ${T.line}`, borderRadius: 12, padding: 12,
      opacity: dragging ? 0.4 : 1,
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