'use client'
import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import GmailClaimSearch from '@/components/GmailClaimSearch'
import ServiceRequestExtras from '@/components/ServiceRequestExtras'
import { logServiceResolution } from '@/lib/policyServiceHistory'
import { useToast } from '@/components/Toast'
import { useConfirm } from '@/components/ConfirmDialog'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Premium Alerts — split out from the Service Requests board (Aug 2026) into
// its own sidebar page. Reasons, for future reference:
//  1. Marking an alert Done used to make it vanish from the board entirely
//     with no trace — this page keeps a "Recently Completed" bucket instead.
//  2. The only way to act on an alert was card -> full edit modal -> Status
//     button — 3 taps through a modal built for generic tickets. This page
//     adds a one-tap Mark Done control directly on the card.
//  3. A dedicated nav item gets its own sidebar badge (overdue + due-today
//     count — see src/lib/premiumAlertsAttention.ts), instead of being
//     invisible until you open Service Requests and scroll to find it.
// This page is deliberately simpler than Service Requests' modal: no
// Waiting-on, no custom fields, no to-dos — a premium reminder is a single
// action (draft, send, mark done), not a multi-step ticket.

// ─── TYPES ──────────────────────────────────────────────────────────────────

type Status = 'requested' | 'in_progress' | 'done'

interface PolicyLite {
  id: string
  policyNo: string
  companyName: string
  productName: string
  person: string
  policyholder: string
  premiumCash: number
  premiumMedisave: number
  premiumMode: string
  inceptionDate: string
}

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

const PREMIUM_TYPES = ['Insurance Premium Reminder', 'Investment Premium Reminder'] as const
type PremiumType = typeof PREMIUM_TYPES[number]

const PREMIUM_MSG_VARIABLES: Record<PremiumType, { key: string; label: string }[]> = {
  'Insurance Premium Reminder': [
    { key: 'client_name', label: 'Addressee' },
    { key: 'company', label: 'Company' },
    { key: 'life_assured', label: 'Life Assured' },
    { key: 'policyowner', label: 'Policyowner' },
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
    { key: 'policyowner', label: 'Policyowner' },
    { key: 'plan_name', label: 'Plan Name' },
    { key: 'policy_no', label: 'Policy No.' },
    { key: 'premium_due', label: 'Premium Due' },
    { key: 'premium_medisave', label: 'Premium — Medisave' },
    { key: 'premium_cash', label: 'Premium — Cash/Giro/Credit Card' },
    { key: 'adhoc_payment_note', label: 'Adhoc Payment' },
    { key: 'advisor_name', label: 'Advisor' },
  ],
}
const PREMIUM_FALLBACK_TEMPLATES: Record<PremiumType, string> = {
  'Insurance Premium Reminder': `Hi {{client_name}},\n\nFriendly reminder of your premium payment:\n*Company:* {{company}}\n*Life Assured:* {{life_assured}}\n*Policyowner:* {{policyowner}}\n*Plan Name:* {{plan_name}}\n*Policy No.:* {{policy_no}}\n\nYour premium was due on {{premium_due}}.\n\n*Premium required in SGD:*\n*Cash:* {{premium_cash}}\n*Medisave:* {{premium_medisave}}\n*Payment Method:* {{payment_method}}\n\nPlease kindly make payment soon to avoid lapsation. Payment can be made via {{manual_method}}.\n\nPlease kindly take a screenshot and update me once payment has been made. Thank you 😊\n\n— {{advisor_name}}`,
  'Investment Premium Reminder': `Hi {{client_name}},\n\nHope this message finds you well! 😊\n\nThis is a friendly reminder regarding your investment premium:\n*Company:* {{company}}\n*Policyowner:* {{policyowner}}\n*Plan Name:* {{plan_name}}\n*Policy/Account No.:* {{policy_no}}\n\nYour premium was due on {{premium_due}}.\n\n*Premium required in SGD:*\n*Medisave:* {{premium_medisave}}\n*Cash/Giro/Credit Card:* {{premium_cash}}\n\nYou can also make an ad-hoc payment via {{adhoc_payment_note}}.\n\nThank you!\n\n— {{advisor_name}}`,
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
function defaultPremiumDueDate(policy: PolicyLite | null): string {
  if (!policy?.inceptionDate) return ''
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(policy.inceptionDate)
  if (!m) return ''
  return `${new Date().getFullYear()}-${m[1]}-${m[2]}`
}
function substituteMsgVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m))
}
function waLink(phoneRaw: string, text: string): string | null {
  const digits = phoneRaw.replace(/[^\d]/g, '').replace(/^0+/, '')
  if (digits.length < 8) return null
  const withCountry = digits.startsWith('65') && digits.length > 8 ? digits : `65${digits}`
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`
}
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

interface ServiceRequestRow {
  id: string
  client_id: string
  request_type: string
  description: string
  policy_label: string | null
  policy_id: string | null
  field_values: Record<string, string>
  status: Status
  waiting_on: 'client' | 'firm' | null
  created_by: string
  resolved_at: string | null
  created_at: string
  updated_at: string
}

const RESOLVED_VISIBLE_DAYS = 30 // matches the Kanban Done column elsewhere, for consistency

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)',
}

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

export default function PremiumAlertsPage() {
  const { advisor, clients, spouseNames, authLoading } = useDashboard()
  const router = useRouter()
  const supabase = createClient()
  const toast = useToast()
  const confirmAction = useConfirm()
  const narrow = useNarrow(560)

  const hasAccess = advisor?.id === CREATOR_ID ||
    (Array.isArray(advisor?.beta_features) && advisor.beta_features.includes('servicing') && advisor.beta_features.includes('business_dashboard'))

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ServiceRequestRow[]>([])
  const [alertFilter, setAlertFilter] = useState<'all' | PremiumType>('all')
  const [laterOpen, setLaterOpen] = useState(false)
  const [recentlyDoneOpen, setRecentlyDoneOpen] = useState(false)

  const [policiesByClient, setPoliciesByClient] = useState<Record<string, PolicyLite[]>>({})
  const [familyByClient, setFamilyByClient] = useState<Record<string, FamilyMemberLite[]>>({})

  const [editingId, setEditingId] = useState<string | null>(null)
  const [premiumComposerOpen, setPremiumComposerOpen] = useState(true) // open by default — this page's whole job is drafting the message
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

  const [addressingTo, setAddressingTo] = useState('')
  const [customNumber, setCustomNumber] = useState('')

  // ── quick-add ──
  const [newClientName, setNewClientName] = useState('')
  const [newType, setNewType] = useState<PremiumType>('Insurance Premium Reminder')
  const [newSaving, setNewSaving] = useState(false)
  const [newError, setNewError] = useState('')
  const newClientRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  useEffect(() => {
    if (authLoading || !hasAccess) { setLoading(false); return }
    let cancelled = false
    supabase.from('service_requests').select('*').in('request_type', ['Insurance Premium Reminder', 'Investment Premium Reminder'])
      .then(({ data }: any) => {
        if (cancelled) return
        setRows((data || []).map((r: any) => ({ ...r, field_values: r.field_values || {} })) as ServiceRequestRow[])
        setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, hasAccess])

  const clientsById = useMemo(() => {
    const map: Record<string, string> = {}
    clients.forEach(c => { map[c.id] = c.name })
    return map
  }, [clients])

  const editingRow = editingId ? rows.find(r => r.id === editingId) || null : null

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
          policyholder: p.policyholder || '',
          premiumCash: p.premiumCash || 0, premiumMedisave: p.premiumMedisave || 0, premiumMode: p.premiumMode || '', inceptionDate: p.inceptionDate || '',
        }))
        setPoliciesByClient(prev => ({ ...prev, [clientId]: list }))
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow?.client_id])

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

  useEffect(() => {
    if (!advisor) return
    supabase.from('manual_payment_methods').select('*').order('created_at', { ascending: true })
      .then(({ data }) => setManualMethods((data || []) as ManualPaymentMethod[]))
  }, [advisor?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function patchRow(id: string, patch: Partial<ServiceRequestRow>) {
    const withTimestamp = { ...patch, updated_at: new Date().toISOString() }
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...withTimestamp } : r))
    const { error } = await supabase.from('service_requests').update(withTimestamp).eq('id', id)
    if (error) toast('Save failed: ' + error.message, 'error')
  }

  function setFieldValue(row: ServiceRequestRow, key: string, value: string) {
    patchRow(row.id, { field_values: { ...row.field_values, [key]: value } })
  }

  async function logResolutionFor(id: string) {
    const row = rows.find(r => r.id === id)
    if (!row) return
    await logServiceResolution(supabase, {
      id: row.id, client_id: row.client_id, policy_id: row.policy_id,
      policy_label: row.policy_label, request_type: row.request_type, description: row.description,
    })
  }

  // One-tap mark done / undo — the fix for "once done it disappears": status
  // still flips to 'done' (same field, same write, same Servicing History log
  // as before) but the row stays visible in Recently Completed instead of
  // vanishing, and can be undone from right there.
  async function setDone(id: string, done: boolean) {
    await patchRow(id, { status: done ? 'done' : 'requested', resolved_at: done ? new Date().toISOString() : null })
    if (done) await logResolutionFor(id)
  }

  async function deleteRequest(id: string) {
    if (!await confirmAction('Delete this premium alert? This cannot be undone.', { danger: true, confirmLabel: 'Delete' })) return
    setRows(prev => prev.filter(r => r.id !== id))
    setEditingId(null)
    const { error } = await supabase.from('service_requests').delete().eq('id', id)
    if (error) toast('Delete failed: ' + error.message, 'error')
  }

  // ── quick-add ──
  async function submitQuickAdd() {
    setNewError('')
    const name = newClientName.trim()
    if (!name) return
    let client = clients.find(c => c.name.toLowerCase() === name.toLowerCase())
    let personKey: string | null = null
    if (!client) {
      const m = name.match(/^(.+?)\s+—\s+spouse of\s+(.+)$/i)
      if (m) {
        const spouseName = m[1].trim(), clientName = m[2].trim()
        const match = clients.find(c => c.name.toLowerCase() === clientName.toLowerCase() && (spouseNames[c.id] || '').toLowerCase() === spouseName.toLowerCase())
        if (match) { client = match; personKey = 'spouse' }
      }
    }
    if (!client) { setNewError(`No client named "${name}" — check the spelling or pick from the list.`); return }
    setNewSaving(true)
    const insertPayload: any = { client_id: client.id, request_type: newType, description: newType, status: 'requested' }
    if (personKey) insertPayload.field_values = { life_assured_override: personKey }
    const { data, error } = await supabase.from('service_requests').insert(insertPayload).select().maybeSingle()
    setNewSaving(false)
    if (error) { setNewError('Could not save: ' + error.message); return }
    if (data) {
      const row = { ...(data as any), field_values: (data as any).field_values || {} } as ServiceRequestRow
      setRows(prev => [...prev, row])
      setEditingId(row.id) // jump straight into drafting the reminder
    }
    setNewClientName('')
    newClientRef.current?.focus()
  }

  // ── Premium-specific derived state (only meaningful when editingRow set) ──
  const editingPremiumType: PremiumType | null = editingRow ? (editingRow.request_type as PremiumType) : null
  const editingPolicyFull: PolicyLite | null = editingRow?.policy_id
    ? (policiesByClient[editingRow.client_id] || []).find(p => p.id === editingRow.policy_id) || null
    : null
  const premiumContextType = editingPremiumType === 'Investment Premium Reminder' ? 'premium_reminder_investment' : 'premium_reminder_insurance'

  const selectedPersonKey: string = editingRow ? (editingRow.field_values?.life_assured_override || editingPolicyFull?.person || 'client') : 'client'

  function personKeyFor(f: FamilyMemberLite): string {
    return (f.relationship || '').toLowerCase() === 'spouse' ? 'spouse' : `child_${f.id}`
  }
  function personOptionsFor(clientId: string): { key: string; label: string; rel: string }[] {
    const family = familyByClient[clientId] || []
    return [
      { key: 'client', label: clientsById[clientId] || 'Client', rel: 'client' },
      ...family.map(f => ({ key: personKeyFor(f), label: f.name, rel: f.relationship || 'dependent' })),
    ]
  }
  function personMatchesFilter(policyPerson: string, filterKey: string): boolean {
    if (!filterKey || filterKey === 'client') return policyPerson === 'client' || policyPerson.startsWith('child_')
    if (filterKey === 'spouse') return policyPerson === 'spouse' || policyPerson.startsWith('child_')
    if (filterKey.startsWith('child_')) return policyPerson === filterKey
    return true
  }
  function personLabelForKey(clientId: string, key: string): string {
    if (!key || key === 'client') return clientsById[clientId] || 'Client'
    const family = familyByClient[clientId] || []
    if (key.startsWith('child_')) {
      const fid = key.slice('child_'.length)
      return family.find(f => f.id === fid)?.name || key
    }
    const bySpouse = family.find(f => (f.relationship || '').toLowerCase() === 'spouse')
    if (key === 'spouse' && bySpouse) return bySpouse.name
    return family.find(f => f.id === key)?.name || key
  }

  const personOptions = editingRow ? personOptionsFor(editingRow.client_id) : []
  const filteredPolicies: PolicyLite[] = editingRow
    ? (policiesByClient[editingRow.client_id] || []).filter(p => personMatchesFilter(p.person, selectedPersonKey))
    : []

  function setSelectedPerson(key: string) {
    if (!editingRow) return
    setFieldValue(editingRow, 'life_assured_override', key)
    if (editingRow.policy_id) {
      const current = (policiesByClient[editingRow.client_id] || []).find(p => p.id === editingRow.policy_id)
      if (current && !personMatchesFilter(current.person, key)) patchRow(editingRow.id, { policy_id: null })
    }
  }

  const addressingOptions: { id: string; label: string; phone: string | null }[] = editingRow ? [
    { id: 'client', label: `${clientsById[editingRow.client_id] || 'Client'} — client`, phone: clients.find(c => c.id === editingRow.client_id)?.phone || null },
    ...((familyByClient[editingRow.client_id] || []).filter(f => f.phone).map(f => ({ id: f.id, label: `${f.name} — ${f.relationship || 'family'}`, phone: f.phone }))),
    ...(advisor?.phone ? [{ id: 'self', label: `Myself — ${advisor.name || 'Advisor'}`, phone: advisor.phone }] : []),
    { id: 'custom', label: 'Custom number…', phone: null },
  ] : []
  const selectedAddressing = addressingOptions.find(a => a.id === addressingTo) || null
  const addressingPhone = addressingTo === 'custom' ? customNumber : (selectedAddressing?.phone || '')
  const addressingName = addressingTo === 'custom' ? (customNumber ? 'there' : '') : (selectedAddressing?.label.split(' — ')[0] || '')

  useEffect(() => {
    if (!editingRow || !editingPremiumType) return
    if (addressingTo) return
    const lifeAssuredKey = editingRow.field_values?.life_assured_override || editingPolicyFull?.person || ''
    const family = familyByClient[editingRow.client_id] || []
    const lifeAssuredFamilyMember = family.find(f => f.name === personLabelForKey(editingRow.client_id, lifeAssuredKey))
    if (lifeAssuredFamilyMember?.phone) setAddressingTo(lifeAssuredFamilyMember.id)
    else setAddressingTo('client')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow?.id, editingPolicyFull, Object.keys(familyByClient).length])

  useEffect(() => {
    setAddressingTo(''); setCustomNumber(''); setPremiumComposerOpen(true); setMsgEdited(false); setMsgSequence(''); setMsgBody('')
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
      premium_due: fmtDateSG(fv.premium_due_date || defaultPremiumDueDate(editingPolicyFull)),
      policyowner: editingPolicyFull?.policyholder || '—',
      advisor_name: advisor?.name || '',
    }
    if (editingPremiumType === 'Insurance Premium Reminder') {
      return {
        ...base,
        premium_cash: fv.premium_cash_override || money(editingPolicyFull?.premiumCash || 0),
        premium_medisave: fv.premium_medisave_override || money(editingPolicyFull?.premiumMedisave || 0),
        payment_method: fv.payment_method || editingPolicyFull?.premiumMode || '—',
        manual_method: fv.manual_method || '—',
      }
    }
    return {
      ...base,
      premium_cash: fv.premium_cash_override || money(editingPolicyFull?.premiumCash || 0),
      premium_medisave: fv.premium_medisave_override || money(editingPolicyFull?.premiumMedisave || 0),
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

  if (!hasAccess) return null

  // ── bucketing for the card list ──
  const today = new Date(); today.setHours(0, 0, 0, 0)
  function bucketFor(row: ServiceRequestRow): 'overdue' | 'today' | 'week' | 'later' {
    const due = row.field_values?.premium_due_date
    if (!due) return 'later'
    const d = new Date(due + 'T00:00:00')
    if (isNaN(d.getTime())) return 'later'
    const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
    if (diffDays < 0) return 'overdue'
    if (diffDays === 0) return 'today'
    if (diffDays <= 7) return 'week'
    return 'later'
  }

  const openRows = rows.filter(r => r.status !== 'done')
  const filtered = alertFilter === 'all' ? openRows : openRows.filter(r => r.request_type === alertFilter)
  const byBucket = { overdue: [] as ServiceRequestRow[], today: [] as ServiceRequestRow[], week: [] as ServiceRequestRow[], later: [] as ServiceRequestRow[] }
  filtered.forEach(r => byBucket[bucketFor(r)].push(r))
  ;(Object.keys(byBucket) as (keyof typeof byBucket)[]).forEach(k =>
    byBucket[k].sort((a, b) => (a.field_values?.premium_due_date || '9999-12-31').localeCompare(b.field_values?.premium_due_date || '9999-12-31')))

  const recentlyDone = rows
    .filter(r => r.status === 'done')
    .filter(r => { const d = daysSince(r.resolved_at || r.updated_at); return d !== null && d <= RESOLVED_VISIBLE_DAYS })
    .sort((a, b) => new Date(b.resolved_at || b.updated_at).getTime() - new Date(a.resolved_at || a.updated_at).getTime())

  const renderCard = (row: ServiceRequestRow, done: boolean) => {
    const policy = resolvedPolicy(row)
    const due = row.field_values?.premium_due_date
    return (
      <div key={row.id} style={{
        display: 'flex', alignItems: 'center', gap: 10, background: 'white',
        border: `1px solid ${done ? T.emeraldSoft : T.roseSoft}`, borderLeft: `3px solid ${done ? T.emerald : T.rose}`,
        borderRadius: 10, padding: '12px 12px 12px 14px', marginBottom: 8, opacity: done ? 0.9 : 1,
      }}>
        <div onClick={() => setEditingId(row.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div className="font-serif" style={{ fontSize: 16.5, fontWeight: 600, color: T.text }}>{clientsById[row.client_id] || 'Unknown client'}</div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: done ? T.emeraldSoft : T.roseSoft, color: done ? T.emerald : T.rose, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {row.request_type === 'Investment Premium Reminder' ? 'Investment' : 'Insurance'}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: T.textFaint, marginTop: 4 }}>{policy?.label || 'No policy attached'}</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: done ? T.emerald : T.rose, marginTop: 6, fontWeight: 500 }}>
            {done
              ? `Done · ${daysSince(row.resolved_at || row.updated_at) === 0 ? 'today' : `${daysSince(row.resolved_at || row.updated_at)}d ago`}`
              : `${row.field_values?.sequence || 'Reminder'}${due ? ` · due ${fmtDateSG(due)}` : ''}`}
          </div>
        </div>
        {done ? (
          <button onClick={() => setDone(row.id, false)} title="Undo — move back to open"
            style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: T.textFaint, background: 'none', border: `1px solid ${T.line}`, borderRadius: 999, padding: '8px 12px', minHeight: 36, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ↺ Undo
          </button>
        ) : (
          <button onClick={() => setDone(row.id, true)} title="Mark done"
            style={{ flexShrink: 0, width: 40, height: 40, borderRadius: 999, border: `1.5px solid ${T.line}`, background: 'var(--cream2)', color: T.textFaint, fontSize: 17, cursor: 'pointer' }}>
            ✓
          </button>
        )}
      </div>
    )
  }
  const bucketHeader = (label: string, count: number) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, marginBottom: 8, marginTop: 14 }}>
      {label} · {count}
    </div>
  )

  return (
    <div style={{ padding: 24, background: 'var(--cream)', minHeight: '100%', borderRadius: 16 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.gold, fontWeight: 700 }}>Business Dashboard</div>
        <div className="font-serif" style={{ fontSize: 26, marginTop: 5, color: T.text }}>Premium Alerts</div>
        <div style={{ fontSize: 12.5, color: T.textFaint, marginTop: 4 }}>
          {loading ? 'Loading…' : `${openRows.length} open · ${byBucket.overdue.length} overdue`}
        </div>
      </div>

      {/* ── quick-add ── */}
      <div style={{ background: 'white', border: `1px solid ${T.line}`, borderRadius: 12, padding: '12px 14px', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            ref={newClientRef}
            list="premium-clients-datalist"
            value={newClientName}
            onChange={e => setNewClientName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd() }}
            placeholder="Client — start typing…"
            style={{ flex: '1 1 180px', minWidth: 160, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}
          />
          <datalist id="premium-clients-datalist">
            {clients.map(c => <option key={c.id} value={c.name} />)}
            {clients.filter(c => spouseNames[c.id]).map(c => (
              <option key={c.id + '-spouse'} value={`${spouseNames[c.id]} — spouse of ${c.name}`} />
            ))}
          </datalist>
          <div style={{ display: 'flex', gap: 6 }}>
            {PREMIUM_TYPES.map(t => (
              <button key={t} onClick={() => setNewType(t)}
                style={{ padding: '9px 13px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${newType === t ? 'var(--charcoal)' : T.line}`, background: newType === t ? 'var(--charcoal)' : 'white', color: newType === t ? 'white' : T.textDim, whiteSpace: 'nowrap' }}>
                {t === 'Investment Premium Reminder' ? 'Investment' : 'Insurance'}
              </button>
            ))}
          </div>
          <button onClick={submitQuickAdd} disabled={newSaving || !newClientName.trim()}
            style={{ padding: '9px 16px', fontSize: 12.5, fontWeight: 700, color: 'white', background: T.text, border: 'none', borderRadius: 8, cursor: newSaving ? 'default' : 'pointer', opacity: newSaving || !newClientName.trim() ? 0.5 : 1 }}>
            {newSaving ? 'Adding…' : '+ New Alert'}
          </button>
        </div>
        {newError && <div style={{ fontSize: 11.5, color: T.rose, marginTop: 8 }}>{newError}</div>}
      </div>

      {/* ── filter chips ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['all', 'Insurance Premium Reminder', 'Investment Premium Reminder'] as const).map(f => (
          <button key={f} onClick={() => setAlertFilter(f)}
            style={{ flex: narrow ? 1 : undefined, justifyContent: 'center', display: 'flex', alignItems: 'center', minHeight: 32, padding: '6px 13px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${alertFilter === f ? T.rose : T.line}`, background: alertFilter === f ? T.roseSoft : 'white', color: alertFilter === f ? T.rose : T.textFaint }}>
            {f === 'all' ? 'All' : f === 'Investment Premium Reminder' ? 'Investment' : 'Insurance'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: T.textFaint, fontSize: 13 }}>Loading premium alerts…</div>
      ) : (
        <div style={{ maxWidth: 640 }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 12.5, color: T.textFaint, fontStyle: 'italic', padding: '10px 2px' }}>Nothing open right now.</div>
          ) : (
            <>
              {byBucket.overdue.length > 0 && (<>{bucketHeader('Overdue', byBucket.overdue.length)}{byBucket.overdue.map(r => renderCard(r, false))}</>)}
              {byBucket.today.length > 0 && (<>{bucketHeader('Due Today', byBucket.today.length)}{byBucket.today.map(r => renderCard(r, false))}</>)}
              {byBucket.week.length > 0 && (<>{bucketHeader('This Week', byBucket.week.length)}{byBucket.week.map(r => renderCard(r, false))}</>)}
              {byBucket.later.length > 0 && (
                <>
                  <button onClick={() => setLaterOpen(o => !o)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0 8px', marginTop: 6, textAlign: 'left' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint }}>Later · {byBucket.later.length}</div>
                    <span style={{ color: T.textFaint, fontSize: 12, transform: laterOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
                  </button>
                  {laterOpen && byBucket.later.map(r => renderCard(r, false))}
                </>
              )}
            </>
          )}

          {/* ── recently completed — the fix for "once done it disappears" ── */}
          {recentlyDone.length > 0 && (
            <>
              <button onClick={() => setRecentlyDoneOpen(o => !o)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 2px 8px', marginTop: 10, borderTop: `1px solid ${T.line}`, textAlign: 'left' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint }}>Recently Completed · {recentlyDone.length}</div>
                <span style={{ color: T.textFaint, fontSize: 12, transform: recentlyDoneOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
              </button>
              {recentlyDoneOpen && recentlyDone.map(r => renderCard(r, true))}
            </>
          )}
        </div>
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
                  {editingRow.request_type === 'Investment Premium Reminder' ? 'Investment' : 'Insurance'} Premium Reminder
                  {resolvedPolicy(editingRow) ? ` · ${resolvedPolicy(editingRow)!.label}` : ''}
                </div>
              </div>
              <button onClick={() => setEditingId(null)} style={{ background: 'none', border: 'none', color: T.textFaint, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
            </div>

            <div style={{ padding: '18px 24px 24px' }}>
              <button onClick={() => setDone(editingRow.id, editingRow.status !== 'done')}
                style={{
                  width: '100%', padding: '11px 6px', borderRadius: 9, fontSize: 13, fontWeight: 700, textAlign: 'center', cursor: 'pointer',
                  border: `1.5px solid ${editingRow.status === 'done' ? T.emerald : 'var(--charcoal)'}`,
                  background: editingRow.status === 'done' ? T.emeraldSoft : 'var(--charcoal)',
                  color: editingRow.status === 'done' ? T.emerald : 'white',
                }}>
                {editingRow.status === 'done' ? '✓ Done — click to reopen' : 'Mark Done'}
              </button>

              <SectionLabel>Person</SectionLabel>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
                {personOptions.map(p => (
                  <button key={p.key} onClick={() => setSelectedPerson(p.key)}
                    style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1.5px solid ${selectedPersonKey === p.key ? 'var(--charcoal)' : T.line}`, background: selectedPersonKey === p.key ? 'var(--charcoal)' : 'white', color: selectedPersonKey === p.key ? 'white' : T.textDim }}>
                    {p.label}{p.rel && p.rel !== 'client' ? <span style={{ opacity: 0.65, fontWeight: 500, marginLeft: 3 }}>{p.rel.toLowerCase()}</span> : null}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 10 }}>Filters the policy list below to this person's policies plus all dependents'.</div>

              <SectionLabel>Policy <span style={{ fontWeight: 500, color: T.textFaint, textTransform: 'none', letterSpacing: 0 }}>({filteredPolicies.length} of {(policiesByClient[editingRow.client_id] || []).length} shown)</span></SectionLabel>
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
                  {filteredPolicies.map(p => (
                    <option key={p.id} value={p.id}>{p.productName || 'Untitled plan'} — {p.policyNo || 'no policy no.'} — {personLabelForKey(editingRow.client_id, p.person)}</option>
                  ))}
                </select>
              ) : editingRow.policy_id ? (
                <select value={editingRow.policy_id} onChange={e => patchRow(editingRow.id, { policy_id: e.target.value || null })}
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }}>
                  {(filteredPolicies.some(p => p.id === editingRow.policy_id) ? filteredPolicies : [editingPolicyFull, ...filteredPolicies].filter((p): p is PolicyLite => !!p)).map(p => (
                    <option key={p.id} value={p.id}>{p.productName || 'Untitled plan'} — {p.policyNo || 'no policy no.'} — {personLabelForKey(editingRow.client_id, p.person)}</option>
                  ))}
                </select>
              ) : (
                <input defaultValue={editingRow.policy_label || ''} onBlur={e => patchRow(editingRow.id, { policy_label: e.target.value.trim() || '' })}
                  placeholder="e.g. new application with XYZ Insurance"
                  style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream)', color: T.text, fontSize: 12.5 }} />
              )}

              {/* ── Draft a Reminder Message ── */}
              <button onClick={() => setPremiumComposerOpen(o => !o)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0', borderTop: `1px solid ${T.line}`, marginTop: 16, textAlign: 'left' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>Draft a Reminder Message</div>
                <span style={{ color: T.textFaint, fontSize: 13, transform: premiumComposerOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
              </button>
              {premiumComposerOpen && editingPremiumType && (
                <div style={{ background: 'var(--cream)', border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, marginTop: 4 }}>

                  <SectionLabel>Who</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <FieldLabel>Life Assured</FieldLabel>
                      <div style={{ padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'var(--cream2)', color: T.textDim, fontSize: 12.5 }}>
                        {personLabelForKey(editingRow.client_id, selectedPersonKey)}
                        <span style={{ color: T.textFaint }}> — set via Person above</span>
                      </div>
                    </div>
                    <div>
                      <FieldLabel>Addressing To (recipient)</FieldLabel>
                      <select value={addressingTo} onChange={e => setAddressingTo(e.target.value)}
                        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }}>
                        {addressingOptions.map(o => <option key={o.id} value={o.id}>{o.label}{o.phone ? ` — ${o.phone}` : ''}</option>)}
                      </select>
                      {addressingTo === 'custom' && (
                        <input value={customNumber} onChange={e => setCustomNumber(e.target.value)} placeholder="e.g. 91234567 (PA, referral, anyone else)"
                          style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5, marginTop: 6 }} />
                      )}
                    </div>
                  </div>

                  <SectionLabel>From policy on file</SectionLabel>
                  {editingPolicyFull ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', background: 'white', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>
                      <div><span style={{ color: T.textFaint, fontSize: 10 }}>Company</span><div style={{ fontWeight: 600 }}>{editingPolicyFull.companyName || '—'}</div></div>
                      <div><span style={{ color: T.textFaint, fontSize: 10 }}>Plan Name</span><div style={{ fontWeight: 600 }}>{editingPolicyFull.productName || '—'}</div></div>
                      <div><span style={{ color: T.textFaint, fontSize: 10 }}>Policy No.</span><div style={{ fontWeight: 600 }}>{editingPolicyFull.policyNo || '—'}</div></div>
                      <div><span style={{ color: T.textFaint, fontSize: 10 }}>Policyowner</span><div style={{ fontWeight: 600 }}>{editingPolicyFull.policyholder || '—'}</div></div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>Select a policy above to auto-fill company / plan / policy no.</div>
                  )}

                  <SectionLabel>This reminder</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <FieldLabel>Premium Due Date <span style={{ fontWeight: 400, color: T.textFaint }}>(dd/mm from policy, year defaults to this year — editable)</span></FieldLabel>
                      <input type="date"
                        defaultValue={editingRow.field_values?.premium_due_date || defaultPremiumDueDate(editingPolicyFull)}
                        onBlur={e => setFieldValue(editingRow, 'premium_due_date', e.target.value)}
                        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }} />
                    </div>

                    {editingPremiumType === 'Insurance Premium Reminder' && (
                      <div>
                        <FieldLabel>Payment Method <span style={{ fontWeight: 400, color: T.textFaint }}>(from policy, editable)</span></FieldLabel>
                        <input defaultValue={editingRow.field_values?.payment_method || editingPolicyFull?.premiumMode || ''} onBlur={e => setFieldValue(editingRow, 'payment_method', e.target.value)}
                          style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }} />
                      </div>
                    )}

                    <div>
                      <FieldLabel>Premium — Medisave <span style={{ fontWeight: 400, color: T.textFaint }}>(from policy, editable)</span></FieldLabel>
                      <input defaultValue={editingRow.field_values?.premium_medisave_override || (editingPolicyFull ? money(editingPolicyFull.premiumMedisave) : '')}
                        onBlur={e => setFieldValue(editingRow, 'premium_medisave_override', e.target.value)}
                        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }} />
                    </div>
                    <div>
                      <FieldLabel>Premium — Cash / Giro / Credit Card <span style={{ fontWeight: 400, color: T.textFaint }}>(from policy, editable)</span></FieldLabel>
                      <input defaultValue={editingRow.field_values?.premium_cash_override || (editingPolicyFull ? money(editingPolicyFull.premiumCash) : '')}
                        onBlur={e => setFieldValue(editingRow, 'premium_cash_override', e.target.value)}
                        style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }} />
                    </div>

                    {editingPremiumType === 'Insurance Premium Reminder' ? (
                      <div style={{ gridColumn: '1/-1' }}>
                        <FieldLabel>Manual Method</FieldLabel>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select value={editingRow.field_values?.manual_method || ''} onChange={e => setFieldValue(editingRow, 'manual_method', e.target.value)}
                            style={{ flex: 1, padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }}>
                            <option value="">Select…</option>
                            {manualMethods.map(m => <option key={m.id} value={m.label}>{m.label}</option>)}
                          </select>
                          <button onClick={() => setShowManageMethods(true)}
                            style={{ padding: '0 12px', fontSize: 12, fontWeight: 700, border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.textDim, cursor: 'pointer' }}>⚙ Manage</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ gridColumn: '1/-1' }}>
                        <FieldLabel>Adhoc Payment</FieldLabel>
                        <input defaultValue={editingRow.field_values?.adhoc_payment_note || ''} onBlur={e => setFieldValue(editingRow, 'adhoc_payment_note', e.target.value)}
                          placeholder="e.g. Email Link"
                          style={{ width: '100%', padding: '9px 11px', border: `1px solid ${T.line}`, borderRadius: 8, background: 'white', color: T.text, fontSize: 12.5 }} />
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 18, marginBottom: 10 }}>
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
                  <div style={{ whiteSpace: 'pre-wrap', minHeight: 60, lineHeight: 1.5, background: 'white', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginTop: 4 }}>{msgPreview}</div>

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

              <ModalSection title="Attachments, meetings, activity" defaultOpen={false}>
                <ServiceRequestExtras serviceRequestId={editingRow.id} clientId={editingRow.client_id} advisorId={advisor?.id || ''} />
              </ModalSection>

              <ModalSection title="Related emails" defaultOpen={false}>
                <GmailClaimSearch serviceRequestId={editingRow.id} defaultTerms={[resolvedPolicy(editingRow)?.policyNo].filter((v): v is string => !!v)} />
              </ModalSection>

              <div style={{ height: 1, background: T.line, margin: '20px 0 14px' }} />
              <button onClick={() => deleteRequest(editingRow.id)}
                style={{ fontSize: 12, fontWeight: 700, color: T.rose, background: T.roseSoft, border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>
                Delete alert
              </button>
            </div>
          </div>
        </div>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: T.textFaint, margin: '18px 0 9px' }}>{children}</div>
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: T.textDim, marginBottom: 5, display: 'block' }}>{children}</span>
}

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