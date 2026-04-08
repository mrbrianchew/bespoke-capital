'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

interface UniCost {
  id: string
  label: string
  annual_tuition: number
  annual_living: number
  notes: string | null
  updated_at: string | null
}

const DEFAULTS: UniCost[] = [
  { id: 'sg_local',     label: 'SG Local (NUS / NTU / SMU)', annual_tuition: 10750, annual_living: 12500, notes: 'Source: MoE / NUS fee schedules', updated_at: null },
  { id: 'sg_private',   label: 'SG Private University',       annual_tuition: 20000, annual_living: 12500, notes: 'e.g. SIT, SUSS, UniSIM', updated_at: null },
  { id: 'overseas_avg', label: 'Overseas — Average',          annual_tuition: 31500, annual_living: 20000, notes: 'Blended average across major destinations', updated_at: null },
  { id: 'overseas_uk',  label: 'Overseas — UK',               annual_tuition: 42000, annual_living: 26500, notes: 'Russell Group average incl. living', updated_at: null },
  { id: 'overseas_aus', label: 'Overseas — Australia',        annual_tuition: 29500, annual_living: 21000, notes: 'Go8 universities average', updated_at: null },
  { id: 'overseas_us',  label: 'Overseas — USA',              annual_tuition: 54000, annual_living: 22500, notes: 'Mid-tier private university average', updated_at: null },
  { id: 'overseas_cn',  label: 'Overseas — China',            annual_tuition: 15000, annual_living: 12000, notes: 'Top-tier Chinese universities', updated_at: null },
  { id: 'overseas_eu',  label: 'Overseas — Europe',           annual_tuition: 25000, annual_living: 18000, notes: 'Varies significantly by country', updated_at: null },
]

export default function UniCostsAdminPage() {
  const [rows, setRows] = useState<UniCost[]>(DEFAULTS)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editVals, setEditVals] = useState<{ annual_tuition: number; annual_living: number; notes: string }>({ annual_tuition: 0, annual_living: 0, notes: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const supabase = createClient()

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('uni_costs').select('*')
      if (!error && data?.length) {
        const merged = DEFAULTS.map(def => {
          const db = data.find((d: UniCost) => d.id === def.id)
          return db ? { ...def, ...db } : def
        })
        setRows(merged)
      }
    } catch { /* use defaults */ } finally { setLoading(false) }
  }, [supabase])

  useEffect(() => { loadData() }, [loadData])

  const saveRow = async (id: string) => {
    setSaving(true)
    try {
      const row = rows.find(r => r.id === id)!
      const { error } = await supabase.from('uni_costs').upsert({
        id, label: row.label,
        annual_tuition: editVals.annual_tuition,
        annual_living: editVals.annual_living,
        annual_fees_living: editVals.annual_tuition + editVals.annual_living,
        notes: editVals.notes,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
      setRows(prev => prev.map(r => r.id === id ? { ...r, ...editVals, updated_at: new Date().toISOString() } : r))
      setEditingId(null)
      showToast('Saved')
    } catch { showToast('Save failed') } finally { setSaving(false) }
  }

  const syncAll = async () => {
    setSaving(true)
    try {
      const upserts = rows.map(r => ({ id: r.id, label: r.label, annual_tuition: r.annual_tuition, annual_living: r.annual_living, annual_fees_living: r.annual_tuition + r.annual_living, notes: r.notes, updated_at: new Date().toISOString() }))
      const { error } = await supabase.from('uni_costs').upsert(upserts)
      if (error) throw error
      showToast('All rows synced')
      loadData()
    } catch { showToast('Sync failed') } finally { setSaving(false) }
  }

  const lastUpdated = rows.filter(r => r.updated_at).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0]?.updated_at

  const cell: React.CSSProperties = { padding: '13px 16px', verticalAlign: 'middle' }
  const th: React.CSSProperties = { padding: '11px 16px', textAlign: 'left', fontSize: '8.5px', fontFamily: 'DM Mono, monospace', letterSpacing: '0.12em', color: 'rgba(245,243,238,0.55)', textTransform: 'uppercase', fontWeight: 400, borderBottom: '1px solid rgba(200,169,110,0.15)', whiteSpace: 'nowrap' }
  const monoR: React.CSSProperties = { fontSize: '13px', fontFamily: 'DM Mono, monospace', color: '#1a1a1a', textAlign: 'right', display: 'block' }
  const inp: React.CSSProperties = { border: 'none', borderBottom: '1.5px solid #c8a96e', background: 'transparent', fontSize: '12px', fontFamily: 'DM Mono, monospace', color: '#1a1a1a', padding: '2px 0', outline: 'none', textAlign: 'right', width: '100%' }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f3ee', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#1C1A17', padding: '32px 48px 28px', borderBottom: '1px solid rgba(200,169,110,0.2)' }}>
        <div style={{ fontSize: '9px', fontFamily: 'DM Mono, monospace', letterSpacing: '0.15em', color: 'rgba(200,169,110,0.6)', textTransform: 'uppercase', marginBottom: '6px' }}>Admin Settings</div>
        <div style={{ fontSize: '22px', fontFamily: 'Cormorant Garamond, serif', fontWeight: 500, color: '#f5f3ee', marginBottom: '6px' }}>University Education Costs</div>
        <div style={{ fontSize: '11px', color: 'rgba(245,243,238,0.45)' }}>Annual tuition fees &amp; living expenses by institution type — used in Education Fund calculations</div>
      </div>
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '40px 48px' }}>
        <div style={{ background: 'rgba(200,169,110,0.08)', border: '1px solid rgba(200,169,110,0.25)', borderRadius: '4px', padding: '12px 16px', marginBottom: '32px', fontSize: '11px', color: '#5a5040', lineHeight: 1.6 }}>
          ℹ &nbsp; <strong>Tuition fees</strong> are future-valued at <strong>5% p.a.</strong> (education inflation). <strong>Living expenses</strong> are future-valued at the client&apos;s chosen inflation rate from the Wealth Protection tab. Update periodically to reflect current market rates.
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'rgba(26,24,22,0.35)', fontFamily: 'DM Mono, monospace', fontSize: '11px', letterSpacing: '0.1em' }}>LOADING...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', border: '1px solid rgba(26,24,22,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
            <thead style={{ backgroundColor: '#1C1A17' }}>
              <tr>
                <th style={{ ...th, width: '26%' }}>University Type</th>
                <th style={{ ...th, textAlign: 'right', width: '16%' }}>Avg Annual Tuition</th>
                <th style={{ ...th, textAlign: 'right', width: '16%' }}>Avg Annual Living</th>
                <th style={{ ...th, textAlign: 'right', width: '16%' }}>Combined / yr</th>
                <th style={{ ...th, width: '18%' }}>Notes</th>
                <th style={{ ...th, width: '8%' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isEditing = editingId === row.id
                const tuition = isEditing ? editVals.annual_tuition : row.annual_tuition
                const living = isEditing ? editVals.annual_living : row.annual_living
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid rgba(26,24,22,0.06)', backgroundColor: isEditing ? 'rgba(200,169,110,0.05)' : 'transparent' }}>
                    <td style={cell}>
                      <span style={{ fontSize: '12px', color: '#1a1a1a', fontWeight: 500 }}>{row.label}</span>
                      <span style={{ display: 'block', fontSize: '8px', fontFamily: 'DM Mono, monospace', color: 'rgba(26,24,22,0.35)', marginTop: '2px' }}>{row.id}</span>
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {isEditing ? <input type="number" value={editVals.annual_tuition} onChange={e => setEditVals(v => ({ ...v, annual_tuition: Number(e.target.value) }))} style={inp} step={500} /> : <span style={monoR}>${tuition.toLocaleString()}</span>}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      {isEditing ? <input type="number" value={editVals.annual_living} onChange={e => setEditVals(v => ({ ...v, annual_living: Number(e.target.value) }))} style={inp} step={500} /> : <span style={monoR}>${living.toLocaleString()}</span>}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>
                      <span style={{ fontSize: '13px', fontFamily: 'DM Mono, monospace', color: '#c8a96e', textAlign: 'right', display: 'block' }}>${(tuition + living).toLocaleString()}</span>
                      <span style={{ fontSize: '10px', color: 'rgba(26,24,22,0.35)', fontFamily: 'DM Mono, monospace', textAlign: 'right', display: 'block', marginTop: '2px' }}>/ yr</span>
                    </td>
                    <td style={cell}>
                      {isEditing ? <input type="text" value={editVals.notes} onChange={e => setEditVals(v => ({ ...v, notes: e.target.value }))} style={{ ...inp, textAlign: 'left', fontSize: '10px' }} /> : <span style={{ fontSize: '10px', color: 'rgba(26,24,22,0.4)', lineHeight: 1.4 }}>{row.notes || '—'}</span>}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <><button onClick={() => saveRow(row.id)} disabled={saving} style={{ background: '#1C1A17', border: '1px solid #1C1A17', color: '#c8a96e', fontSize: '10px', fontFamily: 'DM Mono, monospace', padding: '4px 10px', cursor: 'pointer', borderRadius: '2px', marginRight: '6px' }}>Save</button><button onClick={() => setEditingId(null)} style={{ background: 'none', border: '1px solid rgba(26,24,22,0.15)', color: 'rgba(26,24,22,0.45)', fontSize: '10px', fontFamily: 'DM Mono, monospace', padding: '4px 10px', cursor: 'pointer', borderRadius: '2px' }}>✕</button></>
                      ) : (
                        <button onClick={() => { setEditingId(row.id); setEditVals({ annual_tuition: row.annual_tuition, annual_living: row.annual_living, notes: row.notes || '' }) }} style={{ background: 'none', border: '1px solid rgba(200,169,110,0.4)', color: '#c8a96e', fontSize: '10px', fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', padding: '4px 10px', cursor: 'pointer', borderRadius: '2px' }}>Edit</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', fontFamily: 'DM Mono, monospace', color: 'rgba(26,24,22,0.35)' }}>
            {lastUpdated ? `Last updated ${new Date(lastUpdated).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Not yet saved to database'}
          </span>
          <button onClick={syncAll} disabled={saving} style={{ background: '#1C1A17', border: 'none', color: '#c8a96e', fontSize: '10px', fontFamily: 'DM Mono, monospace', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '10px 24px', cursor: 'pointer', borderRadius: '2px', opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Initialise / Sync All Rows →'}
          </button>
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: '32px', right: '32px', background: '#1C1A17', color: '#c8a96e', fontSize: '11px', fontFamily: 'DM Mono, monospace', padding: '12px 20px', borderRadius: '3px', zIndex: 100 }}>{toast}</div>}
    </div>
  )
}
