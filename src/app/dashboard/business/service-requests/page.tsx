'use client'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import GmailClaimSearch from '@/components/GmailClaimSearch'
import ServiceRequestExtras from '@/components/ServiceRequestExtras'
import { needsFollowupRequests } from '@/lib/serviceRequestsAttention'
import { logServiceResolution } from '@/lib/policyServiceHistory'
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
// Board-only view of Status: 'waiting' isn't a DB value, it's status='in_progress'
// with waiting_on set — surfaced as its own column so "actively working" and
// "blocked on someone else" don't look identical on the board. The modal's
// Status selector still only offers the 3 real Status values; ZoneId only
// governs how the board buckets and drags cards.
type ZoneId = Status | 'waiting'
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
  premiumCash: number
  premiumMedisave: number
}

// ── Premium Alerts (message templates + related lookups) ──────────────────
interface MessageTemplate {
  id: string
  context_type: string
  context_key: string
  advisor_id: string | null
  body: string
}
interface ManualPaymentMethod {
  id: string
  label: string
}
interface FamilyMemberLite {
  id: string
  client_id: string
  name: string
  relationship: string | null
  phone: string | null
}
// The two request_type labels that get the Premium Alerts treatment: their
// own board section, auto-fill from policy, and a message composer. Any
// other type (including the older single "Premium Reminder" type predating
// this feature) still goes through the generic modal untouched.
const PREMIUM_TYPES = ['Insurance Premium Reminder', 'Investment Premium Reminder'] as const
type PremiumType = typeof PREMIUM_TYPES[number]
function isPremiumType(t: string): t is PremiumType { return (PREMIUM_TYPES as readonly string[]).includes(t) }

const PREMIUM_MSG_VARIABLES: Record<PremiumType, { key: string; label: string }[]> = {
  'Insurance Premium Reminder': [
    { key: 'client_name', label: 'Addressee' },
    { key: 'company', label: 'Company' },
    { key: 'life_assured', label: 'Life Assured' },
    { key: 'plan_name', label: 'Plan Name' },
    { key: 'policy_no', label: 'Policy No.' },
    { key: 'premium_due', label: 'Premium Due' },
    { key: 'premium_cash', label: 'Premium — Cash' },
    { key: 'premium_medisave', label: 'Premium — Medisave' },
    { key: 'payment_method', label: 'Payment Method' },
    { key: 'manual_method', label: 'Manual Method' },
    { key: 'advisor_name', label: 'Advisor' },
  ],
  'Investment Premium Reminder': [
    { key: 'client_name', label: 'Addressee' },
    { key: 'company', label: 'Company' },
    { key: 'life_assured', label: 'Life Assured' },
    { key: 'plan_name', label: 'Plan Name' },
    { key: 'policy_no', label: 'Policy No.' },
    { key: 'premium_due', label: 'Premium Due' },
    { key: 'premium_amount', label: 'Premium Amount' },
    { key: 'next_giro_deduction', label: 'Next Giro Deduction' },
    { key: 'adhoc_payment_note', label: 'Adhoc Payment' },
    { key: 'advisor_name', label: 'Advisor' },
  ],
}
const PREMIUM_FALLBACK_TEMPLATES: Record<PremiumType, string> = {
  'Insurance Premium Reminder': `Hi {{client_name}},\n\nFriendly reminder of your premium payment:\n*Company:* {{company}}\n*Life Assured:* {{life_assured}}\n*Plan Name:* {{plan_name}}\n*Policy No.:* {{policy_no}}\n\nYour premium was due on {{premium_due}}.\n\n*Premium required in SGD:*\n*Cash:* {{premium_cash}}\n*Medisave:* {{premium_medisave}}\n*Payment Method:* {{payment_method}}\n\nPlease kindly make payment soon to avoid lapsation. Payment can be made via {{manual_method}}.\n\nPlease kindly take a screenshot and update me once payment has been made. Thank you 😊\n\n— {{advisor_name}}`,
  'Investment Premium Reminder': `Hi {{client_name}},\n\nHope this message finds you well! 😊\n\nThis is a friendly reminder regarding your investment deduction:\n*Company:* {{company}}\n*Plan Name:* {{plan_name}}\n*Policy/Account No.:* {{policy_no}}\n\nYour premium was due on {{premium_due}}.\n\nPlease kindly ensure sufficient funds before {{next_giro_deduction}}, or make an ad-hoc payment via {{adhoc_payment_note}}.\n\nThank you!\n\n— {{advisor_name}}`,
}
function money(n: number): string {
  if (!n) return '$0.00'
  return '$' + n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDateSG(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}
function substituteMsgVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
}
// Singapore mobile numbers are stored as bare 8-digit local numbers — prefix
// the country code for a wa.me deep link. Strips any spaces/dashes/leading
// +/0 the advisor might have typed into the Custom Number field.
function waLink(phoneRaw: string, text: string): string | null {
  const digits = phoneRaw.replace(/[^\d]/g, '').replace(/^0+/, '')
  if (digits.length < 8) return null
  const withCountry = digits.startsWith('65') && digits.length > 8 ? digits : `65${digits}`
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`
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

function columnFor(row: ServiceRequestRow): ZoneId | null {
  if (row.status === 'done') {
    const daysAgo = daysSince(row.resolved_at || row.updated_at)
    return daysAgo !== null && daysAgo <= RESOLVED_VISIBLE_DAYS ? 'done' : null // drops off the board
  }
  if (row.status === 'in_progress' && row.waiting_on) return 'waiting'
  return row.status
}

// Used only by the modal's Status selector — deliberately just the 3 real
// DB values, since waiting_on is a separate picker right below it there.
const COLUMNS: { id: Status; title: string; hint: string }[] = [
  { id: 'requested', title: 'Requested', hint: 'Not yet started' },
  { id: 'in_progress', title: 'In Progress', hint: 'Actively being worked' },
  { id: 'done', title: 'Done', hint: `Last ${RESOLVED_VISIBLE_DAYS} days` },
]

// The actual 4-column board — In Progress split by whether waiting_on is set.
const BOARD_ZONES: { id: ZoneId; title: string; hint: string }[] = [
  { id: 'requested', title: 'Requested', hint: 'Not yet started' },
  { id: 'in_progress', title: 'In Progress', hint: 'Actively being worked' },
  { id: 'waiting', title: 'Waiting', hint: 'Blocked on client or 3rd party' },
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

// SSR-safe: starts false (desktop layout), corrects on mount. Drives the
// mobile Board→List default (Aug 2026) — replaces the old one-stage-at-a-
// time mobile tab switcher with the same full stacked list Claims/New
// Business use, so switching stages doesn't cost an extra tap.
function useNarrow(breakpoint: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setNarrow(mq.matches)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpoint])
  return narrow
}

export default function BusinessServiceRequestsPage() {
  const { advisor, clients, authLoading } = useDashboard()
  const router = useRouter()
  const supabase = createClient()

  // Same two-flag gate as Claims Board — this is the same Business Dashboard
  // section, no separate beta flag introduced for this feature.
  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const narrow = useNarrow(860)
  const [boardViewOverride, setBoardViewOverride] = useState<'board' | 'list' | null>(null)
  const boardView = boardViewOverride ?? (narrow ? 'list' : 'board')

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ServiceRequestRow[]>([])
  const [pendingTodos, setPendingTodos] = useState<TodoRow[]>([]) // firm-wide, done=false — feeds the follow-ups tab, same shape as Claims Board's pendingTodos
  const [activeTab, setActiveTab] = useState<'followups' | 'board'>('followups')
  const [typeFilter, setTypeFilter] = useState<RequestType | 'all'>('all')

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

  // ── Premium Alerts: message templates + related lookups ──
  const [premiumComposerOpen, setPremiumComposerOpen] = useState(false)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [msgSequence, setMsgSequence] = useState('')
  const [msgBody, setMsgBody] = useState('')
  const [msgEdited, setMsgEdited] = useState(false)
  const [msgCopied, setMsgCopied] = useState<string | null>(null)
  const msgTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [addingSequence, setAddingSequence] = useState(false)
  const [newSequenceDraft, setNewSequenceDraft] = useState('')

  const [manualMethods, setManualMethods] = useState<ManualPaymentMethod[]>([])
  const [showManageMethods, setShowManageMethods] = useState(false)

  // Family members per client — for the "Life Assured" / "Addressing To"
  // pickers, which need names + phone numbers beyond just the client record.
  // Lazy-loaded per client, same caching pattern as policiesByClient.
  const [familyByClient, setFamilyByClient] = useState<Record<string, FamilyMemberLite[]>>({})

  const [addressingTo, setAddressingTo] = useState('') // 'client' | family_member id | 'self' | 'custom'
  const [customNumber, setCustomNumber] = useState('')

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

      // Firm-wide open to-dos, for the follow-ups tab — same two-step
      // pattern as Claims Board (fetch parent ids, then todos in() those
      // ids), since service_request_todos has no direct RLS of its own to
      // lean on for a plain select.
      const reqIds = rowsData.map(r => r.id)
      if (reqIds.length > 0) {
        const todosRes = await supabase.from('service_request_todos').select('*').in('service_request_id', reqIds).eq('done', false)
        if (cancelled) return
        setPendingTodos((todosRes.data || []) as TodoRow[])
      } else {
        setPendingTodos([])
      }

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

  const rowsById = useMemo(() => {
    const map: Record<string, ServiceRequestRow> = {}
    rows.forEach(r => { map[r.id] = r })
    return map
  }, [rows])

  // Same shape of pairing as Claims Board's followupRows — todo + the row it
  // belongs to, so a row click opens the exact same edit modal a card click
  // would. Sorted soonest-due first (undated last).
  const followupRows = useMemo(() => {
    return pendingTodos
      .map(todo => { const row = rowsById[todo.service_request_id]; return row ? { todo, row } : null })
      .filter((r): r is { todo: TodoRow; row: ServiceRequestRow } => r !== null)
      .sort((a, b) => (a.todo.due_date || '9999-12-31').localeCompare(b.todo.due_date || '9999-12-31'))
  }, [pendingTodos, rowsById])

  // Stale open requests with zero open to-dos tracking them at all — the
  // case a due-date list can never show, since there's no todo row to list.
  const needsFollowupRows = useMemo(() => needsFollowupRequests(rows, pendingTodos)
    .map(r => rowsById[r.id]).filter((r): r is ServiceRequestRow => !!r)
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()), // stalest first
    [rows, pendingTodos, rowsById])

  // Same "today / this week / next week / later" split as Claims Board —
  // anything beyond next calendar week is left off this tab entirely,
  // surfacing here once it's actually within the week. No row appears
  // twice. (Fixed Aug 2026 — the old version used a rolling 7-day window,
  // which on a Fri/Sat/Sun showed mostly-next-week items as "This week".)
  function weekBucket(dueDate: string | null): 'today' | 'week' | 'nextweek' | 'later' {
    if (!dueDate) return 'week'
    const d = new Date(dueDate + 'T00:00:00')
    if (isNaN(d.getTime())) return 'week'
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
    if (diffDays <= 0) return 'today'
    const dow = today.getDay() // 0=Sun..6=Sat
    const daysToSunday = dow === 0 ? 0 : 7 - dow
    const thisWeekEnd = new Date(today); thisWeekEnd.setDate(today.getDate() + daysToSunday)
    const nextWeekEnd = new Date(thisWeekEnd); nextWeekEnd.setDate(thisWeekEnd.getDate() + 7)
    if (d.getTime() <= thisWeekEnd.getTime()) return 'week'
    if (d.getTime() <= nextWeekEnd.getTime()) return 'nextweek'
    return 'later'
  }

  // Marking done from the follow-ups tab removes the row immediately
  // (optimistic) and keeps the per-card modal's own todo list in sync if
  // that same card happens to be open at the same time.
  async function toggleGlobalTodoDone(todoId: string, done: boolean) {
    setPendingTodos(prev => done ? prev.filter(t => t.id !== todoId) : prev)
    setModalTodos(prev => prev.map(t => t.id === todoId ? { ...t, done } : t))
    const { error } = await supabase.from('service_request_todos').update({ done }).eq('id', todoId)
    if (error) alert('Save failed: ' + error.message)
  }

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
    const buckets: Record<ZoneId, ServiceRequestRow[]> = { requested: [], in_progress: [], waiting: [], done: [] }
    filteredRows.forEach(row => {
      const col = columnFor(row)
      if (!col) return
      buckets[col].push(row)
    })
    ;(Object.keys(buckets) as ZoneId[]).forEach(col => {
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
          premiumCash: p.premiumCash || 0, premiumMedisave: p.premiumMedisave || 0,
        }))
        setPoliciesByClient(prev => ({ ...prev, [clientId]: list }))
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow?.client_id])

  // Family members for the currently-open request's client — needed for the
  // Life Assured / Addressing To pickers. Same lazy + cached pattern as
  // policiesByClient above.
  useEffect(() => {
    if (!editingRow) return
    const clientId = editingRow.client_id
    if (familyByClient[clientId]) return
    let cancelled = false
    supabase.from('family_members').select('id, client_id, name, relationship, phone').eq('client_id', clientId)
      .then(({ data }: any) => { if (!cancelled) setFamilyByClient(prev => ({ ...prev, [clientId]: (data || []) as FamilyMemberLite[] })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow?.client_id])

  // Manual payment method picklist — firm-wide, loaded once.
  useEffect(() => {
    if (!advisor) return
    supabase.from('manual_payment_methods').select('*').order('created_at', { ascending: true })
      .then(({ data }) => setManualMethods((data || []) as ManualPaymentMethod[]))
  }, [advisor?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Premium message templates — both context types loaded together, filtered
  // by context_type at read time, same table/pattern Claims Board uses.
  useEffect(() => {
    if (!advisor) return
    supabase.from('message_templates').select('*').in('context_type', ['premium_reminder_insurance', 'premium_reminder_investment'])
      .then(({ data }) => setTemplates((data || []) as MessageTemplate[]))
  }, [advisor?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (status === 'done') await logResolutionFor(id)
  }

  // Shared by moveTo and moveToZone — logs to the linked policy's Servicing
  // History when a request resolves. No-ops if the request has no policy_id.
  async function logResolutionFor(id: string) {
    const row = rows.find(r => r.id === id)
    if (!row) return
    await logServiceResolution(supabase, {
      id: row.id, client_id: row.client_id, policy_id: row.policy_id,
      policy_label: row.policy_label, request_type: row.request_type, description: row.description,
    })
  }

  // Board-only drag target. Dropping on 'waiting' doesn't change status (it's
  // still in_progress) — it sets waiting_on, defaulting to 'client' if it
  // wasn't already set (e.g. dragged straight from Requested). Dropping
  // anywhere else clears waiting_on, so a card dragged out of Waiting doesn't
  // silently stay flagged as blocked.
  async function moveToZone(id: string, zone: ZoneId) {
    const row = rows.find(r => r.id === id)
    if (!row) return
    if (zone === 'waiting') {
      await patchRow(id, { status: 'in_progress', waiting_on: row.waiting_on || 'client', resolved_at: null })
    } else {
      await patchRow(id, { status: zone, waiting_on: null, resolved_at: zone === 'done' ? new Date().toISOString() : null })
      if (zone === 'done') await logResolutionFor(id)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const { active, over } = event
    if (!over) return
    const id = active.id as string
    const zone = over.id as ZoneId
    const row = rows.find(r => r.id === id)
    if (!row || columnFor(row) === zone) return
    moveToZone(id, zone)
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
    if (data) { setModalTodos(prev => [...prev, data as TodoRow]); setPendingTodos(prev => [...prev, data as TodoRow]) }
    setTodoDraft('')
    setTodoDueDraft('')
  }

  async function toggleTodo(id: string, done: boolean) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    setPendingTodos(prev => done ? prev.filter(t => t.id !== id) : prev) // done=false re-adding isn't reconstructable locally — next firm-wide load picks it back up
    const { error } = await supabase.from('service_request_todos').update({ done }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function setTodoDueDate(id: string, due_date: string) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, due_date: due_date || null } : t))
    setPendingTodos(prev => prev.map(t => t.id === id ? { ...t, due_date: due_date || null } : t))
    const { error } = await supabase.from('service_request_todos').update({ due_date: due_date || null }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function deleteTodo(id: string) {
    setModalTodos(prev => prev.filter(t => t.id !== id))
    setPendingTodos(prev => prev.filter(t => t.id !== id))
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

  const openCount = columns.requested.length + columns.in_progress.length + columns.waiting.length
  const editingFields = editingRow ? fieldsForType(editingRow.request_type) : []
  const editingPolicy = editingRow ? resolvedPolicy(editingRow) : null

  // ── Premium Alerts derived state (only meaningful when editingRow is one
  // of the two premium types) ──
  const editingPremiumType: PremiumType | null = editingRow && isPremiumType(editingRow.request_type) ? editingRow.request_type : null
  const editingPolicyFull: PolicyLite | null = editingRow?.policy_id
    ? (policiesByClient[editingRow.client_id] || []).find(p => p.id === editingRow.policy_id) || null
    : null
  const premiumContextType = editingPremiumType === 'Investment Premium Reminder' ? 'premium_reminder_investment' : 'premium_reminder_insurance'

  // Resolves a policy's `person` key ('client', 'spouse', 'child_<family_member_id>',
  // or a raw family_member id) to a display name — same convention noted in
  // the protection module. Falls back to the raw key if nothing matches.
  function personLabelForKey(clientId: string, key: string): string {
    if (!key || key === 'client') return clientsById[clientId] || 'Client'
    const family = familyByClient[clientId] || []
    if (key.startsWith('child_')) {
      const fid = key.slice('child_'.length)
      return family.find(f => f.id === fid)?.name || key
    }
    const bySpouse = family.find(f => f.relationship === 'Spouse')
    if (key === 'spouse' && bySpouse) return bySpouse.name
    return family.find(f => f.id === key)?.name || key
  }

  // Everyone this reminder could plausibly be addressed to, each with a
  // phone number if one's on file. "Myself" only appears if the advisor has
  // set a phone; otherwise Custom Number is the only way to text yourself/a
  // PA, which is intentional — no PA account concept exists in this app yet.
  const addressingOptions: { id: string; label: string; phone: string | null }[] = editingRow ? [
    { id: 'client', label: `${clientsById[editingRow.client_id] || 'Client'} — client`, phone: clients.find(c => c.id === editingRow.client_id)?.phone || null },
    ...((familyByClient[editingRow.client_id] || []).filter(f => f.phone).map(f => ({ id: f.id, label: `${f.name} — ${f.relationship || 'family'}`, phone: f.phone }))),
    ...(advisor?.phone ? [{ id: 'self', label: `Myself — ${advisor.name || 'Advisor'}`, phone: advisor.phone }] : []),
    { id: 'custom', label: 'Custom number…', phone: null },
  ] : []
  const selectedAddressing = addressingOptions.find(a => a.id === addressingTo) || null
  const addressingPhone = addressingTo === 'custom' ? customNumber : (selectedAddressing?.phone || '')
  const addressingName = addressingTo === 'custom' ? (customNumber ? 'there' : '') : (selectedAddressing?.label.split(' — ')[0] || '')

  // Default the addressee the first time a premium modal opens: prefer the
  // life assured if they have a phone on file, else the client.
  useEffect(() => {
    if (!editingRow || !editingPremiumType) return
    if (addressingTo) return // already chosen this session
    const lifeAssuredKey = editingRow.field_values?.life_assured_override || editingPolicyFull?.person || ''
    const family = familyByClient[editingRow.client_id] || []
    const lifeAssuredFamilyMember = family.find(f => f.name === personLabelForKey(editingRow.client_id, lifeAssuredKey))
    if (lifeAssuredFamilyMember?.phone) setAddressingTo(lifeAssuredFamilyMember.id)
    else setAddressingTo('client')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow?.id, editingPolicyFull, Object.keys(familyByClient).length])
  // Reset per-modal composer state when switching cards.
  useEffect(() => {
    setAddressingTo(''); setCustomNumber(''); setPremiumComposerOpen(false); setMsgEdited(false); setMsgSequence(''); setMsgBody('')
  }, [editingId])

  const sequenceOptions = Array.from(new Set(
    templates.filter(t => t.context_type === premiumContextType).map(t => t.context_key)
  )).filter(Boolean)
  if (editingPremiumType === 'Insurance Premium Reminder' && sequenceOptions.length === 0) sequenceOptions.push('Missed Premium (within Grace Period)')

  function templateBodyForSequence(key: string): string {
    if (!editingPremiumType) return ''
    const personal = templates.find(t => t.context_type === premiumContextType && t.context_key === key && t.advisor_id === advisor?.id)
    if (personal) return personal.body
    const def = templates.find(t => t.context_type === premiumContextType && t.context_key === key && t.advisor_id === null)
    if (def) return def.body
    return PREMIUM_FALLBACK_TEMPLATES[editingPremiumType] || ''
  }
  function loadSequence(key: string) {
    setMsgSequence(key)
    setMsgBody(templateBodyForSequence(key))
    setMsgEdited(false)
  }
  useEffect(() => {
    if (premiumComposerOpen && editingPremiumType && !msgSequence) {
      loadSequence(editingRow?.field_values?.sequence || sequenceOptions[0] || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premiumComposerOpen, editingId])

  async function confirmAddSequence() {
    const label = newSequenceDraft.trim()
    if (!label || !editingRow) return
    loadSequence(label)
    setFieldValue(editingRow, 'sequence', label)
    setAddingSequence(false)
    setNewSequenceDraft('')
  }

  async function upsertPremiumTemplate(advisorIdForRow: string | null) {
    if (!editingPremiumType || !msgSequence) return
    const existing = templates.find(t => t.context_type === premiumContextType && t.context_key === msgSequence && t.advisor_id === advisorIdForRow)
    if (existing) {
      setTemplates(prev => prev.map(t => t.id === existing.id ? { ...t, body: msgBody } : t))
      await supabase.from('message_templates').update({ body: msgBody, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      const { data } = await supabase.from('message_templates')
        .insert({ context_type: premiumContextType, context_key: msgSequence, advisor_id: advisorIdForRow, body: msgBody })
        .select().maybeSingle()
      if (data) setTemplates(prev => [...prev, data as MessageTemplate])
    }
    setMsgEdited(false)
  }

  function insertMsgVariable(key: string) {
    const token = `{{${key}}}`
    const el = msgTextareaRef.current
    if (!el) { setMsgBody(prev => prev + token); setMsgEdited(true); return }
    const start = el.selectionStart ?? msgBody.length
    const end = el.selectionEnd ?? msgBody.length
    const next = msgBody.slice(0, start) + token + msgBody.slice(end)
    setMsgBody(next)
    setMsgEdited(true)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length })
  }

  const msgVars: Record<string, string> = editingRow && editingPremiumType ? (() => {
    const fv = editingRow.field_values || {}
    const lifeAssuredKey = fv.life_assured_override || editingPolicyFull?.person || ''
    const base = {
      client_name: addressingName || clientsById[editingRow.client_id] || 'there',
      company: editingPolicyFull?.companyName || '—',
      life_assured: lifeAssuredKey ? personLabelForKey(editingRow.client_id, lifeAssuredKey) : '—',
      plan_name: editingPolicyFull?.productName || '—',
      policy_no: editingPolicyFull?.policyNo || '—',
      premium_due: fmtDateSG(fv.premium_due_date),
      advisor_name: advisor?.name || '',
    }
    if (editingPremiumType === 'Insurance Premium Reminder') {
      return {
        ...base,
        premium_cash: fv.premium_cash_override || money(editingPolicyFull?.premiumCash || 0),
        premium_medisave: fv.premium_medisave_override || money(editingPolicyFull?.premiumMedisave || 0),
        payment_method: fv.payment_method || '—',
        manual_method: fv.manual_method || '—',
      }
    }
    return {
      ...base,
      premium_amount: fv.premium_amount_override || money(editingPolicyFull?.premiumCash || 0),
      next_giro_deduction: fmtDateSG(fv.next_giro_deduction),
      adhoc_payment_note: fv.adhoc_payment_note || '—',
    }
  })() : {}
  const msgPreview = substituteMsgVars(msgBody, msgVars)

  function copyMsg(forWhatsApp: boolean) {
    if (navigator.clipboard) navigator.clipboard.writeText(msgPreview)
    setMsgCopied(forWhatsApp ? 'whatsapp' : 'plain')
    setTimeout(() => setMsgCopied(null), 1800)
  }
  const premiumWaLink = addressingPhone ? waLink(addressingPhone, msgPreview) : null

  async function addManualMethod(label: string) {
    const clean = label.trim()
    if (!clean) return
    const { data } = await supabase.from('manual_payment_methods').insert({ label: clean }).select().maybeSingle()
    if (data) setManualMethods(prev => [...prev, data as ManualPaymentMethod])
  }
  async function renameManualMethod(id: string, label: string) {
    const clean = label.trim()
    if (!clean) return
    setManualMethods(prev => prev.map(m => m.id === id ? { ...m, label: clean } : m))
    await supabase.from('manual_payment_methods').update({ label: clean }).eq('id', id)
  }
  async function deleteManualMethod(id: string) {
    setManualMethods(prev => prev.filter(m => m.id !== id))
    await supabase.from('manual_payment_methods').delete().eq('id', id)
  }

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

      {/* ── tabs — same shape as Claims Board's ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${T.line}` }}>
        <button onClick={() => setActiveTab('followups')} style={{
          padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          background: activeTab === 'followups' ? T.goldSoft : 'none',
          border: 'none', borderRadius: activeTab === 'followups' ? '8px 8px 0 0' : 0,
          color: activeTab === 'followups' ? T.goldText : T.textFaint,
          borderBottom: activeTab === 'followups' ? `2px solid ${T.gold}` : '2px solid transparent',
        }}>
          Upcoming follow-ups{(followupRows.filter(r => weekBucket(r.todo.due_date) !== 'later').length + needsFollowupRows.length) > 0 ? ` · ${followupRows.filter(r => weekBucket(r.todo.due_date) !== 'later').length + needsFollowupRows.length}` : ''}
        </button>
        <button onClick={() => setActiveTab('board')} style={{
          padding: '9px 16px', fontSize: 12.5, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer',
          color: activeTab === 'board' ? T.text : T.textFaint,
          borderBottom: activeTab === 'board' ? `2px solid ${T.gold}` : '2px solid transparent',
        }}>
          Board
        </button>
      </div>

      {!loading && activeTab === 'followups' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 620 }}>
          {followupRows.length === 0 && needsFollowupRows.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13, fontStyle: 'italic' }}>
              Nothing pending — every follow-up is checked off.
            </div>
          )}
          {(() => {
            const todayRows = followupRows.filter(r => weekBucket(r.todo.due_date) === 'today')
            const weekRows = followupRows.filter(r => weekBucket(r.todo.due_date) === 'week')
            const nextWeekRows = followupRows.filter(r => weekBucket(r.todo.due_date) === 'nextweek')
            const renderRow = ({ todo, row }: { todo: TodoRow; row: ServiceRequestRow }) => {
              const label = dueLabel(todo.due_date)
              const barColor = label.kind === 'overdue' ? T.rose : label.kind === 'today' ? T.gold : T.line
              const badgeColor = label.kind === 'overdue' ? T.rose : label.kind === 'today' ? T.goldText : T.textFaint
              const badgeBg = label.kind === 'overdue' ? T.roseSoft : label.kind === 'today' ? T.goldSoft : 'transparent'
              return (
                <div key={todo.id} onClick={() => setEditingId(row.id)} style={{
                  background: 'white', border: `1px solid ${T.line}`, borderLeft: `3px solid ${barColor}`,
                  borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                }}>
                  <input type="checkbox" onClick={e => e.stopPropagation()}
                    onChange={e => toggleGlobalTodoDone(todo.id, e.target.checked)}
                    style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>
                      {clientsById[row.client_id] || 'Unknown client'} · {row.request_type}
                    </div>
                    <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2 }}>{todo.text}</div>
                  </div>
                  <div style={{
                    fontSize: 10.5, fontWeight: label.kind === 'upcoming' || label.kind === 'none' ? 400 : 700,
                    color: badgeColor, background: badgeBg, padding: badgeBg === 'transparent' ? 0 : '3px 9px',
                    borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {label.text || 'No due date'}
                  </div>
                </div>
              )
            }
            return (
              <>
                {todayRows.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>
                      Today · {todayRows.length}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {todayRows.map(renderRow)}
                    </div>
                  </div>
                )}
                {needsFollowupRows.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.rose, marginBottom: 3 }}>
                      Needs a follow-up · {needsFollowupRows.length}
                    </div>
                    <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 8 }}>
                      Idle 14+ days with nothing being tracked to chase it — set a reminder or update its stage.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {needsFollowupRows.map(row => {
                        const days = daysSince(row.updated_at)
                        return (
                          <div key={row.id} onClick={() => setEditingId(row.id)} style={{
                            background: 'white', border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.rose}`,
                            borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>
                                {clientsById[row.client_id] || 'Unknown client'} · {row.request_type}
                              </div>
                              <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2, fontStyle: 'italic' }}>No follow-up set</div>
                            </div>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: T.rose, background: T.roseSoft, padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {days}d idle
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {weekRows.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>
                      This week · {weekRows.length}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {weekRows.map(renderRow)}
                    </div>
                  </div>
                )}
                {nextWeekRows.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>
                      Next week · {nextWeekRows.length}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {nextWeekRows.map(renderRow)}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {activeTab === 'board' && (
      <>
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
        <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>All types{openCount > 0 ? ` (${openCount})` : ''}</FilterChip>
        {typeOptions.map(t => {
          const openForType = rows.filter(r => r.request_type === t && r.status !== 'done').length
          return (
            <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{t}{openForType > 0 ? ` (${openForType})` : ''}</FilterChip>
          )
        })}
        <button onClick={() => setShowManageTypes(true)}
          style={{ marginLeft: 4, padding: '6px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px dashed ${T.textFaint}`, background: 'none', color: T.textFaint }}>
          ⚙ Manage types
        </button>
      </div>

      {/* ── Premium Alerts — separate from the generic Kanban, own visual
          treatment. Open ones only; closed alerts just live in the normal
          board/list once marked Done, same as everything else. ── */}
      {!loading && (() => {
        const premiumRows = rows.filter(r => isPremiumType(r.request_type) && r.status !== 'done')
          .sort((a, b) => (a.field_values?.premium_due_date || '9999-12-31').localeCompare(b.field_values?.premium_due_date || '9999-12-31'))
        if (premiumRows.length === 0) return null
        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 8, height: 8, borderRadius: 999, background: T.rose }} />
              <div className="font-serif" style={{ fontSize: 19, fontWeight: 600, color: T.text }}>Premium Alerts</div>
              <div style={{ fontSize: 11, color: T.textFaint }}>— {premiumRows.length} open</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 620 }}>
              {premiumRows.map(row => {
                const policy = resolvedPolicy(row)
                const due = row.field_values?.premium_due_date
                return (
                  <div key={row.id} onClick={() => setEditingId(row.id)}
                    style={{ background: 'white', border: `1px solid ${T.roseSoft}`, borderLeft: `3px solid ${T.rose}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div className="font-serif" style={{ fontSize: 16.5, fontWeight: 600, color: T.text }}>{clientsById[row.client_id] || 'Unknown client'}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: T.roseSoft, color: T.rose }}>
                        {row.request_type === 'Investment Premium Reminder' ? 'Investment' : 'Insurance'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 4 }}>{policy?.label || 'No policy attached'}</div>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: T.rose, marginTop: 6, fontWeight: 500 }}>
                      {row.field_values?.sequence || 'Reminder'}{due ? ` · due ${fmtDateSG(due)}` : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>Loading service requests…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--cream2)', border: `1px solid ${T.line}`, borderRadius: 8, padding: 3, maxWidth: 220 }}>
            {(['list', 'board'] as const).map(v => (
              <button key={v} onClick={() => setBoardViewOverride(v)} style={{
                flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600, padding: '6px 0', border: 'none',
                borderRadius: 5, cursor: 'pointer', color: boardView === v ? T.text : T.textFaint,
                background: boardView === v ? '#fff' : 'none', boxShadow: boardView === v ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}>
                {v === 'list' ? 'List' : 'Board'}
              </button>
            ))}
          </div>

          {boardView === 'list' ? (
            <div style={{ maxWidth: 620 }}>
              {BOARD_ZONES.map(col => (
                <div key={col.id} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>
                    <span>{col.title}</span>
                    <span style={{ background: 'var(--cream2)', color: T.textDim, borderRadius: 10, padding: '1px 8px', fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>{columns[col.id].length}</span>
                  </div>
                  {columns[col.id].length === 0 ? (
                    <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic', padding: '4px 2px' }}>Nothing here</div>
                  ) : columns[col.id].map(row => (
                    <RequestCard key={row.id} row={row} clientName={clientsById[row.client_id] || 'Unknown client'}
                      policyLabel={resolvedPolicy(row)?.label || null}
                      dragging={false} onClick={() => setEditingId(row.id)} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
              <DndContext sensors={dndSensors} onDragStart={e => setDraggingId(e.active.id as string)} onDragEnd={handleDragEnd}>
                {BOARD_ZONES.map(col => (
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
          )}
        </>
      )}
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

              {editingPremiumType ? (
                <>
                  <SectionLabel>Who</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <FieldLabel>Life Assured</FieldLabel>
                      <select value={editingRow.field_values?.life_assured_override || editingPolicyFull?.person || 'client'}
                        onChange={e => setFieldValue(editingRow, 'life_assured_override', e.target.value)}
                        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                        <option value="client">{clientsById[editingRow.client_id] || 'Client'} (client)</option>
                        {(familyByClient[editingRow.client_id] || []).map(f => (
                          <option key={f.id} value={f.id}>{f.name}{f.relationship ? ` (${f.relationship})` : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Addressing To (recipient)</FieldLabel>
                      <select value={addressingTo} onChange={e => setAddressingTo(e.target.value)}
                        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                        {addressingOptions.map(o => <option key={o.id} value={o.id}>{o.label}{o.phone ? ` — ${o.phone}` : ''}</option>)}
                      </select>
                      {addressingTo === 'custom' && (
                        <input value={customNumber} onChange={e => setCustomNumber(e.target.value)} placeholder="e.g. 91234567 (PA, referral, anyone else)"
                          style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5, marginTop: 6 }} />
                      )}
                    </div>
                  </div>

                  <SectionLabel>From policy on file</SectionLabel>
                  {editingPolicyFull ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', background: 'var(--cream2)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>
                      <div><span style={{ color: T.textFaint, fontSize: 10 }}>Company</span><div style={{ fontWeight: 600 }}>{editingPolicyFull.companyName || '—'}</div></div>
                      <div><span style={{ color: T.textFaint, fontSize: 10 }}>Plan Name</span><div style={{ fontWeight: 600 }}>{editingPolicyFull.productName || '—'}</div></div>
                      <div><span style={{ color: T.textFaint, fontSize: 10 }}>Policy No.</span><div style={{ fontWeight: 600 }}>{editingPolicyFull.policyNo || '—'}</div></div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>Select a policy above to auto-fill company / plan / policy no.</div>
                  )}

                  <SectionLabel>This reminder</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <FieldLabel>Premium Due Date</FieldLabel>
                      <input type="date" defaultValue={editingRow.field_values?.premium_due_date || ''} onBlur={e => setFieldValue(editingRow, 'premium_due_date', e.target.value)}
                        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                    </div>

                    {editingPremiumType === 'Insurance Premium Reminder' ? (
                      <>
                        <div>
                          <FieldLabel>Payment Method</FieldLabel>
                          <input defaultValue={editingRow.field_values?.payment_method || ''} onBlur={e => setFieldValue(editingRow, 'payment_method', e.target.value)}
                            style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                        </div>
                        <div>
                          <FieldLabel>Premium — Cash <span style={{ fontWeight: 400, color: T.textFaint }}>(from policy, editable)</span></FieldLabel>
                          <input defaultValue={editingRow.field_values?.premium_cash_override || (editingPolicyFull ? money(editingPolicyFull.premiumCash) : '')}
                            onBlur={e => setFieldValue(editingRow, 'premium_cash_override', e.target.value)}
                            style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                        </div>
                        <div>
                          <FieldLabel>Premium — Medisave <span style={{ fontWeight: 400, color: T.textFaint }}>(from policy, editable)</span></FieldLabel>
                          <input defaultValue={editingRow.field_values?.premium_medisave_override || (editingPolicyFull ? money(editingPolicyFull.premiumMedisave) : '')}
                            onBlur={e => setFieldValue(editingRow, 'premium_medisave_override', e.target.value)}
                            style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                          <FieldLabel>Manual Method</FieldLabel>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select value={editingRow.field_values?.manual_method || ''} onChange={e => setFieldValue(editingRow, 'manual_method', e.target.value)}
                              style={{ flex: 1, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                              <option value="">Select…</option>
                              {manualMethods.map(m => <option key={m.id} value={m.label}>{m.label}</option>)}
                            </select>
                            <button onClick={() => setShowManageMethods(true)}
                              style={{ padding: '0 12px', fontSize: 12, fontWeight: 700, border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.textDim, cursor: 'pointer' }}>⚙ Manage</button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <FieldLabel>Next Giro Deduction</FieldLabel>
                          <input type="date" defaultValue={editingRow.field_values?.next_giro_deduction || ''} onBlur={e => setFieldValue(editingRow, 'next_giro_deduction', e.target.value)}
                            style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                        </div>
                        <div>
                          <FieldLabel>Premium Amount <span style={{ fontWeight: 400, color: T.textFaint }}>(from policy, editable)</span></FieldLabel>
                          <input defaultValue={editingRow.field_values?.premium_amount_override || (editingPolicyFull ? money(editingPolicyFull.premiumCash) : '')}
                            onBlur={e => setFieldValue(editingRow, 'premium_amount_override', e.target.value)}
                            style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                        </div>
                        <div style={{ gridColumn: '1/-1' }}>
                          <FieldLabel>Adhoc Payment</FieldLabel>
                          <input defaultValue={editingRow.field_values?.adhoc_payment_note || ''} onBlur={e => setFieldValue(editingRow, 'adhoc_payment_note', e.target.value)}
                            placeholder="e.g. Email Link"
                            style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                        </div>
                      </>
                    )}
                  </div>

                  {/* ── Message composer ── */}
                  <button onClick={() => setPremiumComposerOpen(o => !o)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', borderTop: `1px solid ${T.line}`, marginTop: 16, textAlign: 'left' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>Draft a reminder message</div>
                    <span style={{ color: T.textFaint, fontSize: 13, transform: premiumComposerOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
                  </button>
                  {premiumComposerOpen && (
                    <div style={{ background: 'var(--cream)', border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, marginTop: 4 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                        <FieldLabel>Sequence</FieldLabel>
                        {!addingSequence ? (
                          <select value={msgSequence} onChange={e => { if (e.target.value === '__add') { setAddingSequence(true) } else { loadSequence(e.target.value); setFieldValue(editingRow, 'sequence', e.target.value) } }}
                            style={{ width: 260, padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }}>
                            {sequenceOptions.map(s => <option key={s} value={s}>{s}</option>)}
                            <option value="__add" style={{ fontWeight: 700, color: T.gold }}>+ Add new sequence…</option>
                          </select>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input autoFocus value={newSequenceDraft} onChange={e => setNewSequenceDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmAddSequence(); if (e.key === 'Escape') setAddingSequence(false) }}
                              placeholder="e.g. Policy Lapsed" style={{ padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 12.5 }} />
                            <button onClick={confirmAddSequence} style={{ padding: '6px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 8, border: 'none', background: T.gold, color: 'var(--charcoal)', cursor: 'pointer' }}>Add</button>
                            <button onClick={() => setAddingSequence(false)} style={{ padding: '6px 10px', fontSize: 11.5, fontWeight: 700, borderRadius: 8, border: `1px solid ${T.line}`, background: 'white', cursor: 'pointer' }}>Cancel</button>
                          </div>
                        )}
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: msgEdited ? T.gold : T.textFaint }}>
                          ● {msgEdited ? 'Edited — no longer matches default' : 'Using default template'}
                        </span>
                      </div>

                      <FieldLabel>Template (edit freely — variables below insert at cursor)</FieldLabel>
                      <textarea ref={msgTextareaRef} value={msgBody} onChange={e => { setMsgBody(e.target.value); setMsgEdited(true) }}
                        style={{ width: '100%', minHeight: 140, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }} />

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {PREMIUM_MSG_VARIABLES[editingPremiumType].map(v => (
                          <button key={v.key} onClick={() => insertMsgVariable(v.key)}
                            style={{ fontSize: 10.5, fontWeight: 700, color: T.goldText, background: T.goldSoft, border: `1px solid rgba(231,188,114,.3)`, padding: '4px 10px', borderRadius: 999, cursor: 'pointer' }}>
                            + {v.label}
                          </button>
                        ))}
                      </div>

                      <div style={{ marginTop: 14 }}><FieldLabel>Preview (this is what gets sent)</FieldLabel></div>
                      <div style={{ whiteSpace: 'pre-wrap', minHeight: 60, lineHeight: 1.5, background: 'var(--cream2)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginTop: 4 }}>{msgPreview}</div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                        <button onClick={() => loadSequence(msgSequence)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, border: `1px solid ${T.line}`, background: 'white', color: T.textDim, cursor: 'pointer' }}>Reset</button>
                        <button onClick={() => upsertPremiumTemplate(advisor?.id || null)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, border: `1px solid ${T.line}`, background: 'white', color: T.textDim, cursor: 'pointer' }}>Save as My Default</button>
                        {advisor?.id === CREATOR_ID && (
                          <button onClick={() => upsertPremiumTemplate(null)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, border: '1px solid rgba(138,40,40,.3)', background: T.roseSoft, color: T.rose, cursor: 'pointer' }}>Save as Admin Default</button>
                        )}
                        <button onClick={() => copyMsg(false)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, border: `1px solid ${T.line}`, background: 'white', color: T.textDim, cursor: 'pointer', marginLeft: 'auto' }}>{msgCopied === 'plain' ? 'Copied!' : 'Copy'}</button>
                        <button onClick={() => copyMsg(true)} style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, border: 'none', background: 'var(--gold)', color: 'var(--charcoal)', cursor: 'pointer' }}>{msgCopied === 'whatsapp' ? 'Copied!' : 'Copy for WhatsApp'}</button>
                        {premiumWaLink ? (
                          <a href={premiumWaLink} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: 8, border: 'none', background: '#25D366', color: 'white', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                            Click to Send WhatsApp →
                          </a>
                        ) : (
                          <span style={{ fontSize: 11, color: T.textFaint, alignSelf: 'center' }}>No phone number for recipient — pick one above or Copy instead.</span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : editingFields.length > 0 && (
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

              <ModalSection title="Attachments, meetings, activity" defaultOpen={true}>
                <ServiceRequestExtras serviceRequestId={editingRow.id} clientId={editingRow.client_id} />
              </ModalSection>

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

      {/* ── manage manual payment methods modal ── */}
      {showManageMethods && (
        <div onClick={() => setShowManageMethods(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(26,24,22,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 220 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'white', borderRadius: 14, padding: '20px 22px' }}>
            <div className="font-serif" style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>Manual Payment Methods</div>
            <div style={{ fontSize: 11.5, color: T.textFaint, marginBottom: 14 }}>Shared firm-wide — used across all Insurance Premium Reminders.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {manualMethods.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input defaultValue={m.label} onBlur={e => e.target.value.trim() !== m.label && renameManualMethod(m.id, e.target.value)}
                    style={{ flex: 1, padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                  <button onClick={() => deleteManualMethod(m.id)}
                    style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 6, background: T.roseSoft, color: T.rose, cursor: 'pointer' }}>Delete</button>
                </div>
              ))}
              {manualMethods.length === 0 && <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No methods yet.</div>}
            </div>
            <NewMethodRow onAdd={addManualMethod} />
            <button onClick={() => setShowManageMethods(false)}
              style={{ marginTop: 16, width: '100%', padding: '9px 0', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function NewMethodRow({ onAdd }: { onAdd: (label: string) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
      <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { onAdd(draft); setDraft('') } }}
        placeholder="New method…" style={{ flex: 1, padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--cream)', fontSize: 12.5 }} />
      <button onClick={() => { if (draft.trim()) { onAdd(draft); setDraft('') } }}
        style={{ padding: '7px 14px', fontSize: 11.5, fontWeight: 700, border: '1px solid rgba(138,40,40,.3)', borderRadius: 8, background: 'var(--rouge-l)', color: 'var(--rouge)', cursor: 'pointer' }}>
        + Add
      </button>
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

function DropZone({ id, children }: { id: ZoneId; children: React.ReactNode }) {
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
        {row.status === 'done' ? (
          <span className="font-mono">Completed {daysSince(row.resolved_at) ?? 0}d ago</span>
        ) : days !== null ? (
          <span className="font-mono" style={{
            fontWeight: days >= 7 ? 700 : 400,
            padding: days >= 7 ? '2px 7px' : 0,
            borderRadius: days >= 7 ? 5 : 0,
            background: days >= 14 ? T.roseSoft : days >= 7 ? T.goldSoft : 'transparent',
            color: days >= 14 ? T.rose : days >= 7 ? T.goldText : T.textFaint,
          }}>{days}d old</span>
        ) : <span />}
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