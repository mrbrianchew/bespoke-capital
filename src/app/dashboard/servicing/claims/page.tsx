'use client'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import DateInput from '@/components/DateInput'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Retheme (Aug 2026): this page previously ran a deliberately separate dark
// "void" theme (Instrument Serif / IBM Plex Mono, near-black background).
// That's gone — it now uses the same Cormorant/Inter/DM Mono + cream/charcoal
// design system as the rest of the app (see globals.css). The T token object
// below is kept as a single indirection layer so the ~1400 lines of styling
// that reference T.xxx didn't all need touching individually — only the
// palette definitions at the bottom of this file changed.

// ─── TYPES ──────────────────────────────────────────────────────────────────

// Slim view of the real Policy shape from fact_finding.protection_portfolio —
// only the fields Claims needs. Policies are NOT owned by this page; they're
// read-only here (edited on the Protection page).
interface PolicyLite {
  id: string
  categoryCode: string
  policyTypeCode: string
  companyName: string
  productName: string
  policyholder: string
  lifeAssured: string
  policyNo: string
  person: string
  inceptionDate?: string
}

interface ClaimRow {
  id: string
  client_id: string
  policy_id: string
  life_assured_person: string
  label: string | null
  status: 'open' | 'closed' | 'withdrawn'
  opened_date: string
  panel_status: 'panel' | 'non_panel'
  // deductible_amount / coinsurance_cap_annual columns exist on this table
  // but are unused — the real deductible/co-insurance-cap terms live on
  // policy_year_terms (per policy, per policy year, per panel_status).
  deductible_amount: number
  coinsurance_cap_annual: number
  created_at: string
  updated_at: string
}

interface LineItemRow {
  id: string
  claim_id: string
  section: 'pre' | 'in' | 'post'
  type: string | null
  date_from: string | null
  date_to: string | null
  description: string | null
  invoice_no: string | null
  amount_claimed: number
  submitted_date: string | null
  approved: boolean
  date_approved: string | null
  amount_approved: number
  deductible_clocked: number
  coinsurance_clocked: number
  remarks: string | null
  followup_status: string | null
}

interface FollowupNote {
  id: string
  line_item_id: string
  text: string
  note_date: string
  created_at: string
}

interface ClaimDocument {
  id: string
  claim_id: string
  line_item_id: string | null
  file_name: string
  mime_type: string | null
  file_size: number | null
  drive_file_id: string | null
  drive_view_url: string | null
  uploaded_at: string
}

interface MessageTemplate {
  id: string
  context_type: string
  context_key: string
  advisor_id: string | null
  body: string
}

// Generalized on purpose — context_type is 'claim_status' today, but the
// same table/lookup/composer pattern is meant to be reused by other parts
// of the app later (renewal reminders, review nudges, etc.) rather than
// each building its own template system.
const CLAIM_MSG_TRIGGERS: { key: string; label: string }[] = [
  { key: 'submitted', label: 'Claim Submitted' },
  { key: 'approved', label: 'Claim Approved' },
  { key: 'partial', label: 'Partially Approved' },
  { key: 'docs', label: 'Additional Documents Needed' },
  { key: 'paid', label: 'Payment Received' },
]
const MSG_VARIABLES: { key: string; label: string }[] = [
  { key: 'client_name', label: 'Client' },
  { key: 'policy_number', label: 'Policy No.' },
  { key: 'insurer', label: 'Insurer' },
  { key: 'amount_claimed', label: 'Claimed' },
  { key: 'amount_approved', label: 'Approved' },
  { key: 'approval_pct', label: 'Approval %' },
  { key: 'status_badge', label: 'Status' },
  { key: 'advisor_name', label: 'Advisor' },
  { key: 'procedure_description', label: 'Procedure' },
]
const FALLBACK_MSG_TEMPLATES: Record<string, string> = {
  submitted: `Hi {{client_name}}, your claim has been submitted to {{insurer}} (Policy {{policy_number}}). Total amount claimed: {{amount_claimed}}. We'll update you as soon as there's movement.\n\n— {{advisor_name}}`,
  approved: `Good news, {{client_name}}! Your claim has been approved.\n\nApproved amount: {{amount_approved}} of {{amount_claimed}} claimed ({{approval_pct}}).\n\n— {{advisor_name}}`,
  partial: `Hi {{client_name}}, {{insurer}} has partially approved your claim. Approved: {{amount_approved}} of {{amount_claimed}} claimed. Happy to walk you through the breakdown if useful.\n\n— {{advisor_name}}`,
  docs: `Hi {{client_name}}, {{insurer}} has requested additional documents for your claim ({{procedure_description}}). Could you send these over when you have a chance?\n\n— {{advisor_name}}`,
  paid: `Hi {{client_name}}, your claim payout of {{amount_approved}} has been credited. Claim closed on our end.\n\n— {{advisor_name}}`,
}
function substituteMsgVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
}

const SECTION_LABEL: Record<string, string> = { pre: 'Pre-Hospitalisation', in: 'Inpatient / Surgery', post: 'Post-Hospitalisation' }
const SECTION_SUB: Record<string, string> = { pre: 'Outpatient claims before admission', in: 'Hospitalisation & surgery claims', post: 'Follow-up outpatient claims' }
const SECTION_TYPE_OPTIONS: Record<string, string[]> = {
  pre: ['CDL', 'Non-CDL', 'Services', 'Outpatient'],
  in: ['Inpatient', 'Surgery'],
  post: ['CDL', 'Non-CDL', 'Services', 'Outpatient'],
}
// Pre and Post share the same claim types (both outpatient-style CDL/Non-CDL/
// Services/Outpatient claims) so they're told apart by a subtly different
// accent rather than color-coding the type itself. Inpatient/Surgery keeps
// the original gold since it's the section everything else is styled around.
const SECTION_ACCENT: Record<string, { text: string; soft: string }> = {
  pre: { text: '#8A6C3A', soft: 'rgba(168,131,74,.12)' },    // gold-tag
  in: { text: '#8A6C3A', soft: 'rgba(168,131,74,.12)' },     // gold-tag
  post: { text: '#8A5A3A', soft: 'rgba(168,102,58,.12)' },   // muted copper — same warm family as gold, distinct at a glance
}

function money(n: number | null | undefined) {
  return '$' + (n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short' })
}
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}
function fmtFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
interface PolicyYearTerm {
  id: string
  client_id: string
  policy_id: string
  year_start: string
  year_end: string
  panel_deductible_amount: number
  panel_coinsurance_cap_annual: number
  // Null = uncapped / not applicable for Non-Panel on this policy — the
  // common case. Some policies do cap Non-Panel, so it's still editable.
  non_panel_deductible_amount: number | null
  non_panel_coinsurance_cap_annual: number | null
}

const PANEL_STATUS_LABEL: Record<'panel' | 'non_panel', string> = { panel: 'Panel', non_panel: 'Non-Panel' }

// Medical plan years reset on the policy's inception anniversary (month/day),
// independent of premium payment frequency. Returns the [start,end] window
// (both ISO date strings) containing `forDateIso`.
function getPolicyYearWindow(inceptionDateIso: string, forDateIso: string): { start: string; end: string } {
  const inc = new Date(inceptionDateIso)
  const forDate = new Date(forDateIso)
  let year = forDate.getFullYear()
  let start = new Date(year, inc.getMonth(), inc.getDate())
  if (start.getTime() > forDate.getTime()) {
    year -= 1
    start = new Date(year, inc.getMonth(), inc.getDate())
  }
  const end = new Date(start)
  end.setFullYear(end.getFullYear() + 1)
  end.setDate(end.getDate() - 1)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}
function fmtYearRange(start: string, end: string) {
  return `${fmtDate(start)} – ${fmtDate(end)}`
}
function newLineItem(claimId: string, section: 'pre' | 'in' | 'post'): Omit<LineItemRow, 'id'> {
  return {
    claim_id: claimId, section, type: section === 'in' ? 'Surgery' : 'Outpatient',
    date_from: null, date_to: null, description: '', invoice_no: '',
    amount_claimed: 0, submitted_date: null, approved: false, date_approved: null,
    amount_approved: 0, deductible_clocked: 0, coinsurance_clocked: 0, remarks: '',
  } as any
}

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function MedicalClaimsPage() {
  const { activeClient, advisor, authLoading, updateActiveClientFields } = useDashboard()
  const router = useRouter()
  const supabase = createClient()

  const hasAccess = advisor?.id === CREATOR_ID || (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing'))

  const [loading, setLoading] = useState(true)
  const [policies, setPolicies] = useState<PolicyLite[]>([])
  const [familyMembers, setFamilyMembers] = useState<any[]>([])
  const [claims, setClaims] = useState<ClaimRow[]>([])
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null)
  const [lineItems, setLineItems] = useState<LineItemRow[]>([])
  const [linkedPolicyIds, setLinkedPolicyIds] = useState<string[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [policyPanelOpen, setPolicyPanelOpen] = useState(false)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notesByItem, setNotesByItem] = useState<Record<string, FollowupNote[]>>({})
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [resolvedOpen, setResolvedOpen] = useState(false)
  const [pendingCountByClaim, setPendingCountByClaim] = useState<Record<string, number>>({})
  const [policyYearTerms, setPolicyYearTerms] = useState<PolicyYearTerm[]>([])
  const [selectedYearStart, setSelectedYearStart] = useState<string | null>(null)
  const [policyYearLineItems, setPolicyYearLineItems] = useState<{ deductible_clocked: number; coinsurance_clocked: number; claim_id: string }[]>([])

  // ── Documents (Drive) — Option B: the advisor's own Google login, via
  // Google Identity Services + Picker. No pre-shared folder, no robot
  // account. A chosen folder is remembered per client so it's only picked
  // once, then reused silently on every later upload for that client. ──
  const [documents, setDocuments] = useState<ClaimDocument[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [googleReady, setGoogleReady] = useState(false)
  const [pickerReady, setPickerReady] = useState(false)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const tokenClientRef = useRef<any>(null)
  const [pickedFolder, setPickedFolder] = useState<{ id: string; name: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // ── Message templates (status update composer) ──
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [composerOpen, setComposerOpen] = useState(false)
  const [msgTrigger, setMsgTrigger] = useState(CLAIM_MSG_TRIGGERS[1].key) // default 'approved'
  const [msgBody, setMsgBody] = useState('')
  const [msgEdited, setMsgEdited] = useState(false)
  const [msgCopied, setMsgCopied] = useState<string | null>(null)
  const msgTextareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Route/feature guard — mirrors the nav's creator-bypass rule so direct
  // URL access without the flag doesn't work either. ──
  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  const clientName = activeClient?.name || 'Client'

  // ── Load Google Identity Services + Picker scripts once. This entire
  // effect is defensive on purpose: Drive upload is one small optional
  // feature on this page, and nothing it does should ever be able to take
  // down claim details, line items, or follow-ups if Google's side hiccups
  // or the client ID is misconfigured. ──
  function initGoogleTokenClient() {
    try {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      if (!clientId) { console.error('[drive] NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set'); return }
      tokenClientRef.current = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: () => {},
      })
      setGoogleReady(true)
    } catch (err) {
      console.error('[drive] Failed to init Google token client:', err)
    }
  }

  useEffect(() => {
    try {
      if ((window as any).google?.accounts?.oauth2) {
        initGoogleTokenClient()
      } else {
        const s = document.createElement('script')
        s.src = 'https://accounts.google.com/gsi/client'
        s.async = true
        s.onload = initGoogleTokenClient
        s.onerror = () => console.error('[drive] Failed to load Google Identity Services script')
        document.body.appendChild(s)
      }

      if ((window as any).gapi?.picker) {
        setPickerReady(true)
      } else {
        const s = document.createElement('script')
        s.src = 'https://apis.google.com/js/api.js'
        s.async = true
        s.onload = () => {
          try {
            (window as any).gapi.load('picker', () => setPickerReady(true))
          } catch (err) {
            console.error('[drive] Failed to load Picker library:', err)
          }
        }
        s.onerror = () => console.error('[drive] Failed to load Google API loader script')
        document.body.appendChild(s)
      }
    } catch (err) {
      console.error('[drive] Google script setup failed:', err)
    }
  }, [])

  // ── Restore the remembered Drive folder for whichever client is active ──
  useEffect(() => {
    const raw = activeClient?.drive_folder_link
    if (!raw) { setPickedFolder(null); return }
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.id && parsed?.name) { setPickedFolder(parsed); return }
    } catch { /* not our JSON shape — treat as unset */ }
    setPickedFolder(null)
  }, [activeClient?.id])

  const allPeople = useMemo(() => {
    const spouse = familyMembers.find(m => m.relationship === 'Spouse')
    const children = familyMembers.filter(m => m.relationship !== 'Spouse')
    return [
      { key: 'client', label: clientName },
      ...(spouse ? [{ key: 'spouse', label: spouse.name || 'Spouse' }] : []),
      ...children.map(c => ({ key: `child_${c.id}`, label: c.name || 'Child' })),
    ]
  }, [familyMembers, clientName])

  // ── Load client-scoped data (policies + family + claims) whenever the active client changes ──
  useEffect(() => {
    if (authLoading || !activeClient) { setLoading(false); return }
    let cancelled = false
    async function load() {
      setLoading(true)
      const [ffRes, famRes, claimsRes] = await Promise.all([
        supabase.from('fact_finding').select('data').eq('client_id', activeClient!.id).eq('section', 'protection_portfolio').maybeSingle(),
        supabase.from('family_members').select('*').eq('client_id', activeClient!.id),
        supabase.from('claims').select('*').eq('client_id', activeClient!.id).order('opened_date', { ascending: false }),
      ])
      if (cancelled) return
      const allPolicies: PolicyLite[] = ffRes.data?.data?.risk_management?.policies || []
      setPolicies(allPolicies.filter(p => p.categoryCode === 'medical'))
      setFamilyMembers(famRes.data || [])
      const claimRows = (claimsRes.data || []) as ClaimRow[]
      setClaims(claimRows)
      setSelectedClaimId(prev => claimRows.some(c => c.id === prev) ? prev : (claimRows[0]?.id || null))

      const claimIds = claimRows.map(c => c.id)
      if (claimIds.length > 0) {
        const countsRes = await supabase.from('claim_line_items').select('claim_id, approved').in('claim_id', claimIds)
        if (!cancelled) {
          const counts: Record<string, number> = {}
          ;(countsRes.data || []).forEach((row: any) => {
            if (!row.approved) counts[row.claim_id] = (counts[row.claim_id] || 0) + 1
          })
          setPendingCountByClaim(counts)
        }
      } else {
        setPendingCountByClaim({})
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClient?.id, authLoading])

  const selectedClaim = claims.find(c => c.id === selectedClaimId) || null

  // ── Load line items + linked policies + follow-up notes + documents whenever the selected claim changes ──
  useEffect(() => {
    if (!selectedClaimId) { setLineItems([]); setLinkedPolicyIds([]); setNotesByItem({}); setDocuments([]); return }
    let cancelled = false
    async function load() {
      const [itemsRes, linkedRes, docsRes] = await Promise.all([
        supabase.from('claim_line_items').select('*').eq('claim_id', selectedClaimId!).order('date_from', { ascending: true }),
        supabase.from('claim_linked_policies').select('policy_id').eq('claim_id', selectedClaimId!),
        supabase.from('claim_documents').select('*').eq('claim_id', selectedClaimId!).order('uploaded_at', { ascending: false }),
      ])
      if (cancelled) return
      const items = (itemsRes.data || []) as LineItemRow[]
      setLineItems(items)
      setLinkedPolicyIds((linkedRes.data || []).map((r: any) => r.policy_id))
      setDocuments((docsRes.data || []) as ClaimDocument[])

      const ids = items.map(i => i.id)
      if (ids.length === 0) { setNotesByItem({}); return }
      const notesRes = await supabase.from('claim_followup_notes').select('*').in('line_item_id', ids).order('created_at', { ascending: false })
      if (cancelled) return
      const grouped: Record<string, FollowupNote[]> = {}
      ;(notesRes.data || []).forEach((n: any) => {
        if (!grouped[n.line_item_id]) grouped[n.line_item_id] = []
        grouped[n.line_item_id].push(n)
      })
      setNotesByItem(grouped)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClaimId])

  const policiesForPerson = (personKey: string) => policies.filter(p => p.person === personKey)
  const mainPolicy = policies.find(p => p.id === selectedClaim?.policy_id) || null

  // ── Policy year terms: load existing rows for this policy, auto-create the
  // current year's row (copied from the most recent prior year) if missing ──
  useEffect(() => {
    if (!mainPolicy?.id || !mainPolicy?.inceptionDate || !activeClient) { setPolicyYearTerms([]); setSelectedYearStart(null); return }
    let cancelled = false
    ;(async () => {
      const { data: terms } = await supabase.from('policy_year_terms').select('*').eq('policy_id', mainPolicy!.id).order('year_start', { ascending: false })
      if (cancelled) return
      const existing = (terms || []) as PolicyYearTerm[]
      const window = getPolicyYearWindow(mainPolicy!.inceptionDate!, new Date().toISOString().slice(0, 10))
      const currentExists = existing.some(t => t.year_start === window.start)
      if (currentExists) {
        setPolicyYearTerms(existing)
        setSelectedYearStart(prev => prev && existing.some(t => t.year_start === prev) ? prev : window.start)
      } else {
        const prior = existing[0] // already sorted desc, so [0] is most recent
        const { data: created } = await supabase.from('policy_year_terms').insert({
          client_id: activeClient.id, policy_id: mainPolicy!.id,
          year_start: window.start, year_end: window.end,
          panel_deductible_amount: prior?.panel_deductible_amount || 0,
          panel_coinsurance_cap_annual: prior?.panel_coinsurance_cap_annual || 0,
          non_panel_deductible_amount: prior?.non_panel_deductible_amount ?? null,
          non_panel_coinsurance_cap_annual: prior?.non_panel_coinsurance_cap_annual ?? null,
        }).select().maybeSingle()
        if (cancelled) return
        const next = created ? [created as PolicyYearTerm, ...existing] : existing
        setPolicyYearTerms(next)
        setSelectedYearStart(window.start)
      }
    })()
    return () => { cancelled = true }
  }, [mainPolicy?.id, mainPolicy?.inceptionDate, activeClient])

  // ── Line items across every claim on this policy (not just the one open
  // right now), so the policy-year rollup is accurate across multiple claims ──
  useEffect(() => {
    if (!mainPolicy?.id) { setPolicyYearLineItems([]); return }
    const claimIds = claims.filter(c => c.policy_id === mainPolicy!.id).map(c => c.id)
    if (claimIds.length === 0) { setPolicyYearLineItems([]); return }
    let cancelled = false
    supabase.from('claim_line_items').select('deductible_clocked,coinsurance_clocked,claim_id').in('claim_id', claimIds)
      .then(({ data }) => { if (!cancelled) setPolicyYearLineItems(data || []) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainPolicy?.id, claims, lineItems])

  const selectedTerm = policyYearTerms.find(t => t.year_start === selectedYearStart) || null
  const yearClaimsInWindow = selectedTerm
    ? claims.filter(c => c.policy_id === mainPolicy?.id && c.opened_date >= selectedTerm.year_start && c.opened_date <= selectedTerm.year_end)
    : []
  // Panel and Non-Panel each clock against their own cap — a Non-Panel claim
  // doesn't eat into the Panel co-insurance cap, and vice versa.
  const panelClaimIds = new Set(yearClaimsInWindow.filter(c => c.panel_status !== 'non_panel').map(c => c.id))
  const nonPanelClaimIds = new Set(yearClaimsInWindow.filter(c => c.panel_status === 'non_panel').map(c => c.id))
  const panelDeductibleClockedTotal = policyYearLineItems.filter(li => panelClaimIds.has(li.claim_id)).reduce((s, li) => s + (li.deductible_clocked || 0), 0)
  const panelCoinsuranceClockedTotal = policyYearLineItems.filter(li => panelClaimIds.has(li.claim_id)).reduce((s, li) => s + (li.coinsurance_clocked || 0), 0)
  const nonPanelDeductibleClockedTotal = policyYearLineItems.filter(li => nonPanelClaimIds.has(li.claim_id)).reduce((s, li) => s + (li.deductible_clocked || 0), 0)
  const nonPanelCoinsuranceClockedTotal = policyYearLineItems.filter(li => nonPanelClaimIds.has(li.claim_id)).reduce((s, li) => s + (li.coinsurance_clocked || 0), 0)

  async function updateYearTerm(patch: Partial<PolicyYearTerm>) {
    if (!selectedTerm) return
    setPolicyYearTerms(prev => prev.map(t => t.id === selectedTerm.id ? { ...t, ...patch } : t))
    await supabase.from('policy_year_terms').update(patch).eq('id', selectedTerm.id)
  }

  // ── Claim mutations ──
  async function createClaim() {
    if (!activeClient) return
    const person = allPeople[0]?.key || 'client'
    const firstMain = policiesForPerson(person).find(p => p.policyTypeCode?.toLowerCase() === 'main') || policiesForPerson(person)[0]
    if (!firstMain) { alert('This person has no medical policy on file yet — add one on the Protection page first.'); return }
    setSaving(true)
    const { data, error } = await supabase.from('claims').insert({
      client_id: activeClient.id, policy_id: firstMain.id, life_assured_person: person,
      label: 'New Claim', status: 'open', opened_date: new Date().toISOString().slice(0, 10),
      panel_status: 'panel',
    }).select().maybeSingle()
    setSaving(false)
    if (error || !data) { alert('Could not create claim: ' + (error?.message || 'unknown error')); return }
    setClaims(prev => [data as ClaimRow, ...prev])
    setSelectedClaimId((data as ClaimRow).id)
    setDetailsOpen(true)
  }

  async function updateClaim(patch: Partial<ClaimRow>) {
    if (!selectedClaim) return
    setClaims(prev => prev.map(c => c.id === selectedClaim.id ? { ...c, ...patch } : c))
    const { error } = await supabase.from('claims').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', selectedClaim.id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function deleteClaim() {
    if (!selectedClaim) return
    const label = allPeople.find(p => p.key === selectedClaim.life_assured_person)?.label || selectedClaim.life_assured_person
    if (!window.confirm(`Delete "${selectedClaim.label || 'Claim'}" for ${label}? This removes all its line items, notes, and documents. This cannot be undone.`)) return
    const idToDelete = selectedClaim.id
    setSaving(true)
    const { error } = await supabase.from('claims').delete().eq('id', idToDelete)
    setSaving(false)
    if (error) { alert('Could not delete claim: ' + error.message); return }
    setClaims(prev => {
      const remaining = prev.filter(c => c.id !== idToDelete)
      setSelectedClaimId(remaining[0]?.id || null)
      return remaining
    })
    setDetailsOpen(false)
    setExpandedItemId(null)
  }

  async function onLifeAssuredChange(personKey: string) {
    const firstMain = policiesForPerson(personKey).find(p => p.policyTypeCode?.toLowerCase() === 'main') || policiesForPerson(personKey)[0]
    if (!firstMain) { alert('This person has no medical policy on file yet.'); return }
    await updateClaim({ life_assured_person: personKey, policy_id: firstMain.id })
    setLinkedPolicyIds([])
    if (selectedClaimId) await supabase.from('claim_linked_policies').delete().eq('claim_id', selectedClaimId)
  }

  async function toggleLinkedPolicy(policyId: string, checked: boolean) {
    if (!selectedClaimId) return
    if (checked) {
      setLinkedPolicyIds(prev => [...prev, policyId])
      await supabase.from('claim_linked_policies').insert({ claim_id: selectedClaimId, policy_id: policyId })
    } else {
      setLinkedPolicyIds(prev => prev.filter(id => id !== policyId))
      await supabase.from('claim_linked_policies').delete().eq('claim_id', selectedClaimId).eq('policy_id', policyId)
    }
  }

  // ── Line item mutations ──
  async function addLine(section: 'pre' | 'in' | 'post') {
    if (!selectedClaimId) return
    const draft = newLineItem(selectedClaimId, section)
    const { data, error } = await supabase.from('claim_line_items').insert(draft).select().maybeSingle()
    if (error || !data) { alert('Could not add line: ' + (error?.message || 'unknown error')); return }
    setLineItems(prev => [...prev, data as LineItemRow])
    setExpandedItemId((data as LineItemRow).id)
  }

  async function saveLineItem(id: string, patch: Partial<LineItemRow>) {
    setLineItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
    const { error } = await supabase.from('claim_line_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) alert('Save failed: ' + error.message)
  }

  async function deleteLine(id: string) {
    setLineItems(prev => prev.filter(i => i.id !== id))
    if (expandedItemId === id) setExpandedItemId(null)
    const { error } = await supabase.from('claim_line_items').delete().eq('id', id)
    if (error) alert('Delete failed: ' + error.message)
  }

  // ── Follow-up note mutations ──
  async function addNote(lineItemId: string) {
    const text = (noteDraft[lineItemId] || '').trim()
    if (!text) return
    const { data, error } = await supabase.from('claim_followup_notes').insert({ line_item_id: lineItemId, text }).select().maybeSingle()
    if (error || !data) { alert('Could not add note: ' + (error?.message || 'unknown error')); return }
    setNotesByItem(prev => ({ ...prev, [lineItemId]: [data as FollowupNote, ...(prev[lineItemId] || [])] }))
    setNoteDraft(prev => ({ ...prev, [lineItemId]: '' }))
  }

  async function deleteNote(lineItemId: string, noteId: string) {
    setNotesByItem(prev => ({ ...prev, [lineItemId]: (prev[lineItemId] || []).filter(n => n.id !== noteId) }))
    const { error } = await supabase.from('claim_followup_notes').delete().eq('id', noteId)
    if (error) alert('Delete failed: ' + error.message)
  }

  // Google auth + folder picking (advisor's own account, not a robot).
  // `interactive` forces a real consent popup instead of a silent request —
  // used as a fallback when the silent attempt times out (common on a fresh
  // browser session / after time has passed, since Google doesn't always
  // invoke the callback at all if it has no cached session to work from —
  // no error, no resolve, just silence. A hard timeout turns that silence
  // into a clear message instead of an unkillable "Uploading…" state).
  async function ensureAccessToken(interactive = false): Promise<string> {
    if (accessToken && !interactive) return accessToken
    if (!tokenClientRef.current) throw new Error('Google Sign-In is still loading — try again in a moment.')
    const requestOnce = (prompt: string): Promise<string> => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('__silent_timeout__')), 12000)
      tokenClientRef.current.callback = (resp: any) => {
        clearTimeout(timer)
        if (resp.error) { reject(new Error(resp.error)); return }
        setAccessToken(resp.access_token)
        resolve(resp.access_token)
      }
      tokenClientRef.current.requestAccessToken({ prompt })
    })
    if (!interactive) {
      try {
        return await requestOnce('')
      } catch (err: any) {
        if (err?.message !== '__silent_timeout__') throw err
        // Silent auth didn't respond at all — fall through to an interactive
        // popup so the advisor gets a real sign-in prompt instead of a hang.
      }
    }
    try {
      return await requestOnce('consent')
    } catch (err: any) {
      if (err?.message === '__silent_timeout__') throw new Error('Google sign-in did not respond — check that popups are allowed for this site, then try again.')
      throw err
    }
  }

  async function pickFolder(): Promise<{ id: string; name: string } | null> {
    if (!pickerReady) throw new Error('Google Drive picker is still loading — try again in a moment.')
    const token = await ensureAccessToken()
    const g = (window as any).google
    return new Promise(resolve => {
      const view = new g.picker.DocsView(g.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes('application/vnd.google-apps.folder')
      const picker = new g.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY)
        .setCallback((data: any) => {
          if (data.action === g.picker.Action.PICKED) {
            const doc = data.docs[0]
            resolve({ id: doc.id, name: doc.name })
          } else if (data.action === g.picker.Action.CANCEL) {
            resolve(null)
          }
        })
        .build()
      picker.setVisible(true)
    })
  }

  // Both "first connect" and "change folder" funnel through here — always
  // triggered by a plain, direct button click, never chained after a file
  // chooser closes (that combination is what Chrome blocks; see the
  // "window.open blocked due to active file chooser" console error this
  // was built to avoid).
  async function connectDrive() {
    if (!activeClient) return
    setConnecting(true)
    setUploadError(null)
    try {
      const folder = await pickFolder()
      if (!folder) return // advisor cancelled the picker
      setPickedFolder(folder)
      const raw = JSON.stringify(folder)
      const { error } = await supabase.from('clients').update({ drive_folder_link: raw, updated_at: new Date().toISOString() }).eq('id', activeClient.id)
      if (error) { setUploadError('Could not remember this folder: ' + error.message); return }
      updateActiveClientFields({ drive_folder_link: raw })
    } catch (err: any) {
      setUploadError(err?.message || 'Could not connect to Drive')
    } finally {
      setConnecting(false)
    }
  }
  const changeFolder = connectDrive

  // ── Document upload/delete — straight browser-to-Google using the
  // advisor's own token, so there's no server-side size limit to work
  // around. By the time this runs, a folder is already picked (the file
  // input controlling this only renders once pickedFolder is set), and the
  // access token is already cached from that earlier step — so this never
  // needs to open a popup itself. Every network call has a hard timeout —
  // a stalled request now surfaces as a clear error instead of leaving the
  // button stuck on "Uploading…" forever with no way out. ──
  async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number, label: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...opts, signal: controller.signal })
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s — check your connection and try again.`)
      throw new Error(`${label} failed: ${err?.message || 'network error'}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function uploadDocument(file: File, lineItemId: string | null) {
    if (!activeClient || !selectedClaimId || !pickedFolder) return
    setUploading(true)
    setUploadError(null)
    try {
      const token = await ensureAccessToken()
      const initRes = await fetchWithTimeout('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name: file.name, parents: [pickedFolder.id] }),
      }, 20000, 'Starting the upload')
      if (!initRes.ok) throw new Error('Could not start upload (status ' + initRes.status + ')')
      const uploadUrl = initRes.headers.get('Location')
      if (!uploadUrl) throw new Error('Drive did not return an upload session — this can happen if the browser blocked reading the response. Try a different browser if this repeats.')

      const putRes = await fetchWithTimeout(uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      }, 120000, 'Uploading the file')
      if (!putRes.ok) throw new Error('Upload to Drive failed (status ' + putRes.status + ')')
      const driveFile = await putRes.json()

      const { data, error } = await supabase.from('claim_documents').insert({
        claim_id: selectedClaimId, line_item_id: lineItemId,
        file_name: driveFile.name || file.name, mime_type: file.type || null,
        file_size: driveFile.size ? +driveFile.size : file.size,
        drive_file_id: driveFile.id, drive_view_url: driveFile.webViewLink || null,
      }).select().maybeSingle()
      if (error || !data) throw new Error(error?.message || 'Uploaded to Drive but could not save the record')
      setDocuments(prev => [data as ClaimDocument, ...prev])
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function uploadFiles(files: FileList | File[], lineItemId: string | null) {
    for (const f of Array.from(files)) {
      // Sequential on purpose — uploading/uploadError are single shared
      // state, so parallel drops would stomp on each other's error/progress.
      await uploadDocument(f, lineItemId)
    }
  }

  async function deleteDocument(doc: ClaimDocument) {
    if (!window.confirm(`Delete "${doc.file_name}"? This removes it from Drive too.`)) return
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    try {
      if (doc.drive_file_id) {
        const token = await ensureAccessToken()
        await fetch(`https://www.googleapis.com/drive/v3/files/${doc.drive_file_id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        })
      }
    } catch { /* proceed to remove the app-side record regardless */ }
    const { error } = await supabase.from('claim_documents').delete().eq('id', doc.id)
    if (error) alert('Delete failed: ' + error.message)
  }

  // ── Totals ──
  const totalClaimed = lineItems.reduce((s, i) => s + (i.amount_claimed || 0), 0)
  const totalApproved = lineItems.reduce((s, i) => s + (i.approved ? (i.amount_approved || 0) : 0), 0)
  const pct = totalClaimed > 0 ? Math.round((totalApproved / totalClaimed) * 100) : 0

  // ── Message templates (status update composer) ──
  useEffect(() => {
    if (!advisor) return
    supabase.from('message_templates').select('*').eq('context_type', 'claim_status')
      .then(({ data }) => setTemplates((data || []) as MessageTemplate[]))
  }, [advisor?.id])

  function templateBodyFor(key: string): string {
    const personal = templates.find(t => t.context_key === key && t.advisor_id === advisor?.id)
    if (personal) return personal.body
    const def = templates.find(t => t.context_key === key && t.advisor_id === null)
    if (def) return def.body
    return FALLBACK_MSG_TEMPLATES[key] || ''
  }
  function loadTemplate(key: string) {
    setMsgTrigger(key)
    setMsgBody(templateBodyFor(key))
    setMsgEdited(false)
  }
  // Load the default the first time the composer opens, and whenever the
  // trigger changes — but never stomp on an in-progress edit on re-render.
  useEffect(() => {
    if (composerOpen) loadTemplate(msgTrigger)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerOpen, templates])

  const derivedStatusBadge = lineItems.length === 0 ? 'No line items yet'
    : lineItems.every(i => i.approved) ? 'Fully Approved'
      : lineItems.some(i => i.approved) ? 'Partially Approved'
        : 'Pending Insurer Review'
  const msgVars: Record<string, string> = {
    client_name: allPeople.find(p => p.key === selectedClaim?.life_assured_person)?.label || clientName,
    policy_number: mainPolicy?.policyNo || '—',
    insurer: mainPolicy?.companyName || '—',
    amount_claimed: money(totalClaimed),
    amount_approved: money(totalApproved),
    approval_pct: pct + '%',
    status_badge: derivedStatusBadge,
    advisor_name: advisor?.name || '',
    procedure_description: lineItems.map(i => i.description).filter(Boolean).join(', ') || selectedClaim?.label || 'this claim',
  }
  const msgPreview = substituteMsgVars(msgBody, msgVars)

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
  async function upsertTemplate(advisorIdForRow: string | null) {
    const existing = templates.find(t => t.context_key === msgTrigger && t.advisor_id === advisorIdForRow)
    if (existing) {
      setTemplates(prev => prev.map(t => t.id === existing.id ? { ...t, body: msgBody } : t))
      await supabase.from('message_templates').update({ body: msgBody, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else {
      const { data } = await supabase.from('message_templates')
        .insert({ context_type: 'claim_status', context_key: msgTrigger, advisor_id: advisorIdForRow, body: msgBody })
        .select().maybeSingle()
      if (data) setTemplates(prev => [...prev, data as MessageTemplate])
    }
    setMsgEdited(false)
  }
  function copyMsg(forWhatsApp: boolean) {
    if (navigator.clipboard) navigator.clipboard.writeText(msgPreview)
    setMsgCopied(forWhatsApp ? 'whatsapp' : 'plain')
    setTimeout(() => setMsgCopied(null), 1800)
  }

  // ── Follow-ups ──
  const pendingItems = [...lineItems].filter(i => !i.approved).sort((a, b) => {
    const da = daysSince(a.submitted_date || a.date_from) ?? -1
    const db = daysSince(b.submitted_date || b.date_from) ?? -1
    return db - da
  })
  const resolvedItems = lineItems.filter(i => i.approved)

  useEffect(() => {
    if (!selectedClaimId) return
    setPendingCountByClaim(prev => ({ ...prev, [selectedClaimId]: pendingItems.length }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClaimId, pendingItems.length])

  // ── Documents grouped by the status of the line item they're tied to.
  // A document with no line_item_id (a general claim-level file — e.g. a
  // full policy schedule) has no approval state to derive, so it gets its
  // own neutral group rather than being force-fit into Pending/Approved. ──
  const generalDocs = documents.filter(d => !d.line_item_id)
  const pendingDocs = documents.filter(d => d.line_item_id && lineItems.find(i => i.id === d.line_item_id && !i.approved))
  const approvedDocs = documents.filter(d => d.line_item_id && lineItems.find(i => i.id === d.line_item_id && i.approved))

  // ── Guards ──
  if (authLoading || loading) return <div style={pageWrap}><div style={{ color: T.textFaint, padding: 40, textAlign: 'center' }}>Loading…</div></div>
  if (!hasAccess) return null
  if (!activeClient) return <div style={pageWrap}><div style={{ color: T.textFaint, padding: 40, textAlign: 'center' }}>Select a client to view Medical Claims.</div></div>

  return (
    <div style={pageWrap}>
      <style>{`
        .claims-serif { font-family: var(--font-cormorant), Georgia, serif; }
        .claims-mono { font-family: var(--font-dm-mono), monospace; }
        .claims-scroll::-webkit-scrollbar { display: none; }
        .claims-input, .claims-select { width: 100%; padding: 8px 10px; border: 1px solid ${T.line}; border-radius: 10px; background: var(--cream); color: ${T.text}; font-size: 13px; }
        .claims-input:focus, .claims-select:focus { outline: none; border-color: ${T.gold}; box-shadow: 0 0 0 3px ${T.goldSoft}; }
        .claims-input:disabled, .claims-select:disabled { opacity: 0.6; }
      `}</style>

      {/* Claim switcher */}
      <div className="claims-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingTop: 12, paddingBottom: 4, marginTop: -12, marginBottom: 16 }}>
        {claims.map(c => {
          const label = allPeople.find(p => p.key === c.life_assured_person)?.label || c.life_assured_person
          const pendingCount = pendingCountByClaim[c.id] || 0
          return (
            <button key={c.id} onClick={() => { setSelectedClaimId(c.id); setDetailsOpen(false); setExpandedItemId(null) }}
              style={{ ...pillBase, ...(c.id === selectedClaimId ? pillActive : pillInactive), position: 'relative' }}>
              {pendingCount > 0 && (
                <span className="claims-mono" style={{
                  position: 'absolute', top: -7, right: -7, minWidth: 18, height: 18, borderRadius: 999,
                  background: T.gold, color: 'var(--charcoal)', fontSize: 10.5, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                  border: `2px solid ${T.void1}`,
                }}>{pendingCount}</span>
              )}
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>{c.label || 'Claim'}</div>
            </button>
          )
        })}
        <button onClick={createClaim} disabled={saving} style={{ ...pillBase, border: `1.5px dashed ${T.gold}`, background: T.goldSoft, color: T.goldText, fontSize: 12.5, fontWeight: 700 }}>+ New</button>
      </div>

      {!selectedClaim ? (
        <div style={{ ...cardBase, textAlign: 'center', color: T.textFaint, padding: 40 }}>No claims yet for {clientName}. Click "+ New" to start one.</div>
      ) : (
        <>
          {/* Hero */}
          <div style={heroCard}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.gold, fontWeight: 700 }}>Claim · Opened {fmtDate(selectedClaim.opened_date)}</div>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.goldText, background: T.goldSoft, padding: '2px 8px', borderRadius: 999 }}>
                  {PANEL_STATUS_LABEL[selectedClaim.panel_status || 'panel']}
                </span>
              </div>
              <div className="claims-serif" style={{ fontSize: 26, marginTop: 5, color: T.text }}>Medical Insurance Claims for {allPeople.find(p => p.key === selectedClaim.life_assured_person)?.label || clientName}</div>
              <div style={{ fontSize: 11.5, color: T.textDim, marginTop: 5 }}>Household <b style={{ color: T.text }}>{clientName}</b> family</div>
            </div>
            <button onClick={deleteClaim} disabled={saving}
              style={{ marginTop: 10, background: 'none', border: 'none', color: T.rose, fontSize: 11, fontWeight: 700, padding: '4px 2px', cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
              Delete this claim
            </button>
            <div style={{ height: 1, background: `linear-gradient(90deg, transparent, ${T.line} 15%, ${T.line} 85%, transparent)`, margin: '20px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: T.textFaint, fontWeight: 700 }}>Total Claimed</div>
                <div className="claims-mono" style={{ fontSize: 34, marginTop: 5, color: T.text }}>{money(totalClaimed)}</div>
                <div style={{ fontSize: 12, color: T.gold, marginTop: 5, fontWeight: 600 }}>Approved {money(totalApproved)}</div>
              </div>
              <Ring pct={pct} />
            </div>
          </div>

          {/* Details disclosure */}
          <button onClick={() => setDetailsOpen(o => !o)} style={detailsToggle}>
            <span>Claim details — life assured, policy, policyholder</span>
            <span style={{ transform: detailsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', display: 'inline-block' }}>▾</span>
          </button>
          {detailsOpen && (
            <div style={{ ...cardBase, marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <FieldLabel>Life Assured</FieldLabel>
                <select className="claims-select" value={selectedClaim.life_assured_person} onChange={e => onLifeAssuredChange(e.target.value)}>
                  {allPeople.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Panel Status</FieldLabel>
                <select className="claims-select" value={selectedClaim.panel_status || 'panel'}
                  onChange={e => updateClaim({ panel_status: e.target.value as 'panel' | 'non_panel' })}>
                  <option value="panel">Panel</option>
                  <option value="non_panel">Non-Panel</option>
                </select>
              </div>
              <div>
                <FieldLabel>Policyholder</FieldLabel>
                <div style={readonlyVal}>{mainPolicy?.policyholder || '—'}</div>
              </div>
              <div style={{ position: 'relative' }}>
                <FieldLabel>Main Policy</FieldLabel>
                <select className="claims-select" value={selectedClaim.policy_id} onChange={e => updateClaim({ policy_id: e.target.value })}>
                  {policiesForPerson(selectedClaim.life_assured_person).map(p => <option key={p.id} value={p.id}>{p.productName || p.companyName}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>Policy No.</FieldLabel>
                <div className="claims-mono" style={readonlyVal}>{mainPolicy?.policyNo || '—'}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <FieldLabel>Policy Year</FieldLabel>
                {!mainPolicy?.inceptionDate ? (
                  <div style={{ fontSize: 11.5, color: T.rose }}>This policy has no Inception Date set — add one on the Protection page to enable policy-year tracking.</div>
                ) : policyYearTerms.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: T.textFaint }}>Loading…</div>
                ) : (
                  <div className="claims-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                    {policyYearTerms.map(t => (
                      <button key={t.id} onClick={() => setSelectedYearStart(t.year_start)}
                        style={{ ...pillBase, fontSize: 11.5, padding: '6px 12px', ...(t.year_start === selectedYearStart ? pillActive : pillInactive) }}>
                        {fmtYearRange(t.year_start, t.year_end)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Panel terms */}
              <div style={{ gridColumn: '1 / -1', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.goldText, marginTop: 4 }}>Panel Terms — This Policy Year</div>
              <div>
                <FieldLabel>Panel Deductible ($)</FieldLabel>
                <input className="claims-input claims-mono" type="number" value={selectedTerm?.panel_deductible_amount || ''} disabled={!selectedTerm}
                  onChange={e => setPolicyYearTerms(prev => prev.map(t => t.id === selectedTerm?.id ? { ...t, panel_deductible_amount: e.target.value === '' ? 0 : +e.target.value } : t))}
                  onBlur={e => updateYearTerm({ panel_deductible_amount: e.target.value === '' ? 0 : +e.target.value })} />
                <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 6 }}>
                  Clocked (Panel claims) <b style={{ color: T.text }}>{money(panelDeductibleClockedTotal)}</b> of {money(selectedTerm?.panel_deductible_amount)}
                </div>
              </div>
              <div>
                <FieldLabel>Panel Co-Insurance Cap ($)</FieldLabel>
                <input className="claims-input claims-mono" type="number" value={selectedTerm?.panel_coinsurance_cap_annual || ''} disabled={!selectedTerm}
                  onChange={e => setPolicyYearTerms(prev => prev.map(t => t.id === selectedTerm?.id ? { ...t, panel_coinsurance_cap_annual: e.target.value === '' ? 0 : +e.target.value } : t))}
                  onBlur={e => updateYearTerm({ panel_coinsurance_cap_annual: e.target.value === '' ? 0 : +e.target.value })} />
                <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 6 }}>
                  Clocked (Panel claims) <b style={{ color: T.text }}>{money(panelCoinsuranceClockedTotal)}</b> of {money(selectedTerm?.panel_coinsurance_cap_annual)}
                </div>
              </div>

              {/* Non-Panel terms */}
              <div style={{ gridColumn: '1 / -1', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.goldText, marginTop: 4 }}>Non-Panel Terms — This Policy Year</div>
              <div>
                <FieldLabel>Non-Panel Deductible ($, leave blank if none)</FieldLabel>
                <input className="claims-input claims-mono" type="number" placeholder="—" value={selectedTerm?.non_panel_deductible_amount ?? ''} disabled={!selectedTerm}
                  onChange={e => setPolicyYearTerms(prev => prev.map(t => t.id === selectedTerm?.id ? { ...t, non_panel_deductible_amount: e.target.value === '' ? null : +e.target.value } : t))}
                  onBlur={e => updateYearTerm({ non_panel_deductible_amount: e.target.value === '' ? null : +e.target.value })} />
                <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 6 }}>
                  Clocked (Non-Panel claims) <b style={{ color: T.text }}>{money(nonPanelDeductibleClockedTotal)}</b>{selectedTerm?.non_panel_deductible_amount != null ? <> of {money(selectedTerm.non_panel_deductible_amount)}</> : null}
                </div>
              </div>
              <div>
                <FieldLabel>Non-Panel Co-Insurance Cap ($, leave blank if uncapped)</FieldLabel>
                <input className="claims-input claims-mono" type="number" placeholder="No cap" value={selectedTerm?.non_panel_coinsurance_cap_annual ?? ''} disabled={!selectedTerm}
                  onChange={e => setPolicyYearTerms(prev => prev.map(t => t.id === selectedTerm?.id ? { ...t, non_panel_coinsurance_cap_annual: e.target.value === '' ? null : +e.target.value } : t))}
                  onBlur={e => updateYearTerm({ non_panel_coinsurance_cap_annual: e.target.value === '' ? null : +e.target.value })} />
                <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 6 }}>
                  Clocked (Non-Panel claims) <b style={{ color: T.text }}>{money(nonPanelCoinsuranceClockedTotal)}</b>{selectedTerm?.non_panel_coinsurance_cap_annual != null ? <> of {money(selectedTerm.non_panel_coinsurance_cap_annual)}</> : <> · uncapped</>}
                </div>
              </div>
              <div style={{ gridColumn: '1 / -1', position: 'relative' }}>
                <FieldLabel>Linked Riders (in addition to main policy)</FieldLabel>
                <div onClick={() => setPolicyPanelOpen(o => !o)} style={{ ...msBox }}>
                  {linkedPolicyIds.length === 0 ? <span style={{ color: T.textFaint, fontSize: 12.5 }}>None selected</span> :
                    linkedPolicyIds.map(id => {
                      const p = policies.find(pp => pp.id === id)
                      return <span key={id} style={msTag}>{p?.productName || p?.companyName || id}
                        <button onClick={(e) => { e.stopPropagation(); toggleLinkedPolicy(id, false) }} style={{ background: 'none', border: 'none', color: T.goldText, fontSize: 12, marginLeft: 4 }}>✕</button>
                      </span>
                    })}
                </div>
                {policyPanelOpen && (
                  <div style={msPanel}>
                    {policiesForPerson(selectedClaim.life_assured_person).filter(p => p.id !== selectedClaim.policy_id).map(p => (
                      <label key={p.id} style={msOption}>
                        <input type="checkbox" checked={linkedPolicyIds.includes(p.id)} onChange={e => toggleLinkedPolicy(p.id, e.target.checked)} />
                        <span>{p.productName || p.companyName} <span style={{ color: T.textFaint }}>({p.policyTypeCode})</span></span>
                      </label>
                    ))}
                    {policiesForPerson(selectedClaim.life_assured_person).filter(p => p.id !== selectedClaim.policy_id).length === 0 &&
                      <div style={{ padding: 10, fontSize: 12, color: T.textFaint }}>No other medical policies for this person.</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Draft Status Update — message templates */}
          <button onClick={() => setComposerOpen(o => !o)} style={detailsToggle}>
            <span>Draft a status update message</span>
            <span style={{ transform: composerOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', display: 'inline-block' }}>▾</span>
          </button>
          {composerOpen && (
            <div style={{ ...cardBase, marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                <select className="claims-select" value={msgTrigger} onChange={e => loadTemplate(e.target.value)} style={{ width: 240 }}>
                  {CLAIM_MSG_TRIGGERS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: msgEdited ? T.gold : T.textFaint }}>
                  ● {msgEdited ? 'Edited — no longer matches default' : 'Using default template'}
                </span>
              </div>

              <FieldLabel>Template (edit freely — variables below insert at cursor)</FieldLabel>
              <textarea ref={msgTextareaRef} className="claims-input" value={msgBody}
                onChange={e => { setMsgBody(e.target.value); setMsgEdited(true) }}
                style={{ minHeight: 120, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {MSG_VARIABLES.map(v => (
                  <button key={v.key} onClick={() => insertMsgVariable(v.key)}
                    style={{ fontSize: 10.5, fontWeight: 700, color: T.goldText, background: T.goldSoft, border: `1px solid rgba(231,188,114,.3)`, padding: '4px 10px', borderRadius: 999, cursor: 'pointer' }}>
                    + {v.label}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <FieldLabel>Preview (this is what gets copied)</FieldLabel>
                <div style={{ ...readonlyVal, whiteSpace: 'pre-wrap', minHeight: 80, lineHeight: 1.5 }}>{msgPreview}</div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <button onClick={() => loadTemplate(msgTrigger)} style={addBtn}>Reset</button>
                <button onClick={() => upsertTemplate(advisor?.id || null)} style={addBtn}>Save as My Default</button>
                {advisor?.id === CREATOR_ID && (
                  <button onClick={() => upsertTemplate(null)} style={{ ...addBtn, color: T.rose, background: T.roseSoft, borderColor: 'rgba(255,107,87,.3)' }}>Save as Admin Default</button>
                )}
                <button onClick={() => copyMsg(false)} style={{ ...addBtn, marginLeft: 'auto' }}>{msgCopied === 'plain' ? 'Copied!' : 'Copy'}</button>
                <button onClick={() => copyMsg(true)} style={{ ...addBtn, color: 'var(--charcoal)', background: T.gold }}>{msgCopied === 'whatsapp' ? 'Copied!' : 'Copy for WhatsApp'}</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
              <div>
                <div className="claims-serif" style={{ fontSize: 19, color: T.text, display: 'flex', alignItems: 'center', gap: 10 }}>
                  Pending Follow-Ups
                  <span className="claims-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--charcoal)', background: T.gold, borderRadius: 999, padding: '3px 11px', lineHeight: 1.3 }}>{pendingItems.length}</span>
                </div>
                <div style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, fontWeight: 700 }}>Line items awaiting insurer action</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingItems.length === 0 && <div style={{ ...cardBase, padding: 16, textAlign: 'center', color: T.textFaint, fontSize: 12.5, fontStyle: 'italic' }}>Nothing pending — every line item is either resolved or not yet added.</div>}
              {pendingItems.map(it => (
                <FollowupCard key={it.id} item={it} notes={notesByItem[it.id] || []}
                  draft={noteDraft[it.id] || ''} onDraftChange={v => setNoteDraft(prev => ({ ...prev, [it.id]: v }))}
                  onAddNote={() => addNote(it.id)} onDeleteNote={noteId => deleteNote(it.id, noteId)}
                  onStatusChange={status => saveLineItem(it.id, { followup_status: status })} />
              ))}
            </div>

            {resolvedItems.length > 0 && (
              <>
                <button onClick={() => setResolvedOpen(o => !o)} style={{ ...detailsToggle, marginTop: 14 }}>
                  <span>Resolved ({resolvedItems.length})</span>
                  <span style={{ transform: resolvedOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', display: 'inline-block' }}>▾</span>
                </button>
                {resolvedOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    {resolvedItems.map(it => (
                      <FollowupCard key={it.id} item={it} notes={notesByItem[it.id] || []} resolved
                        draft={noteDraft[it.id] || ''} onDraftChange={v => setNoteDraft(prev => ({ ...prev, [it.id]: v }))}
                        onAddNote={() => addNote(it.id)} onDeleteNote={noteId => deleteNote(it.id, noteId)}
                        onStatusChange={status => saveLineItem(it.id, { followup_status: status })} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sections — always rendered together */}
          {(['pre', 'in', 'post'] as const).map(sec => {
            const items = lineItems.filter(i => i.section === sec)
            const accent = SECTION_ACCENT[sec]
            return (
              <div key={sec} style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ width: 3, height: 16, borderRadius: 2, background: accent.text, flexShrink: 0 }} />
                    <div>
                      <div className="claims-serif" style={{ fontSize: 19, color: T.text }}>{SECTION_LABEL[sec]} <span style={{ fontSize: 11, color: T.textFaint, fontFamily: 'inherit' }}>{items.length}</span></div>
                      <div style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, fontWeight: 700 }}>{SECTION_SUB[sec]}</div>
                    </div>
                  </div>
                  <button onClick={() => addLine(sec)} style={addBtn}>+ Add</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.length === 0 && <div style={{ ...cardBase, padding: 16, textAlign: 'center', color: T.textFaint, fontSize: 12.5, fontStyle: 'italic' }}>No line items yet.</div>}
                  {items.map(it => (
                    <LineItemCard key={it.id} item={it} expanded={expandedItemId === it.id}
                      onToggle={() => setExpandedItemId(expandedItemId === it.id ? null : it.id)}
                      onSave={patch => saveLineItem(it.id, patch)} onDelete={() => deleteLine(it.id)}
                      documents={documents.filter(d => d.line_item_id === it.id)}
                      pickedFolder={pickedFolder} uploading={uploading}
                      onUploadFiles={files => uploadFiles(files, it.id)}
                      onDeleteDocument={deleteDocument}
                      typeOptions={SECTION_TYPE_OPTIONS[sec]} accent={accent} />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Documents — full collection. Uploads tied to a specific line item now
              happen on that line item's own card; this drop zone is only for
              claim-level documents (e.g. a full policy schedule) that aren't
              about one particular line. */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
              <div>
                <div className="claims-serif" style={{ fontSize: 19, color: T.text, display: 'flex', alignItems: 'center', gap: 10 }}>
                  Documents
                  <span className="claims-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--charcoal)', background: T.gold, borderRadius: 999, padding: '3px 11px', lineHeight: 1.3 }}>{documents.length}</span>
                </div>
                <div style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, fontWeight: 700 }}>
                  {approvedDocs.length > 0 || pendingDocs.length > 0 ? `${approvedDocs.length} approved · ${pendingDocs.length} pending` : "Everything uploaded — line-item docs upload from the line item itself"}
                </div>
              </div>
            </div>

            {!pickedFolder ? (
              <div style={{ ...cardBase, padding: 14, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={connectDrive} disabled={connecting} style={{ ...addBtn, opacity: connecting ? 0.6 : 1 }}>
                  {connecting ? 'Connecting…' : 'Connect Drive & Choose Folder'}
                </button>
                <span style={{ fontSize: 11.5, color: T.textFaint }}>One-time per client — every upload after this goes straight there.</span>
                {uploadError && <div style={{ width: '100%', fontSize: 11.5, color: T.rose }}>{uploadError}</div>}
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
                  <span style={{ fontSize: 11.5, color: T.textFaint }}>
                    Saving to <strong style={{ color: T.textDim }}>{pickedFolder.name}</strong>
                    {' · '}
                    <button onClick={changeFolder} style={{ background: 'none', border: 'none', color: T.gold, fontSize: 11.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Change</button>
                    {' · '}
                    <button onClick={() => ensureAccessToken(true).catch(err => setUploadError(err?.message || 'Reconnect failed'))}
                      style={{ background: 'none', border: 'none', color: T.gold, fontSize: 11.5, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Reconnect</button>
                  </span>
                </div>
                {uploadError && <div style={{ marginBottom: 10, padding: '0 2px', fontSize: 11.5, color: T.rose }}>{uploadError}</div>}

                <div
                  className="claims-scroll"
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files, null) }}
                  style={{
                    display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, borderRadius: 16,
                    outline: dragOver ? `2px dashed ${T.gold}` : 'none', outlineOffset: 4,
                    background: dragOver ? T.goldSoft : 'transparent', transition: 'background .15s',
                  }}>
                  {[...approvedDocs, ...pendingDocs, ...generalDocs].map(doc => {
                    const status: 'approved' | 'pending' | null =
                      approvedDocs.includes(doc) ? 'approved' : pendingDocs.includes(doc) ? 'pending' : null
                    return <DocCard key={doc.id} doc={doc} status={status} onDelete={() => deleteDocument(doc)} />
                  })}
                  <label style={{
                    width: 168, flexShrink: 0, borderRadius: 16, border: `1.5px dashed rgba(231,188,114,.35)`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
                    color: T.gold, fontSize: 11.5, fontWeight: 700, cursor: uploading ? 'default' : 'pointer',
                    opacity: uploading ? 0.6 : 1, minHeight: 108,
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 16V4M12 4l-4 4M12 4l4 4" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
                    </svg>
                    {uploading ? 'Uploading…' : 'General Doc'}
                    <input type="file" multiple disabled={uploading}
                      onChange={e => { if (e.target.files?.length) uploadFiles(e.target.files, null); e.target.value = '' }}
                      style={{ display: 'none' }} />
                  </label>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── SUBCOMPONENTS ──────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, marginBottom: 6 }}>{children}</label>
}

function Ring({ pct }: { pct: number }) {
  const r = 34, c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
      <svg width={80} height={80} viewBox="0 0 80 80" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(28,26,23,.08)" strokeWidth={6} />
        <circle cx={40} cy={40} r={r} fill="none" stroke={T.gold} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="claims-serif" style={{ fontSize: 17, color: T.text }}>{pct}%</div>
        <div style={{ fontSize: 7.5, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint }}>Cleared</div>
      </div>
    </div>
  )
}

function LineItemCard({ item, expanded, onToggle, onSave, onDelete, documents, pickedFolder, uploading, onUploadFiles, onDeleteDocument, typeOptions, accent }: {
  item: LineItemRow; expanded: boolean; onToggle: () => void
  onSave: (patch: Partial<LineItemRow>) => void; onDelete: () => void
  documents: ClaimDocument[]; pickedFolder: { id: string; name: string } | null; uploading: boolean
  onUploadFiles: (files: FileList | File[]) => void; onDeleteDocument: (doc: ClaimDocument) => void
  typeOptions: string[]; accent: { text: string; soft: string }
}) {
  const [dragOver, setDragOver] = useState(false)
  const [draft, setDraft] = useState(item)
  useEffect(() => setDraft(item), [item])
  function commit(patch: Partial<LineItemRow>) { setDraft(prev => ({ ...prev, ...patch })); onSave(patch) }

  return (
    <div style={{ ...cardBase, padding: 0, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', cursor: 'pointer' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.approved ? T.emerald : T.rose, boxShadow: `0 0 0 3px ${item.approved ? T.emeraldSoft : T.roseSoft}`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: accent.text, background: accent.soft, padding: '2px 7px', borderRadius: 5 }}>{item.type || '—'}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.description || '(no description)'}</span>
          </div>
          <div className="claims-mono" style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3 }}>
            {item.invoice_no || '—'} · {fmtDate(item.date_from)}
            {documents.length > 0 && <> · {documents.length} doc{documents.length > 1 ? 's' : ''}</>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="claims-serif" style={{ fontSize: 17, color: T.text }}>{money(item.amount_claimed)}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: item.approved ? T.emerald : T.rose, marginTop: 2 }}>{item.approved ? `Approved ${money(item.amount_approved)}` : 'Pending'}</div>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '4px 15px 16px', borderTop: `1px solid ${T.line}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <div><FieldLabel>Type</FieldLabel>
              <select className="claims-select" value={draft.type || ''} onChange={e => commit({ type: e.target.value })}>
                {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><FieldLabel>Invoice / Claim No.</FieldLabel><input className="claims-input" value={draft.invoice_no || ''} onChange={e => setDraft({ ...draft, invoice_no: e.target.value })} onBlur={() => commit({ invoice_no: draft.invoice_no })} /></div>
            <div><FieldLabel>Date From</FieldLabel><DateInput value={draft.date_from || ''} onChange={v => commit({ date_from: v || null })} className="claims-input" dark /></div>
            <div><FieldLabel>Date To</FieldLabel><DateInput value={draft.date_to || ''} onChange={v => commit({ date_to: v || null })} className="claims-input" dark /></div>
            <div style={{ gridColumn: '1/-1' }}><FieldLabel>Description</FieldLabel><input className="claims-input" value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} onBlur={() => commit({ description: draft.description })} /></div>
            <div><FieldLabel>Amount Claimed</FieldLabel><input className="claims-input claims-mono" type="number" value={draft.amount_claimed || ''} onChange={e => setDraft({ ...draft, amount_claimed: e.target.value === '' ? 0 : +e.target.value })} onBlur={() => commit({ amount_claimed: draft.amount_claimed })} /></div>
            <div><FieldLabel>Submitted</FieldLabel><DateInput value={draft.submitted_date || ''} onChange={v => commit({ submitted_date: v || null })} className="claims-input" dark /></div>
            <div><FieldLabel>Date Approved</FieldLabel><DateInput value={draft.date_approved || ''} onChange={v => commit({ date_approved: v || null })} className="claims-input" dark /></div>
            <div><FieldLabel>Amount Approved</FieldLabel><input className="claims-input claims-mono" type="number" value={draft.amount_approved || ''} onChange={e => setDraft({ ...draft, amount_approved: e.target.value === '' ? 0 : +e.target.value })} onBlur={() => commit({ amount_approved: draft.amount_approved })} /></div>
            <div><FieldLabel>Deductible Used (This Line, $)</FieldLabel><input className="claims-input claims-mono" type="number" value={draft.deductible_clocked || ''} onChange={e => setDraft({ ...draft, deductible_clocked: e.target.value === '' ? 0 : +e.target.value })} onBlur={() => commit({ deductible_clocked: draft.deductible_clocked })} /></div>
            <div><FieldLabel>Co-Insurance Applied (This Line, $)</FieldLabel><input className="claims-input claims-mono" type="number" value={draft.coinsurance_clocked || ''} onChange={e => setDraft({ ...draft, coinsurance_clocked: e.target.value === '' ? 0 : +e.target.value })} onBlur={() => commit({ coinsurance_clocked: draft.coinsurance_clocked })} /></div>
            <div style={{ gridColumn: '1/-1' }}><FieldLabel>Remarks</FieldLabel><input className="claims-input" value={draft.remarks || ''} onChange={e => setDraft({ ...draft, remarks: e.target.value })} onBlur={() => commit({ remarks: draft.remarks })} /></div>
          </div>

          <div style={{ marginTop: 16 }}>
            <FieldLabel>Documents related to this claim</FieldLabel>
            {!pickedFolder ? (
              <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic' }}>Connect Drive in the Documents section below to attach files here.</div>
            ) : (
              <div
                className="claims-scroll"
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) onUploadFiles(e.dataTransfer.files) }}
                style={{
                  display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, borderRadius: 14,
                  outline: dragOver ? `2px dashed ${T.gold}` : 'none', outlineOffset: 3,
                  background: dragOver ? T.goldSoft : 'transparent', transition: 'background .15s',
                }}>
                {documents.map(doc => (
                  <DocCard key={doc.id} doc={doc} status={item.approved ? 'approved' : 'pending'} onDelete={() => onDeleteDocument(doc)} />
                ))}
                <label style={{
                  width: 140, flexShrink: 0, borderRadius: 14, border: `1.5px dashed rgba(231,188,114,.35)`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                  color: T.gold, fontSize: 11, fontWeight: 700, cursor: uploading ? 'default' : 'pointer',
                  opacity: uploading ? 0.6 : 1, minHeight: 88,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 16V4M12 4l-4 4M12 4l4 4" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
                  </svg>
                  {uploading ? 'Uploading…' : 'Add Document'}
                  <input type="file" multiple disabled={uploading}
                    onChange={e => { if (e.target.files?.length) onUploadFiles(e.target.files); e.target.value = '' }}
                    style={{ display: 'none' }} />
                </label>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: T.textDim }}>
              <input type="checkbox" checked={draft.approved} onChange={e => commit({ approved: e.target.checked })} style={{ width: 17, height: 17, accentColor: T.emerald }} />
              Insurer approved this line
            </label>
            <button onClick={onDelete} style={{ background: 'none', border: 'none', color: T.rose, fontSize: 12, fontWeight: 700, padding: '6px 8px', cursor: 'pointer' }}>Delete line</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FollowupCard({ item, notes, resolved, draft, onDraftChange, onAddNote, onDeleteNote, onStatusChange }: {
  item: LineItemRow; notes: FollowupNote[]; resolved?: boolean
  draft: string; onDraftChange: (v: string) => void
  onAddNote: () => void; onDeleteNote: (noteId: string) => void
  onStatusChange: (status: string) => void
}) {
  const days = daysSince(item.submitted_date || item.date_from)
  const stale = !resolved && days !== null && days >= 14

  return (
    <div style={{ ...cardBase, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.goldText, background: T.goldSoft, padding: '2px 7px', borderRadius: 5 }}>{item.type || '—'}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.description || '(no description)'}</span>
          </div>
          <div className="claims-mono" style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3 }}>
            {item.invoice_no || '—'} · {money(item.amount_claimed)}
            {days !== null && !resolved && <span style={{ color: stale ? T.rose : T.textFaint, fontWeight: stale ? 700 : 400 }}> · {days}d idle</span>}
          </div>
        </div>
        {!resolved ? (
          <select className="claims-select" value={item.followup_status || 'Submitted'} onChange={e => onStatusChange(e.target.value)} style={{ width: 160, height: 32, flexShrink: 0 }}>
            <option value="Submitted">Submitted</option>
            <option value="Pending Documents">Pending Documents</option>
          </select>
        ) : (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: T.emerald, flexShrink: 0 }}>Approved {money(item.amount_approved)}</span>
        )}
      </div>

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {notes.length === 0 && <div style={{ fontSize: 11.5, color: T.textFaint, fontStyle: 'italic' }}>No notes yet.</div>}
        {notes.map(n => (
          <div key={n.id} style={{ fontSize: 11.5, background: T.void2, borderRadius: 8, padding: '6px 9px', border: `1px solid ${T.line}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div><span className="claims-mono" style={{ fontWeight: 700, color: T.gold, marginRight: 6, fontSize: 10.5 }}>{fmtDate(n.note_date)}</span>{n.text}</div>
            <button onClick={() => onDeleteNote(n.id)} style={{ background: 'none', border: 'none', color: T.rose, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input className="claims-input" value={draft} placeholder="Add a note…"
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddNote() } }}
          style={{ flex: 1 }} />
        <button onClick={onAddNote} style={addBtn}>Add</button>
      </div>
    </div>
  )
}

function DocCard({ doc, status, onDelete }: { doc: ClaimDocument; status: 'approved' | 'pending' | null; onDelete: () => void }) {
  const isImage = (doc.mime_type || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic)$/i.test(doc.file_name)
  const kind = isImage ? 'IMG' : (doc.file_name.toLowerCase().endsWith('.pdf') ? 'PDF' : (doc.mime_type?.split('/')[1]?.slice(0, 3).toUpperCase() || 'DOC'))
  const kindColor = isImage ? T.gold : T.emerald
  const kindSoft = isImage ? T.goldSoft : T.emeraldSoft
  const statusColor = status === 'approved' ? T.emerald : status === 'pending' ? T.rose : T.textFaint
  const statusLabel = status === 'approved' ? 'APPROVED' : status === 'pending' ? 'PENDING' : 'GENERAL'

  return (
    <div style={{ ...cardBase, padding: 12, width: 168, flexShrink: 0, position: 'relative' }}>
      <button onClick={onDelete} style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: T.textFaint, fontSize: 12, cursor: 'pointer', lineHeight: 1 }}>✕</button>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: kindSoft, color: kindColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3 }}>{kind}</div>
      <a href={doc.drive_view_url || '#'} target="_blank" rel="noopener noreferrer"
        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: 10, fontSize: 12.5, fontWeight: 600, color: T.text, textDecoration: 'none', lineHeight: 1.3, minHeight: 32 }}>
        {doc.file_name}
      </a>
      <div className="claims-mono" style={{ fontSize: 10, color: T.textFaint, marginTop: 6 }}>{fmtFileSize(doc.file_size)} · {fmtDate(doc.uploaded_at)}</div>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, color: statusColor, marginTop: 6 }}>{statusLabel}</div>
    </div>
  )
}

// ─── DESIGN TOKENS ──────────────────────────────────────────────────────────

// void1/2/3 named for backward compat with the ~70 T.void* references
// throughout this file (page bg → deepest card surface, ascending contrast) —
// they now point at the app's cream scale instead of a dark scale.
const T = {
  void1: 'var(--cream)', void2: 'var(--cream2)', void3: 'var(--cream3)',
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(42,94,70,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)',
}

const pageWrap: React.CSSProperties = { background: T.void1, minHeight: '100%', padding: 24, borderRadius: 16, color: T.text }
const cardBase: React.CSSProperties = { background: 'var(--cream)', border: `1px solid ${T.line}`, borderRadius: 14, padding: 18 }
const heroCard: React.CSSProperties = {
  padding: '24px 22px 26px', borderRadius: 16, border: `1px solid ${T.line}`,
  background: `radial-gradient(480px 240px at 50% 0%, rgba(168,131,74,.08), transparent 60%), linear-gradient(155deg, ${T.void3} 0%, ${T.void2} 60%, ${T.void1} 100%)`,
  boxShadow: '0 16px 32px -20px rgba(28,26,23,.18)',
}
const detailsToggle: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px', background: 'none', border: 'none', borderBottom: `1px solid ${T.line}`, color: T.textDim, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginTop: 16 }
const addBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: T.goldText, background: T.goldSoft, border: `1px solid rgba(168,131,74,.3)`, padding: '6px 13px', borderRadius: 999, cursor: 'pointer' }
const readonlyVal: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 10, background: T.void3, color: T.textDim, fontSize: 13 }
const pillBase: React.CSSProperties = { flexShrink: 0, padding: '8px 16px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid transparent', textAlign: 'left', fontSize: 12.5, fontWeight: 600 }
const pillActive: React.CSSProperties = { background: 'var(--charcoal)', color: 'var(--cream)', border: '1px solid var(--charcoal)' }
const pillInactive: React.CSSProperties = { background: 'var(--cream)', color: T.textDim, border: `1px solid ${T.line}` }
const msBox: React.CSSProperties = { minHeight: 38, padding: '5px 8px', border: `1px solid ${T.line}`, borderRadius: 10, background: T.void2, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', cursor: 'pointer' }
const msTag: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, background: T.goldSoft, color: T.goldText, fontSize: 11, fontWeight: 700, padding: '3px 6px 3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
const msPanel: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 25, background: 'var(--cream)', border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: '0 16px 32px rgba(28,26,23,.14)', padding: 6, maxHeight: 220, overflowY: 'auto', marginTop: 6 }
const msOption: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer', color: T.text }