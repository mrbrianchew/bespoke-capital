'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

interface Category   { id: number; code: string; name: string; sort_order: number }
interface PolicyType { id: number; category_id: number; code: string; name: string; sort_order: number }
interface Company    { id: number; category_id: number; name: string; sort_order: number; active: boolean }
interface Product    { id: number; category_id: number; company_id: number; name: string; sort_order: number; active: boolean }

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page:    { maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem', fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  card:    { background: 'white', border: '0.5px solid #E0DDD6', borderRadius: 10, marginBottom: 24, overflow: 'hidden' } as React.CSSProperties,
  hdr:     { padding: '16px 22px', borderBottom: '0.5px solid #E0DDD6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FAFAF8' } as React.CSSProperties,
  hdrTitle:{ fontSize: 13, fontWeight: 600, color: '#1A1816', letterSpacing: '0.02em' } as React.CSSProperties,
  row:     { display: 'flex', alignItems: 'center', padding: '10px 22px', borderBottom: '0.5px solid #F0EDE8', gap: 10 } as React.CSSProperties,
  inp:     { flex: 1, padding: '7px 10px', border: '1px solid #E0DDD6', borderRadius: 5, fontSize: 13, color: '#1A1816', background: '#FAFAF8', outline: 'none', fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  btn:     { padding: '6px 14px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  addRow:  { padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 10, background: '#F5F3EE' } as React.CSSProperties,
  label:   { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#9A9690', marginBottom: 4, display: 'block' },
  tab:     (active: boolean): React.CSSProperties => ({ padding: '7px 16px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: active ? 600 : 400, background: active ? '#1A1816' : 'transparent', color: active ? 'white' : '#9A9690', fontFamily: 'Inter, sans-serif' }),
  badge:   (active: boolean): React.CSSProperties => ({ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: active ? '#E8F5E9' : '#FEE2E2', color: active ? '#2D6A4F' : '#9B1C1C', fontWeight: 600 }),
  del:     { background: 'none', border: 'none', cursor: 'pointer', color: '#C0392B', fontSize: 14, padding: '2px 4px', fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  save:    { background: '#1A1816', color: 'white' } as React.CSSProperties,
  cancel:  { background: 'none', border: '1px solid #E0DDD6', color: '#9A9690' } as React.CSSProperties,
}

export default function InsuranceAdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const [checking, setChecking]     = useState(true)
  const [activeCat, setActiveCat]   = useState<number | null>(null)
  const [activeTab, setActiveTab]   = useState<'types' | 'companies' | 'products'>('types')

  const [categories,  setCategories]  = useState<Category[]>([])
  const [policyTypes, setPolicyTypes] = useState<PolicyType[]>([])
  const [companies,   setCompanies]   = useState<Company[]>([])
  const [products,    setProducts]    = useState<Product[]>([])
  const [saving, setSaving]           = useState(false)
  const [msg, setMsg]                 = useState('')

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.id !== CREATOR_ID) { router.replace('/dashboard'); return }
      setChecking(false)
      loadAll()
    }
    check()
  }, [])

  async function loadAll() {
    const [{ data: cats }, { data: pts }, { data: cos }, { data: pros }] = await Promise.all([
      supabase.from('ins_categories').select('*').order('sort_order'),
      supabase.from('ins_policy_types').select('*').order('sort_order'),
      supabase.from('ins_companies').select('*').order('sort_order'),
      supabase.from('ins_products').select('*').order('sort_order'),
    ])
    if (cats) { setCategories(cats); if (!activeCat && cats.length > 0) setActiveCat(cats[0].id) }
    if (pts)  setPolicyTypes(pts)
    if (cos)  setCompanies(cos)
    if (pros) setProducts(pros)
  }

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  if (checking) return null

  const cat = categories.find(c => c.id === activeCat)
  const filtTypes    = policyTypes.filter(t => t.category_id === activeCat)
  const filtCompanies = companies.filter(c => c.category_id === activeCat)
  const hasProducts  = cat && ['medical','ltc'].includes(cat.code)

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <button onClick={() => router.push('/admin')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9A9690', marginBottom: 12, padding: 0, fontFamily: 'Inter, sans-serif' }}>
          ← Back to Admin Hub
        </button>
        <h1 style={{ fontSize: 26, fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, color: '#1A1816', margin: '0 0 6px' }}>Insurance Reference Data</h1>
        <p style={{ fontSize: 13, color: '#9A9690', margin: 0 }}>Manage dropdown options for the Wealth Protection Portfolio. Changes take effect immediately.</p>
        {msg && <div style={{ marginTop: 12, padding: '8px 14px', background: '#E8F5E9', borderRadius: 6, fontSize: 13, color: '#2D6A4F', fontWeight: 500 }}>{msg}</div>}
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24, flexWrap: 'wrap' }}>
        {categories.map(c => (
          <button key={c.id} onClick={() => { setActiveCat(c.id); setActiveTab('types') }} style={S.tab(activeCat === c.id)}>
            {c.name.split('/')[0].trim()}
          </button>
        ))}
      </div>

      {cat && (
        <>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #E0DDD6', paddingBottom: 14 }}>
            {(['types','companies', ...(hasProducts ? ['products'] : [])] as ('types'|'companies'|'products')[]).map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ padding: '6px 16px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: activeTab === t ? 600 : 400, background: activeTab === t ? '#F5EFE3' : 'transparent', color: activeTab === t ? '#A8834A' : '#9A9690', fontFamily: 'Inter, sans-serif' }}>
                {t === 'types' ? 'Policy Types' : t === 'companies' ? 'Companies' : 'Products'}
              </button>
            ))}
          </div>

          {/* Policy Types */}
          {activeTab === 'types' && (
            <TypesPanel
              categoryId={activeCat!}
              items={filtTypes}
              onSave={async (item) => {
                setSaving(true)
                if (item.id) {
                  await supabase.from('ins_policy_types').update({ name: item.name, code: item.code, sort_order: item.sort_order }).eq('id', item.id)
                } else {
                  const code = (item.code || item.name || '').toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')
                  await supabase.from('ins_policy_types').insert({ category_id: activeCat, name: item.name, code, sort_order: item.sort_order || 99 })
                }
                await loadAll(); setSaving(false); flash('Saved ✓')
              }}
              onDelete={async (id) => {
                if (!confirm('Delete this policy type?')) return
                await supabase.from('ins_policy_types').delete().eq('id', id)
                await loadAll(); flash('Deleted')
              }}
              saving={saving}
            />
          )}

          {/* Companies */}
          {activeTab === 'companies' && (
            <CompaniesPanel
              categoryId={activeCat!}
              items={filtCompanies}
              onSave={async (item) => {
                setSaving(true)
                if (item.id) {
                  await supabase.from('ins_companies').update({ name: item.name, sort_order: item.sort_order, active: item.active }).eq('id', item.id)
                } else {
                  await supabase.from('ins_companies').insert({ category_id: activeCat, name: item.name, sort_order: item.sort_order || 99, active: true })
                }
                await loadAll(); setSaving(false); flash('Saved ✓')
              }}
              onDelete={async (id) => {
                if (!confirm('Delete this company? This will also remove linked products.')) return
                await supabase.from('ins_products').delete().eq('company_id', id)
                await supabase.from('ins_companies').delete().eq('id', id)
                await loadAll(); flash('Deleted')
              }}
              onToggle={async (id, active) => {
                await supabase.from('ins_companies').update({ active }).eq('id', id)
                await loadAll(); flash(active ? 'Enabled ✓' : 'Disabled')
              }}
              saving={saving}
            />
          )}

          {/* Products (medical & ltc only) */}
          {activeTab === 'products' && hasProducts && (
            <ProductsPanel
              categoryId={activeCat!}
              companies={filtCompanies.filter(c => c.active)}
              items={products.filter(p => p.category_id === activeCat)}
              onSave={async (item) => {
                setSaving(true)
                if (item.id) {
                  await supabase.from('ins_products').update({ name: item.name, company_id: item.company_id, sort_order: item.sort_order, active: item.active }).eq('id', item.id)
                } else {
                  await supabase.from('ins_products').insert({ category_id: activeCat, company_id: item.company_id, name: item.name, sort_order: item.sort_order || 99, active: true })
                }
                await loadAll(); setSaving(false); flash('Saved ✓')
              }}
              onDelete={async (id) => {
                if (!confirm('Delete this product?')) return
                await supabase.from('ins_products').delete().eq('id', id)
                await loadAll(); flash('Deleted')
              }}
              onToggle={async (id, active) => {
                await supabase.from('ins_products').update({ active }).eq('id', id)
                await loadAll(); flash(active ? 'Enabled ✓' : 'Disabled')
              }}
              saving={saving}
            />
          )}
        </>
      )}
    </div>
  )
}

// ─── Policy Types Panel ───────────────────────────────────────────────────────
function TypesPanel({ categoryId, items, onSave, onDelete, saving }: {
  categoryId: number; items: PolicyType[]
  onSave: (item: Partial<PolicyType>) => void
  onDelete: (id: number) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const [newName, setNewName] = useState('')

  return (
    <div style={S.card}>
      <div style={S.hdr}>
        <span style={S.hdrTitle}>Policy Types</span>
        <span style={{ fontSize: 11, color: '#9A9690' }}>{items.length} types</span>
      </div>
      {items.map((t, i) => (
        <div key={t.id} style={{ ...S.row, background: i % 2 === 0 ? 'white' : '#FAFAF8' }}>
          {editing === t.id ? (
            <>
              <input value={editVal} onChange={e => setEditVal(e.target.value)}
                style={S.inp} onKeyDown={e => { if (e.key === 'Enter') { onSave({ ...t, name: editVal }); setEditing(null) } if (e.key === 'Escape') setEditing(null) }} autoFocus />
              <button onClick={() => { onSave({ ...t, name: editVal }); setEditing(null) }} style={{ ...S.btn, ...S.save }} disabled={saving}>Save</button>
              <button onClick={() => setEditing(null)} style={{ ...S.btn, ...S.cancel }}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 13, color: '#1A1816' }}>{t.name}</span>
              <span style={{ fontSize: 10, color: '#9A9690', fontFamily: 'DM Mono, monospace' }}>{t.code}</span>
              <button onClick={() => { setEditing(t.id); setEditVal(t.name) }} style={{ ...S.btn, background: '#F5F3EE', color: '#4A4740' }}>Edit</button>
              <button onClick={() => onDelete(t.id)} style={S.del}>✕</button>
            </>
          )}
        </div>
      ))}
      <div style={S.addRow}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New policy type name…"
          style={{ ...S.inp, background: 'white' }}
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onSave({ category_id: categoryId, name: newName.trim(), code: newName.trim().toLowerCase().replace(/\s+/g,'_'), sort_order: 99 }); setNewName('') } }} />
        <button onClick={() => { if (newName.trim()) { onSave({ category_id: categoryId, name: newName.trim(), code: newName.trim().toLowerCase().replace(/\s+/g,'_'), sort_order: 99 }); setNewName('') } }}
          style={{ ...S.btn, ...S.save }} disabled={saving || !newName.trim()}>
          + Add
        </button>
      </div>
    </div>
  )
}

// ─── Companies Panel ──────────────────────────────────────────────────────────
function CompaniesPanel({ categoryId, items, onSave, onDelete, onToggle, saving }: {
  categoryId: number; items: Company[]
  onSave: (item: Partial<Company>) => void
  onDelete: (id: number) => void
  onToggle: (id: number, active: boolean) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const [newName, setNewName] = useState('')

  return (
    <div style={S.card}>
      <div style={S.hdr}>
        <span style={S.hdrTitle}>Companies</span>
        <span style={{ fontSize: 11, color: '#9A9690' }}>{items.length} companies · {items.filter(c => c.active).length} active</span>
      </div>
      {items.map((c, i) => (
        <div key={c.id} style={{ ...S.row, background: i % 2 === 0 ? 'white' : '#FAFAF8', opacity: c.active ? 1 : 0.5 }}>
          {editing === c.id ? (
            <>
              <input value={editVal} onChange={e => setEditVal(e.target.value)}
                style={S.inp} onKeyDown={e => { if (e.key === 'Enter') { onSave({ ...c, name: editVal }); setEditing(null) } if (e.key === 'Escape') setEditing(null) }} autoFocus />
              <button onClick={() => { onSave({ ...c, name: editVal }); setEditing(null) }} style={{ ...S.btn, ...S.save }} disabled={saving}>Save</button>
              <button onClick={() => setEditing(null)} style={{ ...S.btn, ...S.cancel }}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 13, color: '#1A1816' }}>{c.name}</span>
              <span style={S.badge(c.active)}>{c.active ? 'Active' : 'Hidden'}</span>
              <button onClick={() => onToggle(c.id, !c.active)} style={{ ...S.btn, background: '#F5F3EE', color: '#4A4740', fontSize: 11 }}>
                {c.active ? 'Hide' : 'Show'}
              </button>
              <button onClick={() => { setEditing(c.id); setEditVal(c.name) }} style={{ ...S.btn, background: '#F5F3EE', color: '#4A4740' }}>Edit</button>
              <button onClick={() => onDelete(c.id)} style={S.del}>✕</button>
            </>
          )}
        </div>
      ))}
      <div style={S.addRow}>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New company name…"
          style={{ ...S.inp, background: 'white' }}
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { onSave({ category_id: categoryId, name: newName.trim(), sort_order: 99, active: true }); setNewName('') } }} />
        <button onClick={() => { if (newName.trim()) { onSave({ category_id: categoryId, name: newName.trim(), sort_order: 99, active: true }); setNewName('') } }}
          style={{ ...S.btn, ...S.save }} disabled={saving || !newName.trim()}>
          + Add
        </button>
      </div>
    </div>
  )
}

// ─── Products Panel (medical & ltc) ──────────────────────────────────────────
function ProductsPanel({ categoryId, companies, items, onSave, onDelete, onToggle, saving }: {
  categoryId: number; companies: Company[]; items: Product[]
  onSave: (item: Partial<Product>) => void
  onDelete: (id: number) => void
  onToggle: (id: number, active: boolean) => void
  saving: boolean
}) {
  const [editing,     setEditing]     = useState<number | null>(null)
  const [editVal,     setEditVal]     = useState('')
  const [editCompany, setEditCompany] = useState<number>(0)
  const [newName,     setNewName]     = useState('')
  const [newCompany,  setNewCompany]  = useState<number>(companies[0]?.id || 0)
  const [filterComp,  setFilterComp]  = useState<number | 'all'>('all')

  const visible = filterComp === 'all' ? items : items.filter(p => p.company_id === filterComp)
  const compName = (id: number) => companies.find(c => c.id === id)?.name || '—'

  return (
    <div style={S.card}>
      <div style={S.hdr}>
        <span style={S.hdrTitle}>Products</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#9A9690' }}>{items.length} products</span>
          <select value={filterComp} onChange={e => setFilterComp(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={{ fontSize: 11, border: '1px solid #E0DDD6', borderRadius: 5, padding: '4px 8px', background: 'white', color: '#4A4740', cursor: 'pointer' }}>
            <option value="all">All companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {visible.map((p, i) => (
        <div key={p.id} style={{ ...S.row, background: i % 2 === 0 ? 'white' : '#FAFAF8', opacity: p.active ? 1 : 0.5 }}>
          {editing === p.id ? (
            <>
              <select value={editCompany} onChange={e => setEditCompany(Number(e.target.value))}
                style={{ ...S.inp, flex: '0 0 160px' }}>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input value={editVal} onChange={e => setEditVal(e.target.value)} style={S.inp}
                onKeyDown={e => { if (e.key === 'Enter') { onSave({ ...p, name: editVal, company_id: editCompany }); setEditing(null) } if (e.key === 'Escape') setEditing(null) }} autoFocus />
              <button onClick={() => { onSave({ ...p, name: editVal, company_id: editCompany }); setEditing(null) }} style={{ ...S.btn, ...S.save }} disabled={saving}>Save</button>
              <button onClick={() => setEditing(null)} style={{ ...S.btn, ...S.cancel }}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 11, color: '#9A9690', width: 140, flexShrink: 0 }}>{compName(p.company_id)}</span>
              <span style={{ flex: 1, fontSize: 13, color: '#1A1816' }}>{p.name}</span>
              <span style={S.badge(p.active)}>{p.active ? 'Active' : 'Hidden'}</span>
              <button onClick={() => onToggle(p.id, !p.active)} style={{ ...S.btn, background: '#F5F3EE', color: '#4A4740', fontSize: 11 }}>
                {p.active ? 'Hide' : 'Show'}
              </button>
              <button onClick={() => { setEditing(p.id); setEditVal(p.name); setEditCompany(p.company_id) }} style={{ ...S.btn, background: '#F5F3EE', color: '#4A4740' }}>Edit</button>
              <button onClick={() => onDelete(p.id)} style={S.del}>✕</button>
            </>
          )}
        </div>
      ))}
      <div style={{ ...S.addRow, gap: 8 }}>
        <select value={newCompany} onChange={e => setNewCompany(Number(e.target.value))}
          style={{ ...S.inp, flex: '0 0 160px', background: 'white' }}>
          <option value={0}>Select company…</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New product name…"
          style={{ ...S.inp, background: 'white' }}
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && newCompany) { onSave({ category_id: categoryId, company_id: newCompany, name: newName.trim(), sort_order: 99, active: true }); setNewName('') } }} />
        <button
          onClick={() => { if (newName.trim() && newCompany) { onSave({ category_id: categoryId, company_id: newCompany, name: newName.trim(), sort_order: 99, active: true }); setNewName('') } }}
          style={{ ...S.btn, ...S.save }} disabled={saving || !newName.trim() || !newCompany}>
          + Add
        </button>
      </div>
    </div>
  )
}
