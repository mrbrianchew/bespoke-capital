'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import PolicyModal, { Policy, InsCategory, InsPolicyType, InsCompany, InsProduct, emptyPolicy } from '@/components/PolicyModal'
import type { ProductRow } from '@/components/NewBusinessCaseDrawer'

// Adding a product to a New Business case now opens the exact same policy
// form the Protection page uses (category-driven fields, product/company
// reference data, USD/FX handling) — see PolicyModal.tsx for why this is
// shared rather than forked. Full detail is captured on this form (Death/
// TPD/CI, premiums, maturity dates) so the eventual Accept → push-to-
// portfolio step is a straight copy, not a second data-entry pass.
//
// life_assured_role/family_member_id/name are derived from whichever
// "Life Assured" the advisor picks inside PolicyModal (allPeople), same
// pattern Protection's savePolicy() uses — matched back against the
// household list built from clientName/spouseName/children below.

const T = {
  gold: 'var(--gold)', goldText: 'var(--gold-tag)', goldSoft: 'rgba(168,131,74,.12)',
  emerald: 'var(--emerald)', emeraldSoft: 'rgba(45,90,78,.12)',
  rose: 'var(--rouge)', roseSoft: 'rgba(138,40,40,.10)',
  text: 'var(--ink)', textDim: 'var(--ink2)', textFaint: 'var(--ink3)',
  line: 'var(--line)', cream2: 'var(--cream2)',
}

const btnSmStyle: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 600, padding: '6px 11px',
  borderRadius: 7, border: `1px solid ${T.line}`, background: '#fff', color: T.text, cursor: 'pointer',
}

const PRODUCT_STATUS_LABEL: Record<ProductRow['status'], { label: string; bg: string; fg: string }> = {
  active: { label: 'In Progress', bg: T.emeraldSoft, fg: T.emerald },
  issued: { label: 'Issued', bg: T.goldSoft, fg: T.goldText },
  withdrawn: { label: 'Withdrawn', bg: T.cream2, fg: T.textFaint },
  declined_by_insurer: { label: 'Declined (Insurer)', bg: T.roseSoft, fg: T.rose },
  declined_by_client: { label: 'Declined (Client)', bg: T.roseSoft, fg: T.rose },
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: T.text }}>
          Products &amp; Life Assured <span style={{ fontWeight: 400, fontSize: 11.5, color: T.textFaint }}>{products.length} line item{products.length === 1 ? '' : 's'}</span>
        </div>
        <button onClick={openAdd} disabled={loading} style={{ ...btnSmStyle, opacity: loading ? 0.6 : 1 }}>+ Add Product</button>
      </div>

      {products.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>No products added yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <thead>
            <tr>
              {['Life Assured / Holder', 'Product', 'Status', 'Reference / Policy', ''].map(h => (
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
                  <td style={{ padding: '11px 12px', borderTop: `1px solid ${T.cream2}`, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(p)} style={{ fontSize: 11, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }} title="Edit">✎</button>
                    <button onClick={() => deleteProduct(p)} style={{ fontSize: 13, color: T.textFaint, background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }} title="Delete">×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

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
    </div>
  )
}