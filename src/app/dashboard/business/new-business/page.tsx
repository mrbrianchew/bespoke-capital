'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import { STAGES, Stage, daysInStage, hasUpcomingMeeting, staleLevel, AttentionCase, AttentionMeeting } from '@/lib/newBusinessAttention'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Firm-wide Kanban over new_business_cases. Slice 1 of the New Business
// Pipeline build: board + stage moves + Lost/Deferred + a read-only-ish
// detail drawer covering case info and products. Meetings, Gmail search,
// and to-dos are the next slice (Brian confirmed board-first sequencing,
// Aug 2026) — the drawer has placeholders noting this rather than silently
// omitting them.

// ─── TYPES ──────────────────────────────────────────────────────────────────

type CaseParty = 'client' | 'spouse' | 'both'
type Outcome = 'lost' | 'deferred' | null
type ProductStatus = 'active' | 'withdrawn' | 'declined_by_insurer' | 'declined_by_client' | 'issued'

interface CaseRow {
  id: string
  advisor_id: string
  client_id: string | null
  prospect_name: string | null
  prospect_contact: string | null
  prospect_email: string | null
  case_party: CaseParty
  spouse_family_member_id: string | null
  case_title: string
  stage: Stage
  stage_changed_at: string
  outcome: Outcome
  outcome_reason: string | null
  outcome_at_stage: string | null
  revisit_date: string | null
  source: string | null
  referred_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface ProductRow {
  id: string
  case_id: string
  life_assured_family_member_id: string | null
  life_assured_role: 'self' | 'spouse' | 'child' | 'other'
  life_assured_name: string
  product_type: string | null
  product_name: string | null
  insurer: string | null
  premium: number | null
  premium_frequency: string | null
  status: ProductStatus
  status_note: string | null
  reference_number: string | null
  linked_policy_id: string | null
  submitted_at: string | null
  issued_at: string | null
}

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  slate: '#5C6B73', slateSoft: 'rgba(92,107,115,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)',
}

function staleBadge(level: 'ok' | 'warn' | 'stale' | 'meeting', row: CaseRow, meetings: AttentionMeeting[]) {
  if (level === 'meeting') {
    const m = hasUpcomingMeeting(row.id, meetings)
    const label = m ? new Date(m.meeting_date + 'T00:00:00').toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
    return { text: `📅 ${label}`, bg: T.slateSoft, fg: T.slate }
  }
  const days = daysInStage(row)
  const text = days === 0 ? 'Today' : `${days}d in stage`
  if (level === 'stale') return { text, bg: T.roseSoft, fg: T.rose }
  if (level === 'warn') return { text, bg: T.goldSoft, fg: T.goldText }
  return { text, bg: T.emeraldSoft, fg: T.emerald }
}

const PRODUCT_STATUS_LABEL: Record<ProductStatus, { label: string; bg: string; fg: string }> = {
  active: { label: 'In Progress', bg: T.emeraldSoft, fg: T.emerald },
  issued: { label: 'Issued', bg: T.goldSoft, fg: T.goldText },
  withdrawn: { label: 'Withdrawn', bg: T.cream2, fg: T.textFaint },
  declined_by_insurer: { label: 'Declined (Insurer)', bg: T.roseSoft, fg: T.rose },
  declined_by_client: { label: 'Declined (Client)', bg: T.roseSoft, fg: T.rose },
}

const OUTCOME_REASON_PLACEHOLDER: Record<'lost' | 'deferred', string> = {
  lost: 'Why did this not proceed?',
  deferred: 'What are you waiting on before revisiting?',
}

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function NewBusinessPipelinePage() {
  const { advisor, clients, authLoading } = useDashboard()
  const router = useRouter()
  const supabase = createClient()

  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const [loading, setLoading] = useState(true)
  const [cases, setCases] = useState<CaseRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [meetings, setMeetings] = useState<AttentionMeeting[]>([])
  const [showLost, setShowLost] = useState(false)
  const [showDeferred, setShowDeferred] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [savingOutcome, setSavingOutcome] = useState(false)
  const [outcomeDraft, setOutcomeDraft] = useState<{ type: 'lost' | 'deferred'; reason: string; revisitDate: string } | null>(null)

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  // Firm-wide load. RLS on new_business_cases scopes directly on advisor_id
  // (not via clients, since client_id is nullable for prospect-only cases) —
  // a plain select with no filter already returns only this advisor's rows.
  useEffect(() => {
    if (authLoading || !hasAccess) { setLoading(false); return }
    let cancelled = false
    async function load() {
      setLoading(true)
      const casesRes = await supabase.from('new_business_cases').select('*').order('created_at', { ascending: true })
      if (cancelled) return
      const caseRows = (casesRes.data || []) as CaseRow[]
      setCases(caseRows)

      const ids = caseRows.map(c => c.id)
      if (ids.length > 0) {
        const [productsRes, meetingsRes] = await Promise.all([
          supabase.from('new_business_case_products').select('*').in('case_id', ids),
          supabase.from('new_business_case_meetings').select('case_id, meeting_date, is_scheduled').in('case_id', ids).eq('is_scheduled', true),
        ])
        if (cancelled) return
        setProducts((productsRes.data || []) as ProductRow[])
        setMeetings((meetingsRes.data || []) as AttentionMeeting[])
      } else {
        setProducts([])
        setMeetings([])
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

  const productsByCase = useMemo(() => {
    const map: Record<string, ProductRow[]> = {}
    products.forEach(p => { (map[p.case_id] ||= []).push(p) })
    return map
  }, [products])

  const activeCases = useMemo(() => cases.filter(c => !c.outcome), [cases])
  const lostCases = useMemo(() => cases.filter(c => c.outcome === 'lost'), [cases])
  const deferredCases = useMemo(() => cases.filter(c => c.outcome === 'deferred'), [cases])

  const columns = useMemo(() => {
    const buckets: Record<Stage, CaseRow[]> = { outreach: [], fact_find: [], planning: [], presentation: [], consideration: [], implementation: [], processing: [], completed: [] }
    activeCases.forEach(c => buckets[c.stage].push(c))
    ;(Object.keys(buckets) as Stage[]).forEach(k => buckets[k].sort((a, b) => new Date(a.stage_changed_at).getTime() - new Date(b.stage_changed_at).getTime()))
    return buckets
  }, [activeCases])

  const metrics = useMemo(() => {
    const considerationCases = activeCases.filter(c => c.stage === 'consideration')
    const considerationStale = considerationCases.filter(c => staleLevel(c, meetings) === 'stale').length
    const processingProducts = products.filter(p => {
      const parentCase = cases.find(c => c.id === p.case_id)
      return parentCase?.stage === 'processing' && p.status === 'active'
    }).length
    const afyp = cases
      .filter(c => !c.outcome)
      .flatMap(c => productsByCase[c.id] || [])
      .filter(p => p.status !== 'withdrawn' && p.status !== 'declined_by_insurer' && p.status !== 'declined_by_client')
      .reduce((sum, p) => sum + (p.premium || 0) * (p.premium_frequency === 'monthly' ? 12 : 1), 0)
    return {
      activeCount: activeCases.length,
      considerationCount: considerationCases.length,
      considerationStale,
      processingProducts,
      afyp,
      deferredCount: deferredCases.length,
    }
  }, [activeCases, meetings, products, cases, productsByCase, deferredCases])

  async function moveStage(id: string, stage: Stage) {
    setCases(prev => prev.map(c => c.id === id ? { ...c, stage, stage_changed_at: new Date().toISOString() } : c))
    const { error } = await supabase.from('new_business_cases')
      .update({ stage, stage_changed_at: new Date().toISOString() }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function submitOutcome() {
    if (!editingId || !outcomeDraft) return
    const row = cases.find(c => c.id === editingId)
    if (!row) return
    setSavingOutcome(true)
    const patch: Partial<CaseRow> = {
      outcome: outcomeDraft.type,
      outcome_reason: outcomeDraft.reason || null,
      outcome_at_stage: STAGES.find(s => s.key === row.stage)?.label || row.stage,
      revisit_date: outcomeDraft.type === 'deferred' ? (outcomeDraft.revisitDate || null) : null,
    }
    const { error } = await supabase.from('new_business_cases').update(patch).eq('id', editingId)
    setSavingOutcome(false)
    if (error) { alert('Save failed: ' + error.message); return }
    setCases(prev => prev.map(c => c.id === editingId ? { ...c, ...patch } : c))
    setOutcomeDraft(null)
    setEditingId(null)
  }

  async function reopenCase(id: string) {
    const { error } = await supabase.from('new_business_cases')
      .update({ outcome: null, outcome_reason: null, outcome_at_stage: null, revisit_date: null }).eq('id', id)
    if (error) { alert('Save failed: ' + error.message); return }
    setCases(prev => prev.map(c => c.id === id ? { ...c, outcome: null, outcome_reason: null, outcome_at_stage: null, revisit_date: null } : c))
  }

  const editingRow = editingId ? cases.find(c => c.id === editingId) || null : null

  if (authLoading || loading) {
    return <div style={{ padding: 40, color: T.textFaint, fontSize: 13 }}>Loading pipeline…</div>
  }
  if (!hasAccess) return null

  return (
    <div style={{ minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 32px 18px', borderBottom: `1px solid ${T.line}` }}>
        <div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.gold }}>Business Dashboard</div>
          <h1 className="font-serif" style={{ fontSize: 32, fontWeight: 600, margin: 0, color: T.text, letterSpacing: '-0.01em' }}>New Business Pipeline</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setShowDeferred(v => !v)}
            style={{ ...btnSmStyle, ...(showDeferred ? { background: T.slateSoft, borderColor: T.slate, color: T.slate } : {}) }}>
            {showDeferred ? 'Hide Deferred' : `Show Deferred (${deferredCases.length})`}
          </button>
          <button onClick={() => setShowLost(v => !v)}
            style={{ ...btnSmStyle, ...(showLost ? { background: T.roseSoft, borderColor: T.rose, color: T.rose } : {}) }}>
            {showLost ? 'Hide Lost' : `Show Lost (${lostCases.length})`}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div style={{ display: 'flex', padding: '16px 32px', borderBottom: `1px solid ${T.line}`, background: T.cream2, flexWrap: 'wrap', gap: 0 }}>
        <Metric label="Active Cases" value={String(metrics.activeCount)} />
        <Metric label="In Consideration" value={String(metrics.considerationCount)} flag={metrics.considerationStale > 0 ? `${metrics.considerationStale} stale` : undefined} />
        <Metric label="Active Products in Processing" value={String(metrics.processingProducts)} />
        <Metric label="Est. AFYP in Pipeline" value={`$${Math.round(metrics.afyp).toLocaleString('en-SG')}`} />
        <Metric label="Deferred / Revisit" value={String(metrics.deferredCount)} last />
      </div>

      {/* Board */}
      <div style={{ overflowX: 'auto', padding: '22px 32px 40px' }}>
        <div style={{ display: 'flex', gap: 16, minWidth: 'max-content' }}>
          {STAGES.map(stage => {
            const stageCases = columns[stage.key]
            const stageLost = showLost ? lostCases.filter(c => c.outcome_at_stage === stage.label) : []
            const stageDeferred = showDeferred ? deferredCases.filter(c => c.outcome_at_stage === stage.label) : []
            return (
              <div key={stage.key} style={{ width: 264, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 12px', borderBottom: `2px solid ${T.text}`, marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, color: T.text }}>{stage.label}</div>
                  <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: T.textFaint }}>{stageCases.length}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 }}>
                  {stageCases.length === 0 && stageLost.length === 0 && stageDeferred.length === 0 && (
                    <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: '10px 2px' }}>No cases</div>
                  )}
                  {stageCases.map(c => (
                    <CaseCard key={c.id} row={c} clientsById={clientsById} products={productsByCase[c.id] || []} meetings={meetings}
                      onClick={() => setEditingId(c.id)} />
                  ))}
                  {stageDeferred.map(c => (
                    <OutcomeCard key={c.id} row={c} kind="deferred" onClick={() => setEditingId(c.id)} />
                  ))}
                  {stageLost.map(c => (
                    <OutcomeCard key={c.id} row={c} kind="lost" onClick={() => setEditingId(c.id)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail drawer */}
      {editingRow && (
        <div onClick={() => { setEditingId(null); setOutcomeDraft(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,23,0.42)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(720px, 94vw)', background: 'var(--cream)', height: '100%', overflowY: 'auto', boxShadow: '-14px 0 40px rgba(0,0,0,0.18)' }}>
            <CaseDrawer
              row={editingRow}
              clientName={editingRow.client_id ? clientsById[editingRow.client_id] : null}
              products={productsByCase[editingRow.id] || []}
              onClose={() => { setEditingId(null); setOutcomeDraft(null) }}
              onMoveStage={stage => moveStage(editingRow.id, stage)}
              outcomeDraft={outcomeDraft}
              onStartOutcome={type => setOutcomeDraft({ type, reason: '', revisitDate: '' })}
              onCancelOutcome={() => setOutcomeDraft(null)}
              onChangeOutcomeDraft={setOutcomeDraft}
              onSubmitOutcome={submitOutcome}
              savingOutcome={savingOutcome}
              onReopen={() => reopenCase(editingRow.id)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SUBCOMPONENTS ──────────────────────────────────────────────────────────

const btnSmStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 600, padding: '6px 11px',
  borderRadius: 7, border: `1px solid ${T.line}`, background: '#fff', color: T.text, cursor: 'pointer',
}

function Metric({ label, value, flag, last }: { label: string; value: string; flag?: string; last?: boolean }) {
  return (
    <div style={{ padding: '0 28px', borderRight: last ? 'none' : `1px solid ${T.line}` }}>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 4 }}>
        {label}{flag && <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: T.roseSoft, color: T.rose }}>{flag}</span>}
      </div>
      <div className="font-serif" style={{ fontSize: 26, fontWeight: 600, color: T.text }}>{value}</div>
    </div>
  )
}

function displayName(row: { case_title: string; prospect_name: string | null; client_id: string | null }, clientsById: Record<string, string>): string {
  return row.case_title
}

function CaseCard({ row, clientsById, products, meetings, onClick }: {
  row: CaseRow; clientsById: Record<string, string>; products: ProductRow[]; meetings: AttentionMeeting[]; onClick: () => void
}) {
  const level = staleLevel(row, meetings)
  const badge = staleBadge(level, row, meetings)
  const isProspect = !row.client_id
  const issuedCount = products.filter(p => p.status === 'issued').length
  const productLabel = row.stage === 'processing'
    ? `${issuedCount}/${products.length} issued`
    : `${products.length} product${products.length === 1 ? '' : 's'}`

  return (
    <div onClick={onClick} style={{
      background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: '13px 14px 12px',
      cursor: 'pointer', boxShadow: '0 1px 2px rgba(28,26,23,0.04), 0 6px 20px rgba(28,26,23,0.06)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: T.text, lineHeight: 1.25 }}>
            {row.case_title}
            {isProspect && <span style={{ display: 'inline-block', fontFamily: 'DM Mono, monospace', fontSize: 9, textTransform: 'uppercase', color: T.gold, border: `1px solid ${T.gold}`, borderRadius: 4, padding: '1px 5px', marginLeft: 6 }}>Prospect</span>}
          </div>
          <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 2 }}>{row.source || (row.client_id ? 'Existing client' : '—')}</div>
        </div>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '3px 7px', borderRadius: 5, whiteSpace: 'nowrap', flexShrink: 0, background: badge.bg, color: badge.fg }}>{badge.text}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 9, borderTop: `1px solid ${T.cream2}` }}>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: T.textDim }}>{productLabel}</div>
      </div>
    </div>
  )
}

function OutcomeCard({ row, kind, onClick }: { row: CaseRow; kind: 'lost' | 'deferred'; onClick: () => void }) {
  const isLost = kind === 'lost'
  return (
    <div onClick={onClick} style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: '13px 14px 12px', cursor: 'pointer', opacity: 0.75 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: T.text }}>{row.case_title}</div>
          <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 2 }}>{isLost ? `Died at: ${row.outcome_at_stage}` : `Paused at: ${row.outcome_at_stage}`}</div>
        </div>
        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '3px 7px', borderRadius: 5, whiteSpace: 'nowrap', background: isLost ? T.roseSoft : T.slateSoft, color: isLost ? T.rose : T.slate }}>
          {isLost ? 'Lost' : row.revisit_date ? `Revisit ${new Date(row.revisit_date).toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })}` : 'Deferred'}
        </span>
      </div>
      {row.outcome_reason && (
        <div style={{ marginTop: 9, background: isLost ? T.roseSoft : T.slateSoft, color: isLost ? T.rose : T.slate, fontSize: 11, padding: '5px 8px', borderRadius: 5 }}>
          {row.outcome_reason}
        </div>
      )}
    </div>
  )
}

function CaseDrawer({
  row, clientName, products, onClose, onMoveStage,
  outcomeDraft, onStartOutcome, onCancelOutcome, onChangeOutcomeDraft, onSubmitOutcome, savingOutcome, onReopen,
}: {
  row: CaseRow
  clientName: string | null
  products: ProductRow[]
  onClose: () => void
  onMoveStage: (stage: Stage) => void
  outcomeDraft: { type: 'lost' | 'deferred'; reason: string; revisitDate: string } | null
  onStartOutcome: (type: 'lost' | 'deferred') => void
  onCancelOutcome: () => void
  onChangeOutcomeDraft: (d: { type: 'lost' | 'deferred'; reason: string; revisitDate: string }) => void
  onSubmitOutcome: () => void
  savingOutcome: boolean
  onReopen: () => void
}) {
  const stageIdx = STAGES.findIndex(s => s.key === row.stage)
  const isProspect = !row.client_id

  return (
    <div>
      <div style={{ padding: '26px 32px 20px', borderBottom: `1px solid ${T.line}`, position: 'sticky', top: 0, background: 'var(--cream)', zIndex: 5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 28, fontWeight: 600, color: T.text, margin: '0 0 4px' }}>{row.case_title}</div>
            <div style={{ fontSize: 12.5, color: T.textDim, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>{clientName || row.prospect_name || 'Unnamed'}</span>
              {row.source && <span style={{ fontFamily: 'DM Mono, monospace' }}>· {row.source}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, fontSize: 22, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        {row.outcome && (
          <div style={{ marginTop: 16, background: row.outcome === 'lost' ? T.roseSoft : T.slateSoft, border: `1px solid ${row.outcome === 'lost' ? 'rgba(138,40,40,.25)' : 'rgba(92,107,115,.25)'}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: row.outcome === 'lost' ? T.rose : T.slate, marginBottom: 3 }}>
              {row.outcome === 'lost' ? 'Marked Lost / Not Proceeded' : 'Deferred'}
              {row.outcome === 'deferred' && row.revisit_date && ` — revisit ${new Date(row.revisit_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </div>
            {row.outcome_reason && <div style={{ fontSize: 12.5, color: T.textDim }}>{row.outcome_reason}</div>}
            <button onClick={onReopen} style={{ marginTop: 8, ...btnSmStyle }}>Reopen Case</button>
          </div>
        )}

        {!row.outcome && (
          <div style={{ display: 'flex', marginTop: 20, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.line}` }}>
            {STAGES.map((s, i) => {
              const done = i < stageIdx, current = i === stageIdx
              return (
                <button key={s.key} onClick={() => onMoveStage(s.key)} title={`Move to ${s.label}`}
                  style={{
                    flex: 1, padding: '8px 4px', textAlign: 'center', fontFamily: 'DM Mono, monospace', fontSize: 9, cursor: 'pointer', border: 'none',
                    borderRight: i < STAGES.length - 1 ? `1px solid ${T.line}` : 'none',
                    background: done ? T.emerald : current ? T.gold : '#fff', color: done || current ? '#fff' : T.textFaint,
                    fontWeight: current ? 700 : 400,
                  }}>{s.label}</button>
              )
            })}
          </div>
        )}
      </div>

      <div style={{ padding: '24px 32px 60px' }}>
        {isProspect && !row.outcome && (
          <div style={{ marginBottom: 28, background: T.goldSoft, border: '1px solid rgba(168,131,74,.3)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: '#6B5225', lineHeight: 1.4 }}>
              <b style={{ display: 'block', marginBottom: 3 }}>Not yet a client record.</b>
              Convert once they agree to proceed, or automatically on first product inception.
            </p>
            <button style={{ ...btnSmStyle, background: T.text, color: 'var(--cream)', whiteSpace: 'nowrap' }} disabled title="Convert-to-client action lands with the case-creation flow">Convert to Client</button>
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 12 }}>
            Products &amp; Life Assured <span style={{ fontWeight: 400, fontSize: 11.5, color: T.textFaint }}>{products.length} line item{products.length === 1 ? '' : 's'}</span>
          </div>
          {products.length === 0 ? (
            <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No products added yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }}>
              <thead>
                <tr>
                  {['Life Assured / Holder', 'Product', 'Status', 'Reference / Policy'].map(h => (
                    <th key={h} style={{ textAlign: 'left', fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.textFaint, background: T.cream2, padding: '9px 12px', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const st = PRODUCT_STATUS_LABEL[p.status]
                  return (
                    <tr key={p.id}>
                      <td style={{ padding: '11px 12px', fontSize: 12.5, borderTop: `1px solid ${T.cream2}` }}>
                        <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 9.5, padding: '2px 6px', borderRadius: 4, background: T.cream2, color: T.textDim, marginRight: 6 }}>{p.life_assured_role.toUpperCase().slice(0, 4)}</span>
                        {p.life_assured_name}
                      </td>
                      <td style={{ padding: '11px 12px', fontSize: 12.5, borderTop: `1px solid ${T.cream2}` }}>{p.product_name || p.product_type || '—'}</td>
                      <td style={{ padding: '11px 12px', fontSize: 12.5, borderTop: `1px solid ${T.cream2}` }}>
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: st.bg, color: st.fg }}>{st.label}</span>
                      </td>
                      <td style={{ padding: '11px 12px', fontSize: 12.5, borderTop: `1px solid ${T.cream2}`, color: T.textDim }}>
                        {p.linked_policy_id ? p.reference_number || '—' : p.reference_number ? `${p.reference_number} (application)` : (p.status_note || '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ marginBottom: 28, fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>
          Meetings, emails, and to-dos land in the next build slice — flagging so this doesn't read as removed scope.
        </div>

        {row.notes && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 8 }}>Notes</div>
            <div style={{ fontSize: 12.5, color: T.textDim, background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: 12 }}>{row.notes}</div>
          </div>
        )}

        {!row.outcome && (
          <div>
            {!outcomeDraft ? (
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => onStartOutcome('deferred')} style={{ ...btnSmStyle, borderColor: T.slate, color: T.slate }}>Mark as Deferred</button>
                <button onClick={() => onStartOutcome('lost')} style={{ ...btnSmStyle, borderColor: T.rose, color: T.rose }}>Mark as Lost / Not Proceeded</button>
              </div>
            ) : (
              <div style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: T.text, marginBottom: 10 }}>
                  {outcomeDraft.type === 'lost' ? 'Mark as Lost / Not Proceeded' : 'Mark as Deferred'}
                </div>
                <textarea value={outcomeDraft.reason} onChange={e => onChangeOutcomeDraft({ ...outcomeDraft, reason: e.target.value })}
                  placeholder={OUTCOME_REASON_PLACEHOLDER[outcomeDraft.type]}
                  style={{ width: '100%', minHeight: 64, border: `1px solid ${T.line}`, borderRadius: 8, padding: '10px 12px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: T.text, background: 'var(--cream)', marginBottom: 10 }} />
                {outcomeDraft.type === 'deferred' && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 6 }}>Revisit Date <span style={{ textTransform: 'none', fontStyle: 'italic' }}>optional</span></div>
                    <input type="date" value={outcomeDraft.revisitDate} onChange={e => onChangeOutcomeDraft({ ...outcomeDraft, revisitDate: e.target.value })}
                      style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: '9px 12px', fontFamily: 'Inter, sans-serif', fontSize: 13, color: T.text, background: 'var(--cream)' }} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={onCancelOutcome} style={btnSmStyle}>Cancel</button>
                  <button onClick={onSubmitOutcome} disabled={savingOutcome}
                    style={{ ...btnSmStyle, background: T.text, color: 'var(--cream)', opacity: savingOutcome ? 0.6 : 1 }}>
                    {savingOutcome ? 'Saving…' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}