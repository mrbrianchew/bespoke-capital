'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import { STAGES, Stage, daysInStage, hasUpcomingMeeting, staleLevel, AttentionCase, AttentionMeeting } from '@/lib/newBusinessAttention'
import NewBusinessCaseModal from '@/components/NewBusinessCaseModal'
import CaseDrawer, { CaseRow, ProductRow, T, btnSmStyle } from '@/components/NewBusinessCaseDrawer'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, closestCenter } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Firm-wide Kanban over new_business_cases. The detail drawer itself lives
// in components/NewBusinessCaseDrawer.tsx, shared with the per-client list
// at dashboard/servicing/new-business — same case, same drawer, two entry
// points.

// ─── TYPES (board-local only — CaseRow/ProductRow now live in the shared drawer) ──

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



// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function NewBusinessPipelinePage() {
  const { advisor, clients, setClients, spouseNames, authLoading } = useDashboard()
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
  const [showNewCase, setShowNewCase] = useState(false)
  const [savingOutcome, setSavingOutcome] = useState(false)
  const [outcomeDraft, setOutcomeDraft] = useState<{ type: 'lost' | 'deferred'; reason: string; revisitDate: string } | null>(null)

  // Drag-and-drop stage moves — distance threshold keeps a plain click on
  // the card (opens the drawer) from being swallowed as a drag; only the
  // grip handle on the card actually starts a drag (see CaseCard below),
  // same convention as SortablePolicyRow on the Protection page.
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const targetStage = over.id as Stage
    const row = cases.find(c => c.id === active.id)
    if (!row || row.outcome || row.stage === targetStage) return
    moveStage(row.id, targetStage)
  }

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

  async function deleteCase(id: string) {
    // Child rows (products, todos, meetings, activity log) cascade-delete;
    // gmail_search_log rows are kept for audit purposes with case_id set
    // to null (fixed via migration — the FK previously had no ON DELETE
    // clause and would have blocked this).
    const { error } = await supabase.from('new_business_cases').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); return }
    setCases(prev => prev.filter(c => c.id !== id))
    setEditingId(null)
    setOutcomeDraft(null)
  }

  const editingRow = editingId ? cases.find(c => c.id === editingId) || null : null

  function handleCaseCreated(newCase: CaseRow) {
    setCases(prev => [...prev, newCase])
    setShowNewCase(false)
  }

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
          <h1 className="font-serif" style={{ fontSize: 32, fontWeight: 600, margin: 0, color: T.text, letterSpacing: '-0.01em' }}>New Business and Review</h1>
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
          <button onClick={() => setShowNewCase(true)} style={{ ...btnSmStyle, background: T.text, color: 'var(--cream)', borderColor: T.text }}>
            + New Case
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
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div style={{ display: 'flex', gap: 16, minWidth: 'max-content' }}>
            {STAGES.map(stage => {
              const stageCases = columns[stage.key]
              const stageLost = showLost ? lostCases.filter(c => c.outcome_at_stage === stage.label) : []
              const stageDeferred = showDeferred ? deferredCases.filter(c => c.outcome_at_stage === stage.label) : []
              return (
                <DroppableColumn key={stage.key} stageKey={stage.key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 4px 12px', borderBottom: `2px solid ${T.text}`, marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 12.5, color: T.text }}>{stage.label}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: T.textFaint }}>{stageCases.length}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 60 }}>
                    {stageCases.length === 0 && stageLost.length === 0 && stageDeferred.length === 0 && (
                      <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic', padding: '10px 2px' }}>No cases</div>
                    )}
                    {stageCases.map(c => (
                      <DraggableCaseCard key={c.id} row={c} clientsById={clientsById} products={productsByCase[c.id] || []} meetings={meetings}
                        onClick={() => setEditingId(c.id)} />
                    ))}
                    {stageDeferred.map(c => (
                      <OutcomeCard key={c.id} row={c} kind="deferred" onClick={() => setEditingId(c.id)} />
                    ))}
                    {stageLost.map(c => (
                      <OutcomeCard key={c.id} row={c} kind="lost" onClick={() => setEditingId(c.id)} />
                    ))}
                  </div>
                </DroppableColumn>
              )
            })}
          </div>
        </DndContext>
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
              spouseName={editingRow.client_id ? spouseNames[editingRow.client_id] || null : null}
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
              onDelete={() => deleteCase(editingRow.id)}
              onProductAdded={p => setProducts(prev => [...prev, p])}
              onProductUpdated={p => setProducts(prev => prev.map(x => x.id === p.id ? p : x))}
              onProductDeleted={id => setProducts(prev => prev.filter(x => x.id !== id))}
            />
          </div>
        </div>
      )}

      {showNewCase && advisor && (
        <NewBusinessCaseModal
          advisorId={advisor.id}
          clients={clients}
          setClients={setClients}
          onClose={() => setShowNewCase(false)}
          onCreated={handleCaseCreated}
        />
      )}
    </div>
  )
}

// ─── SUBCOMPONENTS ──────────────────────────────────────────────────────────

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

// Droppable stage column — highlights while a card is dragged over it.
function DroppableColumn({ stageKey, children }: { stageKey: Stage; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey })
  return (
    <div ref={setNodeRef} style={{
      width: 264, flexShrink: 0, borderRadius: 8,
      background: isOver ? T.goldSoft : 'transparent',
      transition: 'background 0.12s',
    }}>
      {children}
    </div>
  )
}

// Wraps CaseCard with drag behavior. Only the grip handle inside CaseCard
// starts a drag (see activationConstraint on the sensor + listeners scoped
// to the handle) — clicking anywhere else on the card still opens the
// drawer, same convention as SortablePolicyRow on the Protection page.
function DraggableCaseCard(props: {
  row: CaseRow; clientsById: Record<string, string>; products: ProductRow[]; meetings: AttentionMeeting[]; onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: props.row.id })
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 50 : 'auto',
    position: 'relative',
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <CaseCard {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  )
}

function CaseCard({ row, clientsById, products, meetings, onClick, dragHandleProps }: {
  row: CaseRow; clientsById: Record<string, string>; products: ProductRow[]; meetings: AttentionMeeting[]; onClick: () => void
  dragHandleProps?: Record<string, any>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, padding: '3px 7px', borderRadius: 5, whiteSpace: 'nowrap', background: badge.bg, color: badge.fg }}>{badge.text}</span>
          {dragHandleProps && (
            <div {...dragHandleProps} onClick={e => e.stopPropagation()}
              style={{ cursor: 'grab', color: T.textFaint, display: 'flex', alignItems: 'center', touchAction: 'none' }}
              title="Drag to move stage">
              <GripVertical size={13} strokeWidth={2} />
            </div>
          )}
        </div>
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