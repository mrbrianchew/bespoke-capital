'use client'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import GmailClaimSearch from '@/components/GmailClaimSearch'
import { DndContext, DragEndEvent, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Firm-wide Kanban over service_requests. Unlike Claims Board, a card click
// opens an in-place edit modal rather than navigating to a per-client page —
// there's no separate per-client Service Requests page this data lives on,
// the row itself IS the record. Status changes are reachable two ways: drag
// (desktop convenience) and buttons inside the modal (works everywhere,
// including mobile, where dragging a card into an off-screen column isn't
// realistic — see the mobile segmented view below).

// ─── TYPES ──────────────────────────────────────────────────────────────────

type RequestType = string // open list — see service_request_types table
type Status = 'requested' | 'in_progress' | 'done'
type WaitingOn = 'client' | 'firm' | null
type FieldKind = 'text' | 'number' | 'date'

interface FieldDef {
  key: string
  label: string
  kind: FieldKind
}

interface TypeRow {
  id: string
  label: string
  fields: FieldDef[]
  created_at: string
}

interface PolicyLite {
  id: string
  policyNo: string
  companyName: string
  productName: string
  person: string
}

interface ServiceRequestRow {
  id: string
  client_id: string
  request_type: RequestType
  description: string
  policy_label: string | null
  policy_id: string | null
  field_values: Record<string, string>
  status: Status
  waiting_on: WaitingOn
  created_by: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

interface TodoRow {
  id: string
  service_request_id: string
  text: string
  done: boolean
  due_date: string | null
  created_at: string
}

// Curated colors for the original 5 types, keyed by label (request_type
// stores the label directly, not a machine key). Anything added later falls
// through to FALLBACK_PALETTE, picked deterministically by label so the same
// new type always renders the same color across sessions without needing a
// DB column for it.
const CURATED_TYPE_COLOR: Record<string, { bg: string; fg: string }> = {
  'Fund Switch': { bg: 'var(--gold-l)', fg: 'var(--gold-tag)' },
  'Nominee Change': { bg: 'rgba(58,90,120,.12)', fg: '#3A5A78' },
  'Policy Loan': { bg: 'var(--rouge-l)', fg: 'var(--rouge)' },
  'Correspondence': { bg: 'var(--emerald-l)', fg: 'var(--emerald)' },
  'Document Request': { bg: 'var(--cream2)', fg: 'var(--ink2)' },
}

const FALLBACK_PALETTE: { bg: string; fg: string }[] = [
  { bg: 'rgba(168,131,74,.12)', fg: '#8A6C3A' },
  { bg: 'rgba(42,94,70,.12)', fg: '#2A5E46' },
  { bg: 'rgba(138,40,40,.10)', fg: '#8A2828' },
  { bg: 'rgba(58,90,120,.12)', fg: '#3A5A78' },
  { bg: 'rgba(26,24,22,.08)', fg: '#4A4740' },
]

function colorForType(label: string): { bg: string; fg: string } {
  if (CURATED_TYPE_COLOR[label]) return CURATED_TYPE_COLOR[label]
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length]
}

// Slugifies a field label into a stable JSONB key ("Loan Amount" -> "loan_amount").
// Collisions within the same type get a numeric suffix.
function slugifyFieldKey(label: string, existing: string[]): string {
  const base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field'
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base}_${i}`)) i++
  return `${base}_${i}`
}

const RESOLVED_VISIBLE_DAYS = 30 // matches Claims Board's resolved drop-off, for consistency

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)',
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function columnFor(row: ServiceRequestRow): Status | null {
  if (row.status === 'done') {
    const daysAgo = daysSince(row.resolved_at || row.updated_at)
    return daysAgo !== null && daysAgo <= RESOLVED_VISIBLE_DAYS ? 'done' : null // drops off the board
  }
  return row.status
}

const COLUMNS: { id: Status; title: string; hint: string }[] = [
  { id: 'requested', title: 'Requested', hint: 'Not yet started' },
  { id: 'in_progress', title: 'In Progress', hint: 'Waiting on someone' },
  { id: 'done', title: 'Done', hint: `Last ${RESOLVED_VISIBLE_DAYS} days` },
]

// Overdue/today/upcoming badge for a to-do due date — same three buckets as
// Claims Board's dueLabel, kept local here since Service Requests doesn't
// (yet) have a firm-wide "this week's follow-ups" tab to share the helper
// with.
function dueLabel(dueDate: string | null): { text: string; kind: 'overdue' | 'today' | 'upcoming' | 'none' } {
  if (!dueDate) return { text: '', kind: 'none' }
  const d = new Date(dueDate + 'T00:00:00')
  if (isNaN(d.getTime())) return { text: '', kind: 'none' }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) return { text: `Overdue ${Math.abs(diffDays)}d`, kind: 'overdue' }
  if (diffDays === 0) return { text: 'Due today', kind: 'today' }
  return { text: `Due ${d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`, kind: 'upcoming' }
}

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function BusinessServiceRequestsPage() {
  const { advisor, clients, authLoading } = useDashboard()
  const router = useRouter()
  const supabase = createClient()

  // Same two-flag gate as Claims Board — this is the same Business Dashboard
  // section, no separate beta flag introduced for this feature.
  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ServiceRequestRow[]>([])
  const [typeFilter, setTypeFilter] = useState<RequestType | 'all'>('all')
  const [mobileCol, setMobileCol] = useState<Status>('requested')

  // ── drag state ──
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  // ── quick-capture bar state ──
  const [capClientName, setCapClientName] = useState('')
  const [capType, setCapType] = useState<RequestType>('')
  const [capDesc, setCapDesc] = useState('')
  const [capSaving, setCapSaving] = useState(false)
  const [capError, setCapError] = useState('')
  const capDescRef = useRef<HTMLInputElement>(null)

  // ── shared type picklist (service_request_types) ──
  // Firm-wide, not client-scoped — grows as advisors add new types, and each
  // type now carries its own custom field definitions. Loaded once alongside
  // the main data.
  const [typeDefs, setTypeDefs] = useState<TypeRow[]>([])
  const [showManageTypes, setShowManageTypes] = useState(false)

  // ── per-client policy lookup, for linking a request to a real policy ──
  // Lazy-loaded per client (not firm-wide like Claims Board) since most
  // sessions only ever touch a handful of clients' requests at a time.
  const [policiesByClient, setPoliciesByClient] = useState<Record<string, PolicyLite[]>>({})

  // ── edit modal state ──
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalTodos, setModalTodos] = useState<TodoRow[]>([])
  const [todoDraft, setTodoDraft] = useState('')
  const [todoDueDraft, setTodoDueDraft] = useState('')
  const [savingModal, setSavingModal] = useState(false)

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  // Firm-wide load. RLS on service_requests scopes through clients.advisor_id
  // (own_service_requests policy) — a plain select with no client_id filter
  // already returns only this advisor's rows, same as Claims Board.
  // service_request_types has no client scoping at all — it's a shared
  // taxonomy, RLS just requires being logged in.
  useEffect(() => {
    if (authLoading || !hasAccess) { setLoading(false); return }
    let cancelled = false
    async function load() {
      setLoading(true)
      const [reqRes, typesRes] = await Promise.all([
        supabase.from('service_requests').select('*'),
        supabase.from('service_request_types').select('*').order('created_at', { ascending: true }),
      ])
      if (cancelled) return
      const rowsData = (reqRes.data || []).map((r: any) => ({ ...r, field_values: r.field_values || {} })) as ServiceRequestRow[]
      setRows(rowsData)
      const loadedTypes = ((typesRes.data || []) as any[]).map(t => ({ ...t, fields: t.fields || [] })) as TypeRow[]
      // Belt-and-braces: any request_type in use that somehow isn't in the
      // picklist (e.g. added before this migration, or a rename race) still
      // shows up as a synthetic option rather than silently vanishing.
      const knownLabels = new Set(loadedTypes.map(t => t.label))
      const orphanLabels = Array.from(new Set(rowsData.map(r => r.request_type).filter(l => l && !knownLabels.has(l))))
      const merged = [...loadedTypes, ...orphanLabels.map(label => ({ id: `orphan:${label}`, label, fields: [] as FieldDef[], created_at: '' }))]
      setTypeDefs(merged)
      if (merged.length > 0) setCapType(prev => prev || merged[0].label)
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

  const typeOptions = useMemo(() => typeDefs.map(t => t.label), [typeDefs])
  const typeUsageCount = useMemo(() => {
    const counts: Record<string, number> = {}
    rows.forEach(r => { counts[r.request_type] = (counts[r.request_type] || 0) + 1 })
    return counts
  }, [rows])

  function fieldsForType(label: string): FieldDef[] {
    return typeDefs.find(t => t.label === label)?.fields || []
  }

  const filteredRows = useMemo(() => {
    return typeFilter === 'all' ? rows : rows.filter(r => r.request_type === typeFilter)
  }, [rows, typeFilter])

  const columns = useMemo(() => {
    const buckets: Record<Status, ServiceRequestRow[]> = { requested: [], in_progress: [], done: [] }
    filteredRows.forEach(row => {
      const col = columnFor(row)
      if (!col) return
      buckets[col].push(row)
    })
    ;(Object.keys(buckets) as Status[]).forEach(col => {
      buckets[col].sort((a, b) => {
        if (col === 'done') return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime() // oldest first — most idle at top
      })
    })
    return buckets
  }, [filteredRows])

  const editingRow = editingId ? rows.find(r => r.id === editingId) || null : null

  // Lazily fetch a client's real policies (from fact_finding's
  // protection_portfolio, same JSONB structure Claims Board already reads —
  // just not filtered to medical-only here, since a service request can
  // touch any policy type) the first time a request for that client is
  // opened. Cached per client_id so reopening doesn't refetch.
  useEffect(() => {
    if (!editingRow) return
    const clientId = editingRow.client_id
    if (policiesByClient[clientId]) return
    let cancelled = false
    supabase.from('fact_finding').select('data').eq('client_id', clientId).eq('section', 'protection_portfolio').maybeSingle()
      .then(({ data }: any) => {
        if (cancelled) return
        const list: PolicyLite[] = (data?.data?.risk_management?.policies || []).map((p: any) => ({
          id: p.id, policyNo: p.policyNo || '', companyName: p.companyName || '', productName: p.productName || '', person: p.person || '',
        }))
        setPoliciesByClient(prev => ({ ...prev, [clientId]: list }))
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow?.client_id])

  function resolvedPolicy(row: ServiceRequestRow): { label: string; policyNo: string } | null {
    if (row.policy_id) {
      const p = (policiesByClient[row.client_id] || []).find(pp => pp.id === row.policy_id)
      if (p) return { label: `${p.companyName} — ${p.productName}${p.policyNo ? ` (${p.policyNo})` : ''}`, policyNo: p.policyNo }
      return { label: 'Loading policy…', policyNo: '' }
    }
    if (row.policy_label) return { label: row.policy_label, policyNo: '' }
    return null
  }

  // Optimistic update then write — same pattern as Claims Board's moveItem.
  async function patchRow(id: string, patch: Partial<ServiceRequestRow>) {
    const withTimestamp = { ...patch, updated_at: new Date().toISOString() }
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...withTimestamp } : r))
    const { error } = await supabase.from('service_requests').update(withTimestamp).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  function setFieldValue(row: ServiceRequestRow, key: string, value: string) {
    patchRow(row.id, { field_values: { ...row.field_values, [key]: value } })
  }

  async function moveTo(id: string, status: Status) {
    const patch: Partial<ServiceRequestRow> = { status }
    if (status === 'done') patch.resolved_at = new Date().toISOString()
    else patch.resolved_at = null // un-resolving clears it, matches Claims' un-resolve behaviour
    await patchRow(id, patch)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = event
    if (!over) return
    const id = active.id as string
    const zone = over.id as Status
    const row = rows.find(r => r.id === id)
    if (!row || row.status === zone) return
    moveTo(id, zone)
  }

  // Adds a new type to the shared picklist if it doesn't already exist
  // (case-insensitive). Returns the canonical label to use — either the
  // newly-created one, or the existing match if this was a near-duplicate.
  // A genuine insert failure is surfaced via alert() and returns null — it
  // must NOT fall back to "pretend it worked" local-only state, or the type
  // silently vanishes on next load with no sign anything went wrong (this
  // masked a real PostgREST schema-cache staleness bug once already).
  async function addNewType(raw: string): Promise<string | null> {
    const label = raw.trim()
    if (!label) return null
    const existing = typeOptions.find(t => t.toLowerCase() === label.toLowerCase())
    if (existing) return existing
    const { data, error } = await supabase.from('service_request_types').insert({ label }).select().maybeSingle()
    if (error) {
      if (error.code === '23505') {
        const { data: row } = await supabase.from('service_request_types').select('*').ilike('label', label).maybeSingle()
        if (row) {
          setTypeDefs(prev => Array.from(new Set([...prev.map(t => t.label), row.label])).map(l => prev.find(t => t.label === l) || { ...row, fields: row.fields || [] }))
          return row.label
        }
      }
      alert('Could not save new type: ' + error.message)
      return null
    }
    const newType = { ...(data as any), fields: (data as any)?.fields || [] } as TypeRow
    setTypeDefs(prev => [...prev, newType])
    return newType.label
  }

  // Renaming cascades: the type row's label changes, then every existing
  // service_requests.request_type currently matching the old label is
  // updated to the new one — request_type is free text, not a foreign key,
  // so nothing does this automatically. Blocks on a collision with a
  // DIFFERENT existing type rather than silently merging two types together
  // (a real merge is a bigger operation than a rename and not what this is).
  async function renameType(typeId: string, oldLabel: string, newLabelRaw: string) {
    const newLabel = newLabelRaw.trim()
    if (!newLabel || newLabel === oldLabel) return
    const collision = typeDefs.find(t => t.id !== typeId && t.label.toLowerCase() === newLabel.toLowerCase())
    if (collision) { alert(`"${newLabel}" already exists as a separate type — pick a different name, or delete one of them first.`); return }
    const { error: renameErr } = await supabase.from('service_request_types').update({ label: newLabel }).eq('id', typeId)
    if (renameErr) { alert('Could not rename: ' + renameErr.message); return }
    if (typeUsageCount[oldLabel] > 0) {
      const { error: cascadeErr } = await supabase.from('service_requests').update({ request_type: newLabel }).eq('request_type', oldLabel)
      if (cascadeErr) { alert('Type renamed, but updating existing requests failed: ' + cascadeErr.message); }
      else setRows(prev => prev.map(r => r.request_type === oldLabel ? { ...r, request_type: newLabel } : r))
    }
    setTypeDefs(prev => prev.map(t => t.id === typeId ? { ...t, label: newLabel } : t))
    if (capType === oldLabel) setCapType(newLabel)
  }

  // Blocks deletion while the type is in use — the safe default. Renaming
  // first, or waiting until nothing references it, are the ways around this.
  async function deleteType(typeId: string, label: string) {
    const count = typeUsageCount[label] || 0
    if (count > 0) { alert(`"${label}" is used by ${count} request${count === 1 ? '' : 's'} — rename it if needed, but it can't be deleted while in use.`); return }
    if (!window.confirm(`Delete the "${label}" type? This cannot be undone.`)) return
    setTypeDefs(prev => prev.filter(t => t.id !== typeId))
    const { error } = await supabase.from('service_request_types').delete().eq('id', typeId)
    if (error) alert('Delete failed: ' + error.message)
  }

  async function updateTypeFields(typeId: string, fields: FieldDef[]) {
    setTypeDefs(prev => prev.map(t => t.id === typeId ? { ...t, fields } : t))
    const { error } = await supabase.from('service_request_types').update({ fields }).eq('id', typeId)
    if (error) alert('Could not save field: ' + error.message)
  }

  // Quick-capture — resolves the typed client name against the already-loaded
  // client list (via the datalist below). Requires an exact match; anything
  // else is a typo and gets rejected rather than silently creating a request
  // against the wrong client.
  async function submitQuickCapture() {
    setCapError('')
    const name = capClientName.trim()
    const desc = capDesc.trim()
    if (!name || !desc || !capType) return
    const client = clients.find(c => c.name.toLowerCase() === name.toLowerCase())
    if (!client) { setCapError(`No client named "${name}" — check the spelling or pick from the list.`); return }
    setCapSaving(true)
    const { data, error } = await supabase.from('service_requests')
      .insert({ client_id: client.id, request_type: capType, description: desc, status: 'requested' })
      .select().maybeSingle()
    setCapSaving(false)
    if (error) { setCapError('Could not save: ' + error.message); return }
    if (data) setRows(prev => [...prev, { ...(data as any), field_values: (data as any).field_values || {} } as ServiceRequestRow])
    setCapClientName('')
    setCapDesc('')
    capDescRef.current?.focus()
  }

  // ── modal todos ──
  useEffect(() => {
    if (!editingId) { setModalTodos([]); return }
    let cancelled = false
    supabase.from('service_request_todos').select('*').eq('service_request_id', editingId).order('created_at', { ascending: true })
      .then(({ data }: any) => { if (!cancelled) setModalTodos((data || []) as TodoRow[]) })
    return () => { cancelled = true }
  }, [editingId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addTodo() {
    if (!editingId || !todoDraft.trim()) return
    const { data, error } = await supabase.from('service_request_todos')
      .insert({ service_request_id: editingId, text: todoDraft.trim(), due_date: todoDueDraft || null }).select().maybeSingle()
    if (error) { alert('Could not add: ' + error.message); return }
    if (data) setModalTodos(prev => [...prev, data as TodoRow])
    setTodoDraft('')
    setTodoDueDraft('')
  }

  async function toggleTodo(id: string, done: boolean) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    const { error } = await supabase.from('service_request_todos').update({ done }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function setTodoDueDate(id: string, due_date: string) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, due_date: due_date || null } : t))
    const { error } = await supabase.from('service_request_todos').update({ due_date: due_date || null }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function deleteTodo(id: string) {
    setModalTodos(prev => prev.filter(t => t.id !== id))
    const { error } = await supabase.from('service_request_todos').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  async function deleteRequest(id: string) {
    if (!window.confirm('Delete this service request? This cannot be undone.')) return
    setRows(prev => prev.filter(r => r.id !== id))
    setEditingId(null)
    const { error } = await supabase.from('service_requests').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  if (!hasAccess) return null

  const openCount = columns.requested.length + columns.in_progress.length
  const editingFields = editingRow ? fieldsForType(editingRow.request_type) : []
  const editingPolicy = editingRow ? resolvedPolicy(editingRow) : null

  return (
    <div style={{ padding: 24, background: 'var(--cream)', minHeight: '100%', borderRadius: 16 }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.gold, fontWeight: 700 }}>Business Dashboard</div>
          <div className="font-serif" style={{ fontSize: 26, marginTop: 5, color: T.text }}>Service Requests</div>
          <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 4 }}>
            {loading ? 'Loading…' : `${openCount} open request${openCount === 1 ? '' : 's'} across all clients`}
          </div>
        </div>
      </div>

      {/* ── Quick capture ── */}
      <div style={{ background: 'white', border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 14px', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            list="sr-clients-datalist"
            value={capClientName}
            onChange={e => setCapClientName(e.target.value)}
            placeholder="Client — start typing…"
            style={{ flex: '0 0 170px', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}
          />
          <datalist id="sr-clients-datalist">
            {clients.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
          <TypeSelect
            value={capType}
            options={typeOptions}
            onChange={setCapType}
            onAddNew={async label => { const canonical = await addNewType(label); if (canonical) { setCapType(canonical); return true }; return false }}
            width={170}
          />
          <input
            ref={capDescRef}
            value={capDesc}
            onChange={e => setCapDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitQuickCapture() }}
            placeholder="What needs to be done…"
            style={{ flex: '1 1 200px', minWidth: 160, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}
          />
          <button onClick={submitQuickCapture} disabled={capSaving || !capClientName.trim() || !capDesc.trim() || !capType}
            style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: capSaving ? 'default' : 'pointer', opacity: capSaving || !capClientName.trim() || !capDesc.trim() || !capType ? 0.5 : 1 }}>
            {capSaving ? 'Adding…' : 'Add'}
          </button>
        </div>
        {capError && <div style={{ fontSize: 11.5, color: T.rose, marginTop: 8 }}>{capError}</div>}
      </div>

      {/* ── type filter chips + manage types ── */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All types</FilterChip>
        {typeOptions.map(t => (
          <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{t}</FilterChip>
        ))}
        <button onClick={() => setShowManageTypes(true)}
          style={{ marginLeft: 4, padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px dashed ${T.textFaint}`, background: 'none', color: T.textFaint }}>
          ⚙ Manage types
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>Loading service requests…</div>
      ) : (
        <>
          {/* ── DESKTOP: drag-and-drop board ── */}
          <div className="hidden md:flex" style={{ gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
            <DndContext sensors={dndSensors} onDragStart={e => setDraggingId(e.active.id as string)} onDragEnd={handleDragEnd}>
              {COLUMNS.map(col => (
                <div key={col.id} style={{ flex: '0 0 300px', minWidth: 300 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 4px 10px' }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{col.title}</div>
                      <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 1 }}>{col.hint}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, background: 'var(--cream2)', padding: '2px 8px', borderRadius: 999 }}>
                      {columns[col.id].length}
                    </span>
                  </div>
                  <DropZone id={col.id}>
                    {columns[col.id].length === 0 && (
                      <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic', padding: '10px 4px' }}>Nothing here</div>
                    )}
                    {columns[col.id].map(row => (
                      <RequestCard key={row.id} row={row} clientName={clientsById[row.client_id] || 'Unknown client'}
                        policyLabel={resolvedPolicy(row)?.label || null}
                        dragging={draggingId === row.id} onClick={() => setEditingId(row.id)} />
                    ))}
                  </DropZone>
                </div>
              ))}
            </DndContext>
          </div>

          {/* ── MOBILE: segmented single-column view ── */}
          <div className="flex md:hidden" style={{ flexDirection: 'column' }}>
            <div style={{ display: 'flex', background: 'white', border: `1px solid ${T.line}`, borderRadius: 10, padding: 3, marginBottom: 14, gap: 2 }}>
              {COLUMNS.map(col => (
                <button key={col.id} onClick={() => setMobileCol(col.id)}
                  style={{ flex: 1, border: 'none', background: mobileCol === col.id ? 'var(--charcoal)' : 'none', color: mobileCol === col.id ? 'white' : T.textDim, fontSize: 11.5, fontWeight: 700, padding: '9px 4px', borderRadius: 7, cursor: 'pointer' }}>
                  {col.title}
                  <span style={{ display: 'block', fontSize: 9.5, fontWeight: 600, opacity: 0.75, marginTop: 1 }}>{columns[col.id].length}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {columns[mobileCol].length === 0 && (
                <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic', padding: '10px 4px' }}>Nothing here</div>
              )}
              {columns[mobileCol].map(row => (
                <RequestCard key={row.id} row={row} clientName={clientsById[row.client_id] || 'Unknown client'}
                  policyLabel={resolvedPolicy(row)?.label || null}
                  dragging={false} onClick={() => setEditingId(row.id)} />
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── edit modal ── */}
      {editingRow && (
        <div onClick={() => setEditingId(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 200 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', background: 'white', borderRadius: 14 }}>
            <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="font-serif" style={{ fontSize: 22, fontWeight: 600, color: T.text }}>
                  {clientsById[editingRow.client_id] || 'Unknown client'}
                </div>
                <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>
                  {editingRow.request_type}{editingPolicy ? ` · ${editingPolicy.label}` : ''} · opened {new Date(editingRow.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                </div>
              </div>
              <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
            </div>

            <div style={{ padding: '18px 24px 24px' }}>
              <SectionLabel>Status</SectionLabel>
              <div style={{ display: 'flex', gap: 7 }}>
                {COLUMNS.map(col => (
                  <button key={col.id} onClick={() => moveTo(editingRow.id, col.id)}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 9, fontSize: 12, fontWeight: 700, textAlign: 'center', cursor: 'pointer',
                      border: `1.5px solid ${editingRow.status === col.id ? 'var(--charcoal)' : T.line}`,
                      background: editingRow.status === col.id ? 'var(--charcoal)' : 'white',
                      color: editingRow.status === col.id ? 'white' : T.textDim,
                    }}>
                    {col.title}
                  </button>
                ))}
              </div>

              <SectionLabel>Waiting on</SectionLabel>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                <WaitingButton active={editingRow.waiting_on === null} onClick={() => patchRow(editingRow.id, { waiting_on: null })}>Not applicable</WaitingButton>
                <WaitingButton active={editingRow.waiting_on === 'client'} kind="client" onClick={() => patchRow(editingRow.id, { waiting_on: 'client' })}>Client</WaitingButton>
                <WaitingButton active={editingRow.waiting_on === 'firm'} kind="firm" onClick={() => patchRow(editingRow.id, { waiting_on: 'firm' })}>Insurer / fund house</WaitingButton>
              </div>

              <SectionLabel>Request details</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <FieldLabel>Type</FieldLabel>
                  <TypeSelect
                    value={editingRow.request_type}
                    options={typeOptions}
                    onChange={v => patchRow(editingRow.id, { request_type: v })}
                    onAddNew={async label => { const canonical = await addNewType(label); if (canonical) { patchRow(editingRow.id, { request_type: canonical }); return true }; return false }}
                    width="100%"
                  />
                </div>
                <div style={{ gridColumn: '1/-1' }}>
                  <FieldLabel>Description</FieldLabel>
                  <textarea defaultValue={editingRow.description} onBlur={e => patchRow(editingRow.id, { description: e.target.value.trim() })}
                    rows={2}
                    style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>
              </div>

              <SectionLabel>Policy</SectionLabel>
              <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
                <button onClick={() => patchRow(editingRow.id, { policy_label: null })}
                  style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${editingRow.policy_id || !editingRow.policy_label ? 'var(--charcoal)' : T.line}`, background: editingRow.policy_id || !editingRow.policy_label ? 'var(--charcoal)' : 'white', color: editingRow.policy_id || !editingRow.policy_label ? 'white' : T.textDim }}>
                  Existing policy
                </button>
                <button onClick={() => patchRow(editingRow.id, { policy_id: null, policy_label: '' })}
                  style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${!editingRow.policy_id && editingRow.policy_label !== null ? 'var(--charcoal)' : T.line}`, background: !editingRow.policy_id && editingRow.policy_label !== null ? 'var(--charcoal)' : 'white', color: !editingRow.policy_id && editingRow.policy_label !== null ? 'white' : T.textDim }}>
                  Not on file yet
                </button>
              </div>
              {!editingRow.policy_id && editingRow.policy_label === null ? (
                <select value={editingRow.policy_id || ''} onChange={e => patchRow(editingRow.id, { policy_id: e.target.value || null })}
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                  <option value="">Select a policy…</option>
                  {(policiesByClient[editingRow.client_id] || []).map(p => (
                    <option key={p.id} value={p.id}>{p.companyName} — {p.productName}{p.policyNo ? ` (${p.policyNo})` : ''}</option>
                  ))}
                </select>
              ) : editingRow.policy_id ? (
                <select value={editingRow.policy_id} onChange={e => patchRow(editingRow.id, { policy_id: e.target.value || null })}
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                  {(policiesByClient[editingRow.client_id] || []).map(p => (
                    <option key={p.id} value={p.id}>{p.companyName} — {p.productName}{p.policyNo ? ` (${p.policyNo})` : ''}</option>
                  ))}
                </select>
              ) : (
                <input defaultValue={editingRow.policy_label || ''} onBlur={e => patchRow(editingRow.id, { policy_label: e.target.value.trim() || '' })}
                  placeholder="e.g. new application with XYZ Insurance"
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
              )}

              {editingFields.length > 0 && (
                <>
                  <SectionLabel>Additional details — {editingRow.request_type}</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {editingFields.map(f => (
                      <div key={f.key}>
                        <FieldLabel>{f.label}</FieldLabel>
                        <input
                          type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                          defaultValue={editingRow.field_values?.[f.key] || ''}
                          onBlur={e => setFieldValue(editingRow, f.key, e.target.value)}
                          style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                      </div>
                    ))}
                  </div>
                </>
              )}

              <SectionLabel>To-dos</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {modalTodos.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No to-dos yet.</div>}
                {modalTodos.map(t => {
                  const due = dueLabel(t.due_date)
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="checkbox" checked={t.done} onChange={e => toggleTodo(t.id, e.target.checked)} />
                      <div style={{ flex: 1, fontSize: 12.5, color: t.done ? T.textFaint : T.text, textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</div>
                      {!t.done && due.kind !== 'none' && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: due.kind === 'overdue' ? T.roseSoft : due.kind === 'today' ? T.goldSoft : 'var(--cream2)', color: due.kind === 'overdue' ? T.rose : due.kind === 'today' ? T.goldText : T.textFaint, whiteSpace: 'nowrap' }}>
                          {due.text}
                        </span>
                      )}
                      <input type="date" value={t.due_date || ''} onChange={e => setTodoDueDate(t.id, e.target.value)}
                        style={{ fontSize: 10.5, padding: '2px 4px', border: `1px solid ${T.line}`, borderRadius: 5, background: 'white', color: T.textFaint, width: 108 }} />
                      <button onClick={() => deleteTodo(t.id)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={todoDraft} onChange={e => setTodoDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
                  placeholder="Add a to-do…"
                  style={{ flex: 1, padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                <input type="date" value={todoDueDraft} onChange={e => setTodoDueDraft(e.target.value)}
                  style={{ padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5, width: 130 }} />
                <button onClick={addTodo} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer' }}>Add</button>
              </div>

              <ModalSection title="Related emails" defaultOpen={false}>
                <GmailClaimSearch serviceRequestId={editingRow.id} defaultTerms={[editingPolicy?.policyNo].filter((v): v is string => !!v)} />
              </ModalSection>

              <div style={{ height: 1, background: T.line, margin: '20px 0 14px' }} />
              <button onClick={() => deleteRequest(editingRow.id)}
                style={{ fontSize: 12, fontWeight: 700, color: T.rose, background: T.roseSoft, border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>
                Delete request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── manage types modal ── */}
      {showManageTypes && (
        <ManageTypesModal
          typeDefs={typeDefs}
          typeUsageCount={typeUsageCount}
          onClose={() => setShowManageTypes(false)}
          onRename={renameType}
          onDelete={deleteType}
          onUpdateFields={updateTypeFields}
          onAddNew={addNewType}
        />
      )}
    </div>
  )
}

// ─── SUBCOMPONENTS ──────────────────────────────────────────────────────────

const ADD_NEW_SENTINEL = '__add_new__'

// A normal <select> of existing types, plus an "+ Add new type…" option that
// swaps in a text input. Confirming (Enter or the Add button) hands the raw
// text to onAddNew, which is responsible for dedup/insert into the shared
// service_request_types table — this component doesn't know about Supabase.
function TypeSelect({ value, options, onChange, onAddNew, width }: {
  value: string; options: string[]; onChange: (v: string) => void
  onAddNew: (label: string) => Promise<boolean>; width: number | string
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function confirm() {
    const label = draft.trim()
    if (!label) { setAdding(false); return }
    setSaving(true)
    const ok = await onAddNew(label)
    setSaving(false)
    if (ok) { setDraft(''); setAdding(false) } // failure leaves the input open with the typed text so it's retryable, not silently discarded
  }

  if (adding) {
    return (
      <div style={{ display: 'flex', gap: 6, flex: `0 0 ${typeof width === 'number' ? width + 'px' : width}` }}>
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setAdding(false); setDraft('') } }}
          placeholder="New type name…"
          style={{ flex: 1, minWidth: 0, padding: '9px 11px', border: `1px solid ${T.gold}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }} />
        <button onClick={confirm} disabled={saving || !draft.trim()}
          style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer', opacity: saving || !draft.trim() ? 0.5 : 1 }}>
          {saving ? '…' : '✓'}
        </button>
      </div>
    )
  }

  return (
    <select
      value={value}
      onChange={e => { if (e.target.value === ADD_NEW_SENTINEL) setAdding(true); else onChange(e.target.value) }}
      style={{ flex: typeof width === 'number' ? `0 0 ${width}px` : undefined, width: typeof width === 'string' ? width : undefined, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
      {!value && <option value="">Select type…</option>}
      {options.map(t => <option key={t} value={t}>{t}</option>)}
      <option value={ADD_NEW_SENTINEL}>+ Add new type…</option>
    </select>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--charcoal)' : T.line}`,
      background: active ? 'var(--charcoal)' : 'white',
      color: active ? 'white' : T.textDim,
    }}>
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>{children}</div>
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: T.textDim, marginBottom: 5, display: 'block' }}>{children}</span>
}

function WaitingButton({ active, kind, onClick, children }: { active: boolean; kind?: 'client' | 'firm'; onClick: () => void; children: React.ReactNode }) {
  const activeColor = kind === 'client' ? T.rose : kind === 'firm' ? T.goldText : T.text
  const activeBg = kind === 'client' ? T.roseSoft : kind === 'firm' ? T.goldSoft : 'var(--cream2)'
  return (
    <button onClick={onClick} style={{
      padding: '7px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
      border: `1.5px solid ${active ? activeColor : T.line}`,
      background: active ? activeBg : 'white',
      color: active ? activeColor : T.textDim,
    }}>
      {children}
    </button>
  )
}

function DropZone({ id, children }: { id: Status; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} style={{
      display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80, borderRadius: 12, padding: 10,
      background: isOver ? 'var(--gold-l)' : 'var(--cream2)',
      border: isOver ? '1.5px dashed var(--gold)' : '1.5px dashed transparent',
    }}>
      {children}
    </div>
  )
}

function RequestCard({ row, clientName, policyLabel, dragging, onClick }: {
  row: ServiceRequestRow; clientName: string; policyLabel: string | null; dragging: boolean; onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id })
  const days = daysSince(row.created_at)
  const color = colorForType(row.request_type)
  const waitingLabel = row.waiting_on === 'client' ? 'Waiting on client' : row.waiting_on === 'firm' ? 'Waiting on insurer' : null

  return (
    <button ref={setNodeRef} {...listeners} {...attributes} onClick={onClick} style={{
      textAlign: 'left', width: '100%', cursor: 'grab', touchAction: 'none',
      background: 'white', border: `1px solid ${T.line}`, borderRadius: 10, padding: 12,
      opacity: dragging || isDragging ? 0.4 : 1,
      transform: transform ? CSS.Translate.toString(transform) : undefined,
      zIndex: isDragging ? 10 : undefined, position: isDragging ? 'relative' : undefined,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <span className="font-serif" style={{ fontSize: 16.5, fontWeight: 600, color: T.text, lineHeight: 1.15 }}>{clientName}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2.5px 8px', borderRadius: 5, background: color.bg, color: color.fg, whiteSpace: 'nowrap' }}>
          {row.request_type}
        </span>
      </div>
      <div style={{ fontSize: 12, color: T.textDim, margin: '5px 0 4px', lineHeight: 1.4 }}>{row.description}</div>
      {policyLabel && <div style={{ fontSize: 10.5, color: T.textFaint, marginBottom: 6 }}>{policyLabel}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10.5, color: T.textFaint, marginTop: 4 }}>
        {waitingLabel ? (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
            background: row.waiting_on === 'client' ? T.roseSoft : T.goldSoft,
            color: row.waiting_on === 'client' ? T.rose : T.goldText,
          }}>{waitingLabel}</span>
        ) : <span />}
        <span className="font-mono">
          {row.status === 'done' ? `Completed ${daysSince(row.resolved_at) ?? 0}d ago` : days !== null ? `${days}d old` : ''}
        </span>
      </div>
    </button>
  )
}

// Reused from the Claims Board card modal's collapsible-section pattern.
function ModalSection({ title, subtitle, defaultOpen, children }: { title: string; subtitle?: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', borderTop: `1px solid ${T.line}`, textAlign: 'left' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{subtitle}</div>}
        </div>
        <span style={{ color: T.textFaint, fontSize: 13, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>▾</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

// ── Manage Types modal ──────────────────────────────────────────────────────
// Lists every type in the shared picklist. Each row: an inline-editable
// label (rename cascades to every existing request of that type), its
// custom field definitions (add/remove), and a delete button that's blocked
// while the type is in use.
function ManageTypesModal({ typeDefs, typeUsageCount, onClose, onRename, onDelete, onUpdateFields, onAddNew }: {
  typeDefs: TypeRow[]
  typeUsageCount: Record<string, number>
  onClose: () => void
  onRename: (typeId: string, oldLabel: string, newLabel: string) => Promise<void>
  onDelete: (typeId: string, label: string) => Promise<void>
  onUpdateFields: (typeId: string, fields: FieldDef[]) => Promise<void>
  onAddNew: (label: string) => Promise<string | null>
}) {
  const [newTypeDraft, setNewTypeDraft] = useState('')
  const [addingNewType, setAddingNewType] = useState(false)

  async function addType() {
    if (!newTypeDraft.trim()) return
    setAddingNewType(true)
    await onAddNew(newTypeDraft.trim())
    setAddingNewType(false)
    setNewTypeDraft('')
  }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 210 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: 'white', borderRadius: 14 }}>
        <div style={{ padding: '22px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 22, fontWeight: 600, color: T.text }}>Manage Service Types</div>
            <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>Rename, delete, or add custom fields to each type.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
        </div>

        <div style={{ padding: '18px 24px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {typeDefs.map(t => (
              <TypeManageRow key={t.id} type={t} usageCount={typeUsageCount[t.label] || 0}
                onRename={onRename} onDelete={onDelete} onUpdateFields={onUpdateFields} />
            ))}
          </div>

          <div style={{ height: 1, background: T.line, margin: '18px 0 14px' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={newTypeDraft} onChange={e => setNewTypeDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addType() }}
              placeholder="New type name…"
              style={{ flex: 1, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
            <button onClick={addType} disabled={addingNewType || !newTypeDraft.trim()}
              style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer', opacity: addingNewType || !newTypeDraft.trim() ? 0.5 : 1 }}>
              + Add type
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TypeManageRow({ type, usageCount, onRename, onDelete, onUpdateFields }: {
  type: TypeRow; usageCount: number
  onRename: (typeId: string, oldLabel: string, newLabel: string) => Promise<void>
  onDelete: (typeId: string, label: string) => Promise<void>
  onUpdateFields: (typeId: string, fields: FieldDef[]) => Promise<void>
}) {
  const [labelDraft, setLabelDraft] = useState(type.label)
  const [showFieldForm, setShowFieldForm] = useState(false)
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldKind, setNewFieldKind] = useState<FieldKind>('text')

  useEffect(() => { setLabelDraft(type.label) }, [type.label])

  function addField() {
    const label = newFieldLabel.trim()
    if (!label) return
    const key = slugifyFieldKey(label, type.fields.map(f => f.key))
    onUpdateFields(type.id, [...type.fields, { key, label, kind: newFieldKind }])
    setNewFieldLabel('')
    setNewFieldKind('text')
    setShowFieldForm(false)
  }

  function removeField(key: string) {
    onUpdateFields(type.id, type.fields.filter(f => f.key !== key))
  }

  return (
    <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={labelDraft} onChange={e => setLabelDraft(e.target.value)}
          onBlur={() => onRename(type.id, type.label, labelDraft)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={{ flex: 1, padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 7, background: 'var(--cream)', color: T.text, fontSize: 13, fontWeight: 600 }} />
        <span style={{ fontSize: 10.5, color: T.textFaint, whiteSpace: 'nowrap' }}>{usageCount} in use</span>
        <button onClick={() => onDelete(type.id, type.label)}
          disabled={usageCount > 0}
          title={usageCount > 0 ? 'Rename or wait until nothing uses this type before deleting' : 'Delete this type'}
          style={{ fontSize: 11, fontWeight: 700, color: usageCount > 0 ? T.textFaint : T.rose, background: usageCount > 0 ? 'var(--cream2)' : T.roseSoft, border: 'none', borderRadius: 6, padding: '5px 10px', cursor: usageCount > 0 ? 'not-allowed' : 'pointer' }}>
          Delete
        </button>
      </div>

      {type.fields.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {type.fields.map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: T.textDim }}>
              <span style={{ flex: 1 }}>{f.label}</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: T.textFaint, background: 'var(--cream2)', padding: '2px 6px', borderRadius: 4 }}>{f.kind}</span>
              <button onClick={() => removeField(f.key)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
            </div>
          ))}
        </div>
      )}

      {showFieldForm ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input autoFocus value={newFieldLabel} onChange={e => setNewFieldLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addField(); if (e.key === 'Escape') setShowFieldForm(false) }}
            placeholder="Field name, e.g. Loan Amount"
            style={{ flex: 1, padding: '6px 8px', border: `1px solid ${T.line}`, borderRadius: 6, background: 'var(--cream)', color: T.text, fontSize: 11.5 }} />
          <select value={newFieldKind} onChange={e => setNewFieldKind(e.target.value as FieldKind)}
            style={{ padding: '6px 8px', border: `1px solid ${T.line}`, borderRadius: 6, background: 'var(--cream)', color: T.text, fontSize: 11.5 }}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
          <button onClick={addField} style={{ padding: '6px 12px', fontSize: 11.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 6, cursor: 'pointer' }}>Add</button>
        </div>
      ) : (
        <button onClick={() => setShowFieldForm(true)}
          style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: T.goldText, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          + Add custom field
        </button>
      )}
    </div>
  )
}