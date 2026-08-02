'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Instrument_Serif, IBM_Plex_Mono } from 'next/font/google'
import { createClient } from '@/lib/supabase'
import { useDashboard } from '@/contexts/DashboardContext'
import DateInput from '@/components/DateInput'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

// Scoped to this page only — the rest of the app stays on Cormorant/Inter/DM Mono.
// Deliberately different visual language for Medical Claims (approved after
// several mockup rounds); see conversation history for the "why".
const instrumentSerif = Instrument_Serif({ subsets: ['latin'], weight: ['400'], style: ['normal', 'italic'], display: 'swap', variable: '--claims-font-serif' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--claims-font-mono' })

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
}

interface ClaimRow {
  id: string
  client_id: string
  policy_id: string
  life_assured_person: string
  label: string | null
  status: 'open' | 'closed' | 'withdrawn'
  opened_date: string
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

const SECTION_LABEL: Record<string, string> = { pre: 'Pre-Hospitalisation', in: 'Inpatient / Surgery', post: 'Post-Hospitalisation' }
const SECTION_SUB: Record<string, string> = { pre: 'Outpatient claims before admission', in: 'Hospitalisation & surgery claims', post: 'Follow-up outpatient claims' }
const TYPE_OPTIONS = ['CDL', 'Non-CDL', 'Services', 'Outpatient', 'Surgery', 'Inpatient']

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
function newLineItem(claimId: string, section: 'pre' | 'in' | 'post'): Omit<LineItemRow, 'id'> {
  return {
    claim_id: claimId, section, type: section === 'in' ? 'Surgery' : 'Outpatient',
    date_from: null, date_to: null, description: '', invoice_no: '',
    amount_claimed: 0, submitted_date: null, approved: false, date_approved: null,
    amount_approved: 0, remarks: '',
  } as any
}

// ─── PAGE ───────────────────────────────────────────────────────────────────

export default function MedicalClaimsPage() {
  const { activeClient, advisor, authLoading } = useDashboard()
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

  // ── Route/feature guard — mirrors the nav's creator-bypass rule so direct
  // URL access without the flag doesn't work either. ──
  useEffect(() => {
    if (!authLoading && advisor && !hasAccess) router.replace('/dashboard')
  }, [authLoading, advisor, hasAccess, router])

  const clientName = activeClient?.name || 'Client'

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

  // ── Load line items + linked policies + follow-up notes whenever the selected claim changes ──
  useEffect(() => {
    if (!selectedClaimId) { setLineItems([]); setLinkedPolicyIds([]); setNotesByItem({}); return }
    let cancelled = false
    async function load() {
      const [itemsRes, linkedRes] = await Promise.all([
        supabase.from('claim_line_items').select('*').eq('claim_id', selectedClaimId!).order('date_from', { ascending: true }),
        supabase.from('claim_linked_policies').select('policy_id').eq('claim_id', selectedClaimId!),
      ])
      if (cancelled) return
      const items = (itemsRes.data || []) as LineItemRow[]
      setLineItems(items)
      setLinkedPolicyIds((linkedRes.data || []).map((r: any) => r.policy_id))

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

  // ── Totals ──
  const totalClaimed = lineItems.reduce((s, i) => s + (i.amount_claimed || 0), 0)
  const totalApproved = lineItems.reduce((s, i) => s + (i.approved ? (i.amount_approved || 0) : 0), 0)
  const pct = totalClaimed > 0 ? Math.round((totalApproved / totalClaimed) * 100) : 0

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

  // ── Guards ──
  if (authLoading || loading) return <div style={pageWrap}><div style={{ color: T.textFaint, padding: 40, textAlign: 'center' }}>Loading…</div></div>
  if (!hasAccess) return null
  if (!activeClient) return <div style={pageWrap}><div style={{ color: T.textFaint, padding: 40, textAlign: 'center' }}>Select a client to view Medical Claims.</div></div>

  return (
    <div className={`${instrumentSerif.variable} ${plexMono.variable}`} style={pageWrap}>
      <style>{`
        .claims-serif { font-family: var(--claims-font-serif), Georgia, serif; }
        .claims-mono { font-family: var(--claims-font-mono), monospace; }
        .claims-scroll::-webkit-scrollbar { display: none; }
        .claims-input, .claims-select { width: 100%; padding: 8px 10px; border: 1px solid ${T.line}; border-radius: 10px; background: ${T.void2}; color: ${T.text}; font-size: 13px; }
        .claims-input:focus, .claims-select:focus { outline: none; border-color: ${T.gold}; box-shadow: 0 0 0 3px ${T.goldSoft}; }
      `}</style>

      {/* Claim switcher */}
      <div className="claims-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }}>
        {claims.map(c => {
          const label = allPeople.find(p => p.key === c.life_assured_person)?.label || c.life_assured_person
          const pendingCount = pendingCountByClaim[c.id] || 0
          return (
            <button key={c.id} onClick={() => { setSelectedClaimId(c.id); setDetailsOpen(false); setExpandedItemId(null) }}
              style={{ ...pillBase, ...(c.id === selectedClaimId ? pillActive : pillInactive), position: 'relative' }}>
              {pendingCount > 0 && (
                <span className="claims-mono" style={{
                  position: 'absolute', top: -7, right: -7, minWidth: 18, height: 18, borderRadius: 999,
                  background: T.gold, color: T.void1, fontSize: 10.5, fontWeight: 700,
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
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
              <div>
                <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: T.gold, fontWeight: 700 }}>Claim · Opened {fmtDate(selectedClaim.opened_date)}</div>
                <div className="claims-serif" style={{ fontSize: 26, marginTop: 5, color: T.text }}>Medical Insurance Claims for {allPeople.find(p => p.key === selectedClaim.life_assured_person)?.label || clientName}</div>
                <div style={{ fontSize: 11.5, color: T.textDim, marginTop: 5 }}>Household <b style={{ color: T.text }}>{clientName}</b> family</div>
              </div>
              <select className="claims-select" value={selectedClaim.status} onChange={e => updateClaim({ status: e.target.value as any })} style={{ width: 130, height: 34, alignSelf: 'flex-start' }}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
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
              <div>
                <FieldLabel>Deductible (This Claim, $)</FieldLabel>
                <input className="claims-input claims-mono" type="number" value={selectedClaim.deductible_amount || ''}
                  onChange={e => setClaims(prev => prev.map(c => c.id === selectedClaim.id ? { ...c, deductible_amount: e.target.value === '' ? 0 : +e.target.value } : c))}
                  onBlur={e => updateClaim({ deductible_amount: e.target.value === '' ? 0 : +e.target.value })} />
              </div>
              <div>
                <FieldLabel>Co-Insurance Cap (Panel, $)</FieldLabel>
                <input className="claims-input claims-mono" type="number" value={selectedClaim.coinsurance_cap_annual || ''}
                  onChange={e => setClaims(prev => prev.map(c => c.id === selectedClaim.id ? { ...c, coinsurance_cap_annual: e.target.value === '' ? 0 : +e.target.value } : c))}
                  onBlur={e => updateClaim({ coinsurance_cap_annual: e.target.value === '' ? 0 : +e.target.value })} />
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

          {/* Pending Follow-Ups */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
              <div>
                <div className="claims-serif" style={{ fontSize: 19, color: T.text, display: 'flex', alignItems: 'center', gap: 10 }}>
                  Pending Follow-Ups
                  <span className="claims-mono" style={{ fontSize: 13, fontWeight: 700, color: T.void1, background: T.gold, borderRadius: 999, padding: '3px 11px', lineHeight: 1.3 }}>{pendingItems.length}</span>
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
            return (
              <div key={sec} style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 2px' }}>
                  <div>
                    <div className="claims-serif" style={{ fontSize: 19, color: T.text }}>{SECTION_LABEL[sec]} <span style={{ fontSize: 11, color: T.textFaint, fontFamily: 'inherit' }}>{items.length}</span></div>
                    <div style={{ fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', color: T.textFaint, fontWeight: 700 }}>{SECTION_SUB[sec]}</div>
                  </div>
                  <button onClick={() => addLine(sec)} style={addBtn}>+ Add</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.length === 0 && <div style={{ ...cardBase, padding: 16, textAlign: 'center', color: T.textFaint, fontSize: 12.5, fontStyle: 'italic' }}>No line items yet.</div>}
                  {items.map(it => (
                    <LineItemCard key={it.id} item={it} expanded={expandedItemId === it.id}
                      onToggle={() => setExpandedItemId(expandedItemId === it.id ? null : it.id)}
                      onSave={patch => saveLineItem(it.id, patch)} onDelete={() => deleteLine(it.id)} />
                  ))}
                </div>
              </div>
            )
          })}

          <div style={{ marginTop: 24, padding: '14px 16px', borderRadius: 12, background: T.goldSoft, border: `1px solid ${T.line}`, fontSize: 11.5, color: T.textDim }}>
            Per-line deductible/co-insurance running totals, documents, and message templates land in the next builds — this page now covers claim details, line items, and follow-up tracking.
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
        <circle cx={40} cy={40} r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth={6} />
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

function LineItemCard({ item, expanded, onToggle, onSave, onDelete }: {
  item: LineItemRow; expanded: boolean; onToggle: () => void
  onSave: (patch: Partial<LineItemRow>) => void; onDelete: () => void
}) {
  const [draft, setDraft] = useState(item)
  useEffect(() => setDraft(item), [item])
  function commit(patch: Partial<LineItemRow>) { setDraft(prev => ({ ...prev, ...patch })); onSave(patch) }

  return (
    <div style={{ ...cardBase, padding: 0, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', cursor: 'pointer' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.approved ? T.emerald : T.rose, boxShadow: `0 0 0 3px ${item.approved ? T.emeraldSoft : T.roseSoft}`, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.goldText, background: T.goldSoft, padding: '2px 7px', borderRadius: 5 }}>{item.type || '—'}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.description || '(no description)'}</span>
          </div>
          <div className="claims-mono" style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3 }}>{item.invoice_no || '—'} · {fmtDate(item.date_from)}</div>
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
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
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
            <div style={{ gridColumn: '1/-1' }}><FieldLabel>Remarks</FieldLabel><input className="claims-input" value={draft.remarks || ''} onChange={e => setDraft({ ...draft, remarks: e.target.value })} onBlur={() => commit({ remarks: draft.remarks })} /></div>
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

// ─── DESIGN TOKENS ──────────────────────────────────────────────────────────

const T = {
  void1: '#100E0C', void2: '#1A1613', void3: '#241F19',
  gold: '#E7BC72', goldText: '#B4924F', goldSoft: 'rgba(231,188,114,.14)',
  emerald: '#2FD498', emeraldSoft: 'rgba(47,212,152,.13)',
  rose: '#FF6B57', roseSoft: 'rgba(255,107,87,.13)',
  text: '#F3EFE6', textDim: '#A8A296', textFaint: '#6D6960',
  line: 'rgba(255,255,255,.09)',
}

const pageWrap: React.CSSProperties = { background: T.void1, minHeight: '100%', padding: 24, borderRadius: 16, color: T.text }
const cardBase: React.CSSProperties = { background: 'rgba(255,255,255,.045)', backdropFilter: 'blur(20px)', border: `1px solid ${T.line}`, borderRadius: 16, padding: 18 }
const heroCard: React.CSSProperties = {
  padding: '24px 22px 26px', borderRadius: 20, border: `1px solid ${T.line}`,
  background: `radial-gradient(480px 240px at 50% 0%, rgba(231,188,114,.14), transparent 60%), linear-gradient(155deg, ${T.void3} 0%, ${T.void2} 60%, ${T.void1} 100%)`,
  boxShadow: '0 30px 70px -30px rgba(0,0,0,.7)',
}
const detailsToggle: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 4px', background: 'none', border: 'none', borderBottom: `1px solid ${T.line}`, color: T.textDim, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginTop: 16 }
const addBtn: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: T.gold, background: T.goldSoft, border: `1px solid rgba(231,188,114,.3)`, padding: '6px 13px', borderRadius: 999, cursor: 'pointer' }
const readonlyVal: React.CSSProperties = { padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 10, background: T.void3, color: T.textDim, fontSize: 13 }
const pillBase: React.CSSProperties = { flexShrink: 0, padding: '8px 16px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none', textAlign: 'left' }
const pillActive: React.CSSProperties = { background: T.void1, color: T.text, border: `1px solid ${T.line}` }
const pillInactive: React.CSSProperties = { background: 'rgba(255,255,255,.045)', color: T.textDim, border: `1px solid ${T.line}` }
const msBox: React.CSSProperties = { minHeight: 38, padding: '5px 8px', border: `1px solid ${T.line}`, borderRadius: 10, background: T.void2, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', cursor: 'pointer' }
const msTag: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, background: T.goldSoft, color: T.goldText, fontSize: 11, fontWeight: 700, padding: '3px 6px 3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }
const msPanel: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 25, background: T.void3, border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: '0 20px 44px rgba(0,0,0,.5)', padding: 6, maxHeight: 220, overflowY: 'auto', marginTop: 6 }
const msOption: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 8, fontSize: 12.5, cursor: 'pointer', color: T.text }
