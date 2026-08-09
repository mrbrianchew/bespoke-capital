'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard, ClientRow } from '@/contexts/DashboardContext'
import GmailClaimSearch from '@/components/GmailClaimSearch'
import { useDriveUpload } from '@/lib/useDriveUpload'
import { needsFollowupItems } from '@/lib/claimsAttention'

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
  section: 'pre' | 'in' | 'post' | null
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

interface FollowupNote {
  id: string
  line_item_id: string
  note_date: string
  text: string
  created_at: string
}

interface FollowupTodo {
  id: string
  line_item_id: string
  task: string
  due_date: string | null
  done: boolean
  created_at: string
}

interface ClaimDocRow {
  id: string
  claim_id: string
  file_name: string
  drive_file_id: string | null
  drive_view_url: string | null
  uploaded_at: string
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

// Matches SECTION_TYPE_OPTIONS on the per-client Medical Claims page exactly
// — used only for the Type dropdown inside the card edit modal.
const SECTION_TYPE_OPTIONS: Record<string, string[]> = {
  pre: ['CDL', 'Non-CDL', 'Services', 'Outpatient'],
  in: ['Inpatient', 'Surgery'],
  post: ['CDL', 'Non-CDL', 'Services', 'Outpatient'],
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

  // ── Edit-in-place modal state (opened by clicking a card) ──
  const [editingCard, setEditingCard] = useState<CardData | null>(null)
  const [modalNotes, setModalNotes] = useState<FollowupNote[]>([])
  const [modalTodos, setModalTodos] = useState<FollowupTodo[]>([])
  const [modalDocuments, setModalDocuments] = useState<ClaimDocRow[]>([])
  const [modalLoading, setModalLoading] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteDate, setNoteDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteText, setEditNoteText] = useState('')
  const [editNoteDate, setEditNoteDate] = useState('')
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null)
  const [editTodoText, setEditTodoText] = useState('')
  const [editTodoDate, setEditTodoDate] = useState('')
  const [todoDraft, setTodoDraft] = useState('')
  const [todoDueDate, setTodoDueDate] = useState('')
  const [savingModal, setSavingModal] = useState(false)
  const drive = useDriveUpload()
  const [modalFolder, setModalFolder] = useState<{ id: string; name: string } | null>(null)

  // ── Today's Follow-Ups tab ──
  // Firm-wide, cross-client view of every incomplete claim_followup_todos
  // row. Separate from the Kanban's per-card todo list (modalTodos) — this
  // is the daily action list; that's the per-claim detail. Kept in sync by
  // toggleGlobalTodoDone below, which updates both when the same todo is
  // open in the modal at the same time.
  const [activeTab, setActiveTab] = useState<'board' | 'followups'>('board')
  const [pendingTodos, setPendingTodos] = useState<FollowupTodo[]>([])

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
          .select('id, claim_id, section, type, description, invoice_no, amount_claimed, amount_approved, approved, rejected, rejection_reason, followup_status, submitted_date, date_from, updated_at')
          .in('claim_id', claimIds)
        if (cancelled) return
        const itemRows = (itemsRes.data || []) as LineItemRow[]
        setLineItems(itemRows)

        const itemIds = itemRows.map(i => i.id)
        if (itemIds.length > 0) {
          const todosRes = await supabase.from('claim_followup_todos')
            .select('*').in('line_item_id', itemIds).eq('done', false)
          if (cancelled) return
          setPendingTodos((todosRes.data || []) as FollowupTodo[])
        } else {
          setPendingTodos([])
        }
      } else {
        setLineItems([])
        setPendingTodos([])
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

  const itemsById = useMemo(() => {
    const map: Record<string, LineItemRow> = {}
    lineItems.forEach(i => { map[i.id] = i })
    return map
  }, [lineItems])

  // Same shape as a Kanban CardData, plus the todo itself — lets a row open
  // the exact same edit modal a card click would.
  const followupRows = useMemo(() => {
    return pendingTodos
      .map(todo => {
        const item = itemsById[todo.line_item_id]
        if (!item) return null
        const claim = claimsById[item.claim_id]
        if (!claim) return null
        const card: CardData = {
          item, claim,
          clientId: claim.client_id,
          clientName: clientsById[claim.client_id] || 'Unknown client',
          lifeAssuredLabel: lifeAssuredLabel(claim.client_id, claim.life_assured_person),
          policyLabel: policyLabel(claim.client_id, claim.policy_id),
        }
        return { todo, card }
      })
      .filter((r): r is { todo: FollowupTodo; card: CardData } => r !== null)
      .sort((a, b) => (a.todo.due_date || '9999-12-31').localeCompare(b.todo.due_date || '9999-12-31'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTodos, itemsById, claimsById, clientsById, familyByClient, policiesByClient])

  // Stale in-progress line items with zero open follow-ups tracked at all —
  // the case a due-date list can never show, since there's no todo row to
  // list. Surfaced as its own bucket so "nobody's chasing this" is visible
  // instead of the item just quietly not appearing anywhere.
  const needsFollowupRows = useMemo(() => {
    const flaggedIds = new Set(needsFollowupItems(lineItems, pendingTodos).map(i => i.id))
    return lineItems
      .filter(item => flaggedIds.has(item.id))
      .map(item => {
        const claim = claimsById[item.claim_id]
        if (!claim) return null
        const card: CardData = {
          item, claim,
          clientId: claim.client_id,
          clientName: clientsById[claim.client_id] || 'Unknown client',
          lifeAssuredLabel: lifeAssuredLabel(claim.client_id, claim.life_assured_person),
          policyLabel: policyLabel(claim.client_id, claim.policy_id),
        }
        return card
      })
      .filter((c): c is CardData => c !== null)
      .sort((a, b) => daysSince(b.item.submitted_date || b.item.date_from)! - daysSince(a.item.submitted_date || a.item.date_from)!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems, pendingTodos, claimsById, clientsById, familyByClient, policiesByClient])

  function dueLabel(dueDate: string | null): { text: string; kind: 'overdue' | 'today' | 'upcoming' | 'none' } {
    if (!dueDate) return { text: 'No due date', kind: 'none' }
    const d = new Date(dueDate + 'T00:00:00')
    if (isNaN(d.getTime())) return { text: 'No due date', kind: 'none' }
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
    if (diffDays < 0) return { text: `Overdue · ${Math.abs(diffDays)}d`, kind: 'overdue' }
    if (diffDays === 0) return { text: 'Due today', kind: 'today' }
    return { text: `Due ${d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`, kind: 'upcoming' }
  }

  // Splits followupRows into the two sections of the "This week" tab —
  // Overdue + due-today land in Today (most urgent first); the rest of this
  // calendar week (next 1-7 days) plus undated todos land in This Week.
  // Anything due more than 7 days out is left off this tab entirely — it'll
  // surface here once it's actually within the week. No row appears twice.
  function weekBucket(dueDate: string | null): 'today' | 'week' | 'later' {
    if (!dueDate) return 'week'
    const d = new Date(dueDate + 'T00:00:00')
    if (isNaN(d.getTime())) return 'week'
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
    if (diffDays <= 0) return 'today'
    if (diffDays <= 7) return 'week'
    return 'later'
  }

  // Marking done removes the row from this tab immediately (optimistic) and
  // keeps the per-card modal's todo list in sync if that same card happens
  // to be open at the same time.
  async function toggleGlobalTodoDone(todoId: string, done: boolean) {
    setPendingTodos(prev => done ? prev.filter(t => t.id !== todoId) : prev)
    setModalTodos(prev => prev.map(t => t.id === todoId ? { ...t, done } : t))
    const { error } = await supabase.from('claim_followup_todos').update({ done }).eq('id', todoId)
    if (error) alert('Could not update: ' + error.message)
  }

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

  // Loads notes/todos/documents for whichever card is open in the modal.
  // Re-runs whenever the open card's line item changes (i.e. whenever a
  // different card is clicked) and clears everything when the modal closes.
  useEffect(() => {
    if (!editingCard) { setModalNotes([]); setModalTodos([]); setModalDocuments([]); setModalFolder(null); return }
    let cancelled = false
    async function loadModalData() {
      setModalLoading(true)
      const [notesRes, todosRes, docsRes] = await Promise.all([
        supabase.from('claim_followup_notes').select('*').eq('line_item_id', editingCard!.item.id).order('note_date', { ascending: false }),
        supabase.from('claim_followup_todos').select('*').eq('line_item_id', editingCard!.item.id).order('created_at', { ascending: true }),
        supabase.from('claim_documents').select('id, claim_id, file_name, drive_file_id, drive_view_url, uploaded_at').eq('claim_id', editingCard!.claim.id).order('uploaded_at', { ascending: false }),
      ])
      if (cancelled) return
      setModalNotes((notesRes.data || []) as FollowupNote[])
      setModalTodos((todosRes.data || []) as FollowupTodo[])
      setModalDocuments((docsRes.data || []) as ClaimDocRow[])

      // The picked Drive folder is remembered per-client — pull it from the
      // client record already loaded in this page's `clients` array (fetched
      // with select('*'), so drive_folder_link is already present).
      const client = clients.find(c => c.id === editingCard!.clientId)
      const raw = client?.drive_folder_link as string | undefined
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          setModalFolder(parsed?.id && parsed?.name ? parsed : null)
        } catch { setModalFolder(null) }
      } else {
        setModalFolder(null)
      }
      setModalLoading(false)
    }
    loadModalData()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCard?.item.id])

  // Saves a partial patch to the open card's line item — same optimistic
  // pattern as moveItem: update local state immediately, write, alert on
  // failure. Also keeps editingCard in sync so the modal reflects the save.
  async function saveModalField(patch: Partial<LineItemRow>) {
    if (!editingCard) return
    const id = editingCard.item.id
    setSavingModal(true)
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, ...patch, updated_at: new Date().toISOString() } : i))
    setEditingCard(prev => prev ? { ...prev, item: { ...prev.item, ...patch, updated_at: new Date().toISOString() } } : prev)
    const { error } = await supabase.from('claim_line_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    setSavingModal(false)
    if (error) alert('Save failed: ' + error.message)
  }

  async function addNote() {
    if (!editingCard || !noteDraft.trim()) return
    const { data, error } = await supabase.from('claim_followup_notes')
      .insert({ line_item_id: editingCard.item.id, note_date: noteDate, text: noteDraft.trim() })
      .select().maybeSingle()
    if (error) { alert('Could not add note: ' + error.message); return }
    if (data) setModalNotes(prev => [data as FollowupNote, ...prev])
    setNoteDraft('')
  }

  async function addTodo() {
    if (!editingCard || !todoDraft.trim()) return
    const { data, error } = await supabase.from('claim_followup_todos')
      .insert({ line_item_id: editingCard.item.id, task: todoDraft.trim(), due_date: todoDueDate || null })
      .select().maybeSingle()
    if (error) { alert('Could not add to-do: ' + error.message); return }
    if (data) setModalTodos(prev => [...prev, data as FollowupTodo])
    setTodoDraft('')
    setTodoDueDate('')
  }

  async function toggleTodo(id: string, done: boolean) {
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, done } : t))
    const { error } = await supabase.from('claim_followup_todos').update({ done }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function deleteTodo(id: string) {
    setModalTodos(prev => prev.filter(t => t.id !== id))
    const { error } = await supabase.from('claim_followup_todos').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  function startEditTodo(t: FollowupTodo) {
    setEditingTodoId(t.id)
    setEditTodoText(t.task)
    setEditTodoDate(t.due_date || '')
  }

  async function saveEditTodo() {
    if (!editingTodoId || !editTodoText.trim()) return
    const id = editingTodoId
    const patch = { task: editTodoText.trim(), due_date: editTodoDate || null }
    setModalTodos(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
    setEditingTodoId(null)
    const { error } = await supabase.from('claim_followup_todos').update(patch).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  function startEditNote(n: FollowupNote) {
    setEditingNoteId(n.id)
    setEditNoteText(n.text)
    setEditNoteDate(n.note_date)
  }

  async function saveEditNote() {
    if (!editingNoteId || !editNoteText.trim()) return
    const id = editingNoteId
    const patch = { text: editNoteText.trim(), note_date: editNoteDate }
    setModalNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n))
    setEditingNoteId(null)
    const { error } = await supabase.from('claim_followup_notes').update(patch).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function deleteNote(id: string) {
    if (!window.confirm('Delete this note?')) return
    setModalNotes(prev => prev.filter(n => n.id !== id))
    const { error } = await supabase.from('claim_followup_notes').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  async function connectModalDrive() {
    if (!editingCard) return
    const folder = await drive.connectDriveForClient(editingCard.clientId)
    if (folder) setModalFolder(folder)
  }

  async function uploadModalFiles(files: FileList | File[]) {
    if (!editingCard || !modalFolder) return
    const uploaded = await drive.uploadFiles(files, editingCard.claim.id, editingCard.item.id, modalFolder)
    if (uploaded.length > 0) setModalDocuments(prev => [...uploaded, ...prev] as ClaimDocRow[])
  }

  async function deleteModalDocument(doc: ClaimDocRow) {
    const ok = await drive.deleteDocument(doc)
    if (ok) setModalDocuments(prev => prev.filter(d => d.id !== doc.id))
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

      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${T.line}` }}>
        <button onClick={() => setActiveTab('followups')} style={{
          padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          background: activeTab === 'followups' ? T.goldSoft : 'none',
          border: 'none', borderRadius: activeTab === 'followups' ? '8px 8px 0 0' : 0,
          color: activeTab === 'followups' ? T.goldText : T.textFaint,
          borderBottom: activeTab === 'followups' ? `2px solid ${T.gold}` : '2px solid transparent',
        }}>
          This week's follow-ups{(followupRows.filter(r => weekBucket(r.todo.due_date) !== 'later').length + needsFollowupRows.length) > 0 ? ` · ${followupRows.filter(r => weekBucket(r.todo.due_date) !== 'later').length + needsFollowupRows.length}` : ''}
        </button>
        <button onClick={() => setActiveTab('board')} style={{
          padding: '9px 16px', fontSize: 12.5, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer',
          color: activeTab === 'board' ? T.text : T.textFaint,
          borderBottom: activeTab === 'board' ? `2px solid ${T.gold}` : '2px solid transparent',
        }}>
          Board
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>Loading claims…</div>
      ) : activeTab === 'followups' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 620 }}>
          {followupRows.length === 0 && needsFollowupRows.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13, fontStyle: 'italic' }}>
              Nothing pending — every follow-up is checked off.
            </div>
          )}
          {(() => {
            const todayRows = followupRows.filter(r => weekBucket(r.todo.due_date) === 'today')
            const weekRows = followupRows.filter(r => weekBucket(r.todo.due_date) === 'week')
            const renderRow = ({ todo, card }: { todo: FollowupTodo; card: CardData }) => {
              const label = dueLabel(todo.due_date)
              const barColor = label.kind === 'overdue' ? T.rose : label.kind === 'today' ? T.gold : T.line
              const badgeColor = label.kind === 'overdue' ? T.rose : label.kind === 'today' ? T.goldText : T.textFaint
              const badgeBg = label.kind === 'overdue' ? T.roseSoft : label.kind === 'today' ? T.goldSoft : 'transparent'
              return (
                <div key={todo.id} onClick={() => setEditingCard(card)} style={{
                  background: 'white', border: `1px solid ${T.line}`, borderLeft: `3px solid ${barColor}`,
                  borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                }}>
                  <input type="checkbox" onClick={e => e.stopPropagation()}
                    onChange={e => toggleGlobalTodoDone(todo.id, e.target.checked)}
                    style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>
                      {card.clientName} · {card.lifeAssuredLabel !== card.clientName ? card.lifeAssuredLabel + ' · ' : ''}{SECTION_LABEL[card.item.section || 'pre']}
                    </div>
                    <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2 }}>{todo.task}</div>
                  </div>
                  <div style={{
                    fontSize: 10.5, fontWeight: label.kind === 'upcoming' || label.kind === 'none' ? 400 : 700,
                    color: badgeColor, background: badgeBg, padding: badgeBg === 'transparent' ? 0 : '3px 9px',
                    borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {label.text}
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
                      {needsFollowupRows.map(card => {
                        const days = daysSince(card.item.submitted_date || card.item.date_from)
                        return (
                          <div key={card.item.id} onClick={() => setEditingCard(card)} style={{
                            background: 'white', border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.rose}`,
                            borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>
                                {card.clientName} · {card.lifeAssuredLabel !== card.clientName ? card.lifeAssuredLabel + ' · ' : ''}{SECTION_LABEL[card.item.section || 'pre']}
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
              </>
            )
          })()}
        </div>
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
                    draggingId={draggingId} setDraggingId={setDraggingId} onCardClick={setEditingCard} />
                  <DropZoneList zone="resolved-rejected" label="Rejected" color={T.rose}
                    cards={columns.resolved.filter(c => c.item.rejected)}
                    dragOverZone={dragOverZone} setDragOverZone={setDragOverZone} onDrop={handleDrop}
                    draggingId={draggingId} setDraggingId={setDraggingId} onCardClick={setEditingCard} />
                </div>
              ) : (
                <DropZoneList zone={col.id as DropZone} cards={columns[col.id]}
                  dragOverZone={dragOverZone} setDragOverZone={setDragOverZone} onDrop={handleDrop}
                  draggingId={draggingId} setDraggingId={setDraggingId} onCardClick={setEditingCard} />
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

      {editingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}
          onClick={() => setEditingCard(null)}>
          <div style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: 'white', borderRadius: 14 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="font-serif" style={{ fontSize: 21, color: T.text }}>{editingCard.clientName}</div>
                <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>{editingCard.lifeAssuredLabel} · {editingCard.policyLabel}</div>
              </div>
              <button onClick={() => setEditingCard(null)} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
            </div>

            <div style={{ padding: '16px 24px 0' }}>
              <button onClick={() => openCard(editingCard)}
                style={{ fontSize: 11.5, fontWeight: 700, color: T.gold, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Open full claim →
              </button>
            </div>

            <ModalSection title="Claim details" subtitle={`${SECTION_LABEL[editingCard.item.section || 'in']} · opened ${editingCard.claim.opened_date}`} defaultOpen={false}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <ModalField label="Type">
                  <select value={editingCard.item.type || ''} onChange={e => saveModalField({ type: e.target.value })}
                    style={{ width: '100%', padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 13 }}>
                    <option value="">—</option>
                    {(SECTION_TYPE_OPTIONS[editingCard.item.section || 'in'] || []).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </ModalField>
                <ModalField label="Invoice / claim no.">
                  <input defaultValue={editingCard.item.invoice_no || ''} onBlur={e => saveModalField({ invoice_no: e.target.value || null })}
                    style={{ width: '100%', padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 13 }} />
                </ModalField>
                <div style={{ gridColumn: '1 / -1' }}>
                  <ModalField label="Description">
                    <input defaultValue={editingCard.item.description || ''} onBlur={e => saveModalField({ description: e.target.value || null })}
                      style={{ width: '100%', padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 13 }} />
                  </ModalField>
                </div>
                <ModalField label="Amount claimed ($)">
                  <input type="number" defaultValue={editingCard.item.amount_claimed || ''} onBlur={e => saveModalField({ amount_claimed: e.target.value === '' ? 0 : +e.target.value })}
                    style={{ width: '100%', padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 13 }} />
                </ModalField>
                {editingCard.item.approved && (
                  <ModalField label="Amount approved ($)">
                    <input type="number" defaultValue={editingCard.item.amount_approved || ''} onBlur={e => saveModalField({ amount_approved: e.target.value === '' ? 0 : +e.target.value })}
                      style={{ width: '100%', padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 13 }} />
                  </ModalField>
                )}
                {editingCard.item.rejected && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <ModalField label="Rejection reason">
                      <input defaultValue={editingCard.item.rejection_reason || ''} onBlur={e => saveModalField({ rejection_reason: e.target.value || null })}
                        style={{ width: '100%', padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 13 }} />
                    </ModalField>
                  </div>
                )}
              </div>
            </ModalSection>

            <ModalSection title="To-dos & notes" defaultOpen={true}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>To-dos</div>
              {modalTodos.length === 0 && <div style={{ fontSize: 12.5, color: T.textFaint, fontStyle: 'italic', marginBottom: 10 }}>No to-dos yet.</div>}
              {modalTodos.map(t => (
                editingTodoId === t.id ? (
                  <div key={t.id} style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
                    <input value={editTodoText} onChange={e => setEditTodoText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEditTodo() }} autoFocus
                      style={{ flex: 1, padding: '6px 8px', border: `1px solid ${T.line}`, borderRadius: 6, background: 'white', color: T.text, fontSize: 12.5 }} />
                    <input type="date" value={editTodoDate} onChange={e => setEditTodoDate(e.target.value)}
                      style={{ padding: '6px 8px', border: `1px solid ${T.line}`, borderRadius: 6, background: 'white', color: T.text, fontSize: 12 }} />
                    <button onClick={saveEditTodo} style={{ fontSize: 11.5, fontWeight: 700, color: T.emerald, background: 'none', border: 'none', cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditingTodoId(null)} style={{ fontSize: 11.5, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                  </div>
                ) : (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                    <input type="checkbox" checked={t.done} onChange={e => toggleTodo(t.id, e.target.checked)} />
                    <span style={{ flex: 1, fontSize: 13, color: t.done ? T.textFaint : T.text, textDecoration: t.done ? 'line-through' : 'none' }}>{t.task}</span>
                    {t.due_date && <span style={{ fontSize: 11, color: T.textFaint }}>{t.due_date}</span>}
                    <button onClick={() => startEditTodo(t)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>Edit</button>
                    <button onClick={() => deleteTodo(t.id)} style={{ background: 'none', border: 'none', color: T.textFaint, cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>×</button>
                  </div>
                )
              ))}
              <div style={{ fontSize: 11, color: T.textFaint, marginTop: 10, marginBottom: 5 }}>Enter to-do and deadline</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={todoDraft} onChange={e => setTodoDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
                  placeholder="e.g. Chase supporting document"
                  style={{ flex: 1, padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                <input type="date" value={todoDueDate} onChange={e => setTodoDueDate(e.target.value)}
                  style={{ padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                <button onClick={addTodo} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer' }}>Add</button>
              </div>

              <div style={{ height: 1, background: T.line, margin: '16px 0' }} />

              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>Notes</div>
              {modalNotes.length === 0 && <div style={{ fontSize: 12.5, color: T.textFaint, fontStyle: 'italic', marginBottom: 10 }}>No notes yet.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                {modalNotes.map(n => (
                  editingNoteId === n.id ? (
                    <div key={n.id} style={{ display: 'flex', gap: 6 }}>
                      <input type="date" value={editNoteDate} onChange={e => setEditNoteDate(e.target.value)}
                        style={{ padding: '6px 8px', border: `1px solid ${T.line}`, borderRadius: 6, background: 'white', color: T.text, fontSize: 12 }} />
                      <input value={editNoteText} onChange={e => setEditNoteText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEditNote() }} autoFocus
                        style={{ flex: 1, padding: '6px 8px', border: `1px solid ${T.line}`, borderRadius: 6, background: 'white', color: T.text, fontSize: 12.5 }} />
                      <button onClick={saveEditNote} style={{ fontSize: 11.5, fontWeight: 700, color: T.emerald, background: 'none', border: 'none', cursor: 'pointer' }}>Save</button>
                      <button onClick={() => setEditingNoteId(null)} style={{ fontSize: 11.5, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                    </div>
                  ) : (
                    <div key={n.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <div style={{ flex: 1, fontSize: 12.5, color: T.text }}>
                        <span style={{ color: T.textFaint, fontSize: 11 }}>{n.note_date}</span> — {n.text}
                      </div>
                      <button onClick={() => startEditNote(n)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>Edit</button>
                      <button onClick={() => deleteNote(n.id)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
                    </div>
                  )
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)}
                  style={{ padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNote() }}
                  placeholder="Add a note…"
                  style={{ flex: 1, padding: '7px 9px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
                <button onClick={addNote} style={{ padding: '7px 14px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: 'pointer' }}>Add</button>
              </div>
            </ModalSection>

            <ModalSection title="Activity — attachments, emails" defaultOpen={true}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8 }}>Attachments</div>
              {modalLoading ? (
                <div style={{ fontSize: 12.5, color: T.textFaint }}>Loading…</div>
              ) : modalDocuments.length === 0 ? (
                <div style={{ fontSize: 12.5, color: T.textFaint, fontStyle: 'italic', marginBottom: 8 }}>No attachments yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  {modalDocuments.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <a href={d.drive_view_url || '#'} target="_blank" rel="noopener noreferrer"
                        style={{ flex: 1, fontSize: 12.5, color: T.gold, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</a>
                      <button onClick={() => deleteModalDocument(d)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {drive.uploadError && <div style={{ fontSize: 11.5, color: T.rose, marginBottom: 8 }}>{drive.uploadError}</div>}

              {!modalFolder ? (
                <button onClick={connectModalDrive} disabled={drive.connecting}
                  style={{ fontSize: 12, fontWeight: 700, color: T.goldText, background: T.goldSoft, border: `1px solid rgba(168,131,74,.3)`, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', opacity: drive.connecting ? 0.6 : 1 }}>
                  {drive.connecting ? 'Connecting…' : 'Connect Drive & choose folder'}
                </button>
              ) : (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: T.goldText, background: T.goldSoft, border: `1px solid rgba(168,131,74,.3)`, padding: '6px 13px', borderRadius: 999, cursor: drive.uploading ? 'default' : 'pointer', opacity: drive.uploading ? 0.6 : 1 }}>
                  {drive.uploading ? 'Uploading…' : `Upload to ${modalFolder.name}`}
                  <input type="file" multiple disabled={drive.uploading} style={{ display: 'none' }}
                    onChange={e => { if (e.target.files?.length) uploadModalFiles(e.target.files); e.target.value = '' }} />
                </label>
              )}

              <div style={{ height: 1, background: T.line, margin: '16px 0' }} />

              <GmailClaimSearch claimId={editingCard.claim.id} defaultTerms={[editingCard.item.invoice_no].filter((v): v is string => !!v)} />
            </ModalSection>
          </div>
        </div>
      )}
    </div>
  )
}

function ModalSection({ title, subtitle, defaultOpen, children }: { title: string; subtitle?: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ padding: '16px 24px 0' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', borderTop: `1px solid ${T.line}`, textAlign: 'left' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{subtitle}</div>}
        </div>
        <span style={{ color: T.textFaint, fontSize: 13, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }}>▾</span>
      </button>
      {open && <div style={{ paddingBottom: 16 }}>{children}</div>}
    </div>
  )
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 5 }}>{label}</div>
      {children}
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