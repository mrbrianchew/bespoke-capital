'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { saveFactFindingSection } from '@/lib/factFindingSave'
import PolicyModal, { Policy, InsCategory, InsPolicyType, InsCompany, InsProduct, emptyPolicy, RiskMgmtData, EMPTY_RM } from '@/components/PolicyModal'
import GmailClaimSearch from '@/components/GmailClaimSearch'
import type { ProductRow, ProductOutcome } from '@/components/NewBusinessCaseDrawer'

// Adding a product to a New Business case opens the exact same policy form
// the Protection page uses (category-driven fields, product/company
// reference data, USD/FX handling) — see PolicyModal.tsx for why this is
// shared rather than forked.
//
// Aug 2026 addition: outcome tracking (Accepted/Declined/Postponed),
// reason capture (reuses status_note — no new column), Accept → push to
// portfolio, and Client Incepted → flips to Issued and lets the advisor
// confirm final policy details. See NewBusinessCaseDrawer.tsx for the
// outcome/status type definitions and why outcome is a separate column
// from the pre-existing status enum.
//
// life_assured_role/family_member_id/name are derived from whichever
// "Life Assured" the advisor picks inside PolicyModal (allPeople), same
// pattern Protection's savePolicy() uses — matched back against the
// household list built from clientName/spouseName/children below. That
// same role/family_member_id is what push-to-portfolio uses to derive the
// pushed policy's `person` key, rather than trusting policy_draft.person
// (which is never correctly set post-creation — see pushToPortfolio()).

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  slate: '#5C6B73', slateSoft: 'rgba(92,107,115,.12)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)',
}

const btnSmStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 600, padding: '6px 11px',
  borderRadius: 7, border: `1px solid ${T.line}`, background: '#fff', color: T.text, cursor: 'pointer',
}
const ghostSmStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
}

const PRODUCT_STATUS_LABEL: Record<ProductRow['status'], { label: string; bg: string; fg: string }> = {
  active: { label: 'In Progress', bg: T.emeraldSoft, fg: T.emerald },
  issued: { label: 'Issued', bg: T.goldSoft, fg: T.goldText },
  withdrawn: { label: 'Withdrawn', bg: T.cream2, fg: T.textFaint },
  // Retired (Aug 2026) — outcome='declined' + status_note now covers this.
  // Kept here only so any pre-existing row set to one of these old values
  // (before the migration) still renders a sensible badge instead of
  // crashing on an unmapped key.
  declined_by_insurer: { label: 'Declined (Insurer)', bg: T.roseSoft, fg: T.rose },
  declined_by_client: { label: 'Declined (Client)', bg: T.roseSoft, fg: T.rose },
}

const OUTCOME_LABEL: Record<'accepted' | 'declined' | 'postponed', { label: string; bg: string; fg: string }> = {
  accepted: { label: 'Accepted', bg: T.emeraldSoft, fg: T.emerald },
  declined: { label: 'Declined', bg: T.roseSoft, fg: T.rose },
  postponed: { label: 'Postponed', bg: T.goldSoft, fg: T.goldText },
}

const REASON_LABEL: Record<'declined' | 'postponed' | 'withdrawn', string> = {
  declined: 'Reason for declining',
  postponed: 'Reason for postponing',
  withdrawn: 'Reason for withdrawing',
}

function deriveRole(key: string): ProductRow['life_assured_role'] {
  if (key === 'client') return 'self'
  if (key === 'spouse') return 'spouse'
  if (key.startsWith('child_')) return 'child'
  return 'other'
}

function deriveFamilyMemberId(key: string): string | null {
  return key.startsWith('child_') ? key.slice('child_'.length) : null
}

// Reverse of deriveRole/deriveFamilyMemberId — turns a product's stored
// life_assured_role/life_assured_family_member_id back into the household
// key convention Protection's rmData.policies[].person uses ('client',
// 'spouse', `child_${id}`). 'other' (key-person/business cover with no
// household seat) has nowhere to bucket to in Protection's per-person view
// — falls back to 'client' so the policy is at least visible somewhere
// rather than silently invisible. Flagged as a known gap, not solved here.
function derivePersonKey(role: ProductRow['life_assured_role'], familyMemberId: string | null): string {
  if (role === 'self') return 'client'
  if (role === 'spouse') return 'spouse'
  if (role === 'child' && familyMemberId) return `child_${familyMemberId}`
  return 'client'
}

export default function NewBusinessCaseProducts({
  caseId, clientId, clientName, spouseName, prospectName, products,
  onProductAdded, onProductUpdated, onProductDeleted,
}: {
  caseId: string
  clientId: string | null
  clientName: string | null
  spouseName: string | null
  prospectName: string | null
  products: ProductRow[]
  onProductAdded: (p: ProductRow) => void
  onProductUpdated: (p: ProductRow) => void
  onProductDeleted: (id: string) => void
}) {
  const supabase = createClient()

  const [categories, setCategories] = useState<InsCategory[]>([])
  const [policyTypes, setPolicyTypes] = useState<InsPolicyType[]>([])
  const [companies, setCompanies] = useState<InsCompany[]>([])
  const [insProducts, setInsProducts] = useState<InsProduct[]>([])
  const [children, setChildren] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)

  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [productsOpen, setProductsOpen] = useState(true)

  // Reason capture — reuses status_note, prompted for outcome=declined/
  // postponed and status=withdrawn alike.
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})
  const [savingReasonFor, setSavingReasonFor] = useState<string | null>(null)

  const [pushingId, setPushingId] = useState<string | null>(null)

  // Client Incepted / Update Policy — edits the *live* portfolio policy
  // (fetched fresh from fact_finding, not the case product's own
  // policy_draft snapshot), separate modal state from the add/edit form above.
  const [inceptingProduct, setInceptingProduct] = useState<ProductRow | null>(null)
  const [inceptingPolicy, setInceptingPolicy] = useState<Policy | null>(null)
  const [showInceptModal, setShowInceptModal] = useState(false)
  const [loadingIncept, setLoadingIncept] = useState<string | null>(null)

  const [emailPanelsOpen, setEmailPanelsOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const calls: any[] = [
        supabase.from('ins_categories').select('*').order('sort_order'),
        supabase.from('ins_policy_types').select('*').order('sort_order'),
        supabase.from('ins_companies').select('*').eq('active', true).order('sort_order'),
        supabase.from('ins_products').select('*').eq('active', true).order('sort_order'),
      ]
      if (clientId) calls.push(supabase.from('family_members').select('id, name, relationship').eq('client_id', clientId))
      const results = await Promise.all(calls)
      if (cancelled) return
      setCategories((results[0].data || []) as InsCategory[])
      setPolicyTypes((results[1].data || []) as InsPolicyType[])
      setCompanies((results[2].data || []) as InsCompany[])
      setInsProducts((results[3].data || []) as InsProduct[])
      if (clientId) {
        const familyRows = (results[4]?.data || []) as any[]
        setChildren(familyRows.filter(m => m.relationship?.toLowerCase() !== 'spouse').map(m => ({ id: m.id, name: m.name })))
      } else {
        setChildren([])
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // Household list for PolicyModal's Policyholder/Life Assured dropdowns —
  // same shape as Protection's allPeople. Prospects (no client_id yet) only
  // get themselves; spouse/children require a real client record.
  const allPeople = [
    { key: 'client', label: clientName || prospectName || 'Client' },
    ...(clientId && spouseName ? [{ key: 'spouse', label: spouseName }] : []),
    ...children.map(c => ({ key: `child_${c.id}`, label: c.name })),
  ]

  function openAdd() {
    setEditingProduct(null)
    setShowModal(true)
  }

  function openEdit(p: ProductRow) {
    setEditingProduct(p)
    setShowModal(true)
  }

  async function deleteProduct(p: ProductRow) {
    if (!window.confirm(`Remove ${p.product_name || p.product_type || 'this product'} from the case?`)) return
    const { error } = await supabase.from('new_business_case_products').delete().eq('id', p.id)
    if (error) { alert('Delete failed: ' + error.message); return }
    onProductDeleted(p.id)
  }

  async function savePolicy(policy: Policy) {
    const laMatch = allPeople.find(ap => ap.label === policy.lifeAssured)
    const key = laMatch ? laMatch.key : 'client'
    const patch = {
      life_assured_family_member_id: deriveFamilyMemberId(key),
      life_assured_role: deriveRole(key),
      life_assured_name: laMatch ? laMatch.label : (clientName || prospectName || ''),
      product_type: policy.categoryCode || null,
      product_name: policy.productName || null,
      insurer: policy.companyName || null,
      premium: (policy.premiumCash || 0) + (policy.premiumMedisave || 0),
      premium_frequency: (policy.frequency || 'Annual').toLowerCase(),
      policy_draft: policy,
    }

    if (editingProduct) {
      const { error } = await supabase.from('new_business_case_products').update(patch).eq('id', editingProduct.id)
      if (error) { alert('Save failed: ' + error.message); return }
      onProductUpdated({ ...editingProduct, ...patch } as ProductRow)
    } else {
      const { data, error } = await supabase.from('new_business_case_products')
        .insert({ case_id: caseId, status: 'active', ...patch }).select().maybeSingle()
      if (error) { alert('Save failed: ' + error.message); return }
      if (data) onProductAdded(data as ProductRow)
    }
    setShowModal(false)
    setEditingProduct(null)
  }

  const modalPolicy: Policy = editingProduct?.policy_draft
    ? (editingProduct.policy_draft as Policy)
    : emptyPolicy('client', allPeople[0]?.label || '', allPeople[0]?.label || '')

  // ── outcome / withdraw / reason ──

  async function setOutcome(p: ProductRow, outcome: ProductOutcome) {
    const { error } = await supabase.from('new_business_case_products').update({ outcome }).eq('id', p.id)
    if (error) { alert('Could not update outcome: ' + error.message); return }
    onProductUpdated({ ...p, outcome })
  }

  async function withdrawProduct(p: ProductRow) {
    const { error } = await supabase.from('new_business_case_products').update({ status: 'active' === p.status ? 'withdrawn' : 'active' }).eq('id', p.id)
    if (error) { alert('Could not update: ' + error.message); return }
    onProductUpdated({ ...p, status: p.status === 'active' ? 'withdrawn' : 'active' })
  }

  function reasonKind(p: ProductRow): 'declined' | 'postponed' | 'withdrawn' | null {
    if (p.status === 'withdrawn') return 'withdrawn'
    if (p.outcome === 'declined') return 'declined'
    if (p.outcome === 'postponed') return 'postponed'
    return null
  }

  async function saveReason(p: ProductRow) {
    const text = (reasonDraft[p.id] ?? p.status_note ?? '').trim()
    setSavingReasonFor(p.id)
    const { error } = await supabase.from('new_business_case_products').update({ status_note: text || null }).eq('id', p.id)
    setSavingReasonFor(null)
    if (error) { alert('Could not save reason: ' + error.message); return }
    onProductUpdated({ ...p, status_note: text || null })
  }

  // ── push to portfolio / client incepted ──

  async function pushToPortfolio(p: ProductRow) {
    if (!clientId) { alert("This case isn't linked to a client record yet — convert the prospect to a client before pushing to portfolio."); return }
    if (!p.policy_draft) { alert('This product has no policy detail captured — edit it first.'); return }
    setPushingId(p.id)
    try {
      const personKey = derivePersonKey(p.life_assured_role, p.life_assured_family_member_id)
      const pushedPolicy: Policy = { ...(p.policy_draft as Policy), person: personKey }
      await saveFactFindingSection(supabase, clientId, 'protection_portfolio', existing => {
        const rm: RiskMgmtData = existing.risk_management || EMPTY_RM
        return { ...existing, risk_management: { ...rm, policies: [...(rm.policies || []), pushedPolicy] } }
      })
      const { error } = await supabase.from('new_business_case_products').update({ linked_policy_id: pushedPolicy.id }).eq('id', p.id)
      if (error) throw error
      onProductUpdated({ ...p, linked_policy_id: pushedPolicy.id })
    } catch (e: any) {
      alert('Push to portfolio failed: ' + (e?.message || 'unknown error'))
    } finally {
      setPushingId(null)
    }
  }

  async function openIncept(p: ProductRow) {
    if (!clientId || !p.linked_policy_id) return
    setLoadingIncept(p.id)
    const { data, error } = await supabase.from('fact_finding').select('data').eq('client_id', clientId).eq('section', 'protection_portfolio').maybeSingle()
    setLoadingIncept(null)
    if (error) { alert('Could not load the portfolio: ' + error.message); return }
    const rm: RiskMgmtData | undefined = (data?.data as any)?.risk_management
    const found = rm?.policies?.find(pol => pol.id === p.linked_policy_id)
    if (!found) { alert("Could not find this policy in the client's portfolio — it may have been removed there."); return }
    setInceptingProduct(p)
    setInceptingPolicy(found)
    setShowInceptModal(true)
  }

  async function saveIncept(policy: Policy) {
    if (!clientId || !inceptingProduct) return
    try {
      await saveFactFindingSection(supabase, clientId, 'protection_portfolio', existing => {
        const rm: RiskMgmtData = existing.risk_management || EMPTY_RM
        return { ...existing, risk_management: { ...rm, policies: (rm.policies || []).map(pol => pol.id === policy.id ? policy : pol) } }
      })
      const patch = { status: 'issued' as const, policy_draft: policy, issued_at: new Date().toISOString().slice(0, 10) }
      const { error } = await supabase.from('new_business_case_products').update(patch).eq('id', inceptingProduct.id)
      if (error) { alert('Saved to the portfolio, but could not update this product\'s record: ' + error.message) }
      else onProductUpdated({ ...inceptingProduct, ...patch } as ProductRow)
    } catch (e: any) {
      alert('Save failed: ' + (e?.message || 'unknown error'))
    } finally {
      setShowInceptModal(false)
      setInceptingProduct(null)
      setInceptingPolicy(null)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <button type="button" onClick={() => setProductsOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: T.text }}>
            Products &amp; Life Assured <span style={{ fontWeight: 400, fontSize: 11.5, color: T.textFaint }}>{products.length} line item{products.length === 1 ? '' : 's'}</span>
          </span>
          <span style={{ color: T.textFaint, fontSize: 12, transform: productsOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
        </button>
        {productsOpen && <button onClick={openAdd} disabled={loading} style={{ ...btnSmStyle, opacity: loading ? 0.6 : 1 }}>+ Add Product</button>}
      </div>

      {productsOpen && (products.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No products added yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {products.map(p => {
            const st = PRODUCT_STATUS_LABEL[p.status] || PRODUCT_STATUS_LABEL.active
            const kind = reasonKind(p)
            const pushed = !!p.linked_policy_id
            const isIssued = p.status === 'issued'
            const emailOpen = !!emailPanelsOpen[p.id]

            return (
              <div key={p.id} style={{ background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: '11px 12px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 200 }}>
                    <div style={{ fontSize: 12.5 }}>
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 9.5, padding: '2px 6px', borderRadius: 4, background: T.cream2, color: T.textDim, marginRight: 6 }}>{p.life_assured_role.toUpperCase().slice(0, 4)}</span>
                      {p.life_assured_name}
                    </div>
                    <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{p.product_name || p.product_type || '—'}</div>
                    <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
                      {p.linked_policy_id ? p.reference_number || '—' : p.reference_number ? `${p.reference_number} (application)` : '—'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: st.bg, color: st.fg }}>{st.label}</span>
                    {p.outcome && (
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: OUTCOME_LABEL[p.outcome].bg, color: OUTCOME_LABEL[p.outcome].fg }}>{OUTCOME_LABEL[p.outcome].label}</span>
                    )}
                    {pushed && !isIssued && (
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: T.slateSoft, color: T.slate }}>Pushed to Portfolio</span>
                    )}

                    {p.status !== 'withdrawn' && !p.outcome && (
                      <select
                        value=""
                        onChange={e => { if (e.target.value) setOutcome(p, e.target.value as ProductOutcome) }}
                        style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600, padding: '5px 9px', borderRadius: 20, border: `1px solid ${T.line}`, background: T.cream2, color: T.textDim, cursor: 'pointer' }}>
                        <option value="">Set outcome…</option>
                        <option value="accepted">Accepted</option>
                        <option value="declined">Declined</option>
                        <option value="postponed">Postponed</option>
                      </select>
                    )}
                    {p.outcome && (
                      <select
                        value={p.outcome}
                        onChange={e => setOutcome(p, (e.target.value || null) as ProductOutcome)}
                        style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600, padding: '5px 9px', borderRadius: 20, border: `1px solid ${T.line}`, background: T.cream2, color: T.textDim, cursor: 'pointer' }}>
                        <option value="accepted">Accepted</option>
                        <option value="declined">Declined</option>
                        <option value="postponed">Postponed</option>
                        <option value="">— Clear outcome —</option>
                      </select>
                    )}

                    {p.status !== 'withdrawn' && !p.outcome && (
                      <button onClick={() => withdrawProduct(p)} style={ghostSmStyle} title="Withdraw before submission">Withdraw</button>
                    )}
                    {p.status === 'withdrawn' && (
                      <button onClick={() => withdrawProduct(p)} style={ghostSmStyle} title="Undo — set back to In Progress">Undo</button>
                    )}

                    <button onClick={() => openEdit(p)} style={{ ...ghostSmStyle, fontSize: 12 }} title="Edit">✎</button>
                    <button onClick={() => deleteProduct(p)} style={{ ...ghostSmStyle, fontSize: 14 }} title="Delete">×</button>
                  </div>
                </div>

                {kind && (
                  <div style={{ margin: '0 12px 12px', padding: '10px 12px', background: 'var(--cream)', border: `1px solid ${T.line}`, borderRadius: 9 }}>
                    <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.textFaint, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ color: T.rose }}>●</span> {REASON_LABEL[kind]}
                    </div>
                    <textarea
                      value={reasonDraft[p.id] ?? p.status_note ?? ''}
                      onChange={e => setReasonDraft(prev => ({ ...prev, [p.id]: e.target.value }))}
                      onBlur={() => { if ((reasonDraft[p.id] ?? '') !== (p.status_note ?? '') && p.id in reasonDraft) saveReason(p) }}
                      placeholder="Required — why?"
                      style={{ width: '100%', minHeight: 46, border: `1px solid ${T.line}`, borderRadius: 8, padding: '9px 11px', fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: T.text, background: '#fff', resize: 'vertical' }} />
                    {savingReasonFor === p.id && <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 4 }}>Saving…</div>}
                  </div>
                )}

                {p.outcome === 'accepted' && !pushed && (
                  <div style={{ margin: '0 12px 12px', padding: '10px 12px', background: T.emeraldSoft, border: '1px solid rgba(42,94,70,.2)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, fontSize: 12, color: T.emerald, lineHeight: 1.4 }}>
                      <b style={{ display: 'block', fontSize: 12.5, marginBottom: 2 }}>Ready to push to the client's Protection portfolio.</b>
                      Copies the full policy detail captured on the form into their portfolio.
                    </p>
                    <button onClick={() => pushToPortfolio(p)} disabled={pushingId === p.id}
                      style={{ ...btnSmStyle, background: T.emerald, color: '#fff', borderColor: T.emerald, opacity: pushingId === p.id ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                      {pushingId === p.id ? 'Pushing…' : 'Accept & Push to Portfolio'}
                    </button>
                  </div>
                )}

                {pushed && !isIssued && (
                  <div style={{ margin: '0 12px 12px', padding: '10px 12px', background: T.slateSoft, border: '1px solid rgba(92,107,115,.22)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, fontSize: 12, color: T.slate, lineHeight: 1.4 }}>
                      <b style={{ display: 'block', fontSize: 12.5, color: T.text, marginBottom: 2 }}>In the client's portfolio, awaiting inception.</b>
                      Marks as Issued once the client's premium clears.
                    </p>
                    <button onClick={() => openIncept(p)} disabled={loadingIncept === p.id}
                      style={{ ...btnSmStyle, background: T.text, color: 'var(--cream)', opacity: loadingIncept === p.id ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                      {loadingIncept === p.id ? 'Loading…' : 'Client Incepted'}
                    </button>
                  </div>
                )}

                {isIssued && (
                  <div style={{ margin: '0 12px 12px', padding: '10px 12px', background: T.goldSoft, border: '1px solid rgba(168,131,74,.28)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <p style={{ margin: 0, fontSize: 12, color: T.goldText, lineHeight: 1.4 }}>
                      <b style={{ display: 'block', fontSize: 12.5, color: T.text, marginBottom: 2 }}>Live in the client's portfolio.</b>
                      {p.issued_at && `Incepted ${new Date(p.issued_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    </p>
                    <button onClick={() => openIncept(p)} disabled={loadingIncept === p.id} style={{ ...btnSmStyle, whiteSpace: 'nowrap' }}>
                      {loadingIncept === p.id ? 'Loading…' : '✎ Update Policy'}
                    </button>
                  </div>
                )}

                {/* Per-product related-email search — scoped to this product's
                    own reference number only, not pooled with the rest of
                    the case's products (that pooling moved out of the
                    case-level panel — see NewBusinessCaseDrawer.tsx). */}
                <button
                  onClick={() => setEmailPanelsOpen(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: 'var(--cream)', border: 'none', borderTop: `1px solid ${T.line}`, cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 12, color: T.textDim, display: 'flex', alignItems: 'center', gap: 8 }}>
                    Related emails
                    {p.reference_number && (
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10.5, background: '#fff', border: `1px solid ${T.line}`, padding: '2px 8px', borderRadius: 999, color: T.textDim }}>{p.reference_number}</span>
                    )}
                  </span>
                  <span style={{ color: T.textFaint, fontSize: 12, transform: emailOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>▾</span>
                </button>
                {emailOpen && (
                  <div style={{ padding: '0 12px 12px' }}>
                    <GmailClaimSearch
                      newBusinessCaseId={caseId}
                      keySuffix={p.id}
                      defaultTerms={p.reference_number ? [p.reference_number] : []}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {showModal && (
        <PolicyModal
          policy={modalPolicy}
          personLabel={allPeople[0]?.label || ''}
          allPeople={allPeople}
          categories={categories}
          policyTypes={policyTypes}
          companies={companies}
          products={insProducts}
          onSave={savePolicy}
          onClose={() => { setShowModal(false); setEditingProduct(null) }}
          clientId={null}
          onHistoryChanged={() => {}}
        />
      )}

      {showInceptModal && inceptingPolicy && (
        <PolicyModal
          policy={inceptingPolicy}
          personLabel={allPeople.find(ap => ap.key === derivePersonKey(inceptingProduct!.life_assured_role, inceptingProduct!.life_assured_family_member_id))?.label || inceptingProduct?.life_assured_name || ''}
          allPeople={allPeople}
          categories={categories}
          policyTypes={policyTypes}
          companies={companies}
          products={insProducts}
          onSave={saveIncept}
          onClose={() => { setShowInceptModal(false); setInceptingProduct(null); setInceptingPolicy(null) }}
          clientId={clientId}
          onHistoryChanged={() => {}}
        />
      )}
    </div>
  )
}