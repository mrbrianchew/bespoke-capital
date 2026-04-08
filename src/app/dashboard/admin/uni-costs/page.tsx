'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

interface UniCost {
  id: string
  label: string
  annual_fees_living: number
  default_duration: number
  notes: string | null
  updated_at: string | null
  updated_by: string | null
}

const DEFAULT_UNI_COSTS: UniCost[] = [
  { id: 'sg_local',     label: 'SG Local (NUS / NTU / SMU)',  annual_fees_living: 34000, default_duration: 4, notes: 'Includes tuition and estimated living expenses', updated_at: null, updated_by: null },
  { id: 'sg_private',   label: 'SG Private University',        annual_fees_living: 42000, default_duration: 3, notes: 'e.g. SIT, SUSS, UniSIM', updated_at: null, updated_by: null },
  { id: 'overseas_avg', label: 'Overseas — Average',           annual_fees_living: 55000, default_duration: 4, notes: 'Blended average across major destinations', updated_at: null, updated_by: null },
  { id: 'overseas_uk',  label: 'Overseas — UK',                annual_fees_living: 72000, default_duration: 3, notes: 'Includes tuition, accommodation and living', updated_at: null, updated_by: null },
  { id: 'overseas_aus', label: 'Overseas — Australia',         annual_fees_living: 65000, default_duration: 4, notes: 'Includes tuition, accommodation and living', updated_at: null, updated_by: null },
  { id: 'overseas_us',  label: 'Overseas — USA',               annual_fees_living: 85000, default_duration: 4, notes: 'Includes tuition, accommodation and living', updated_at: null, updated_by: null },
  { id: 'overseas_cn',  label: 'Overseas — China',             annual_fees_living: 35000, default_duration: 4, notes: 'Includes tuition, accommodation and living', updated_at: null, updated_by: null },
  { id: 'overseas_eu',  label: 'Overseas — Europe',            annual_fees_living: 50000, default_duration: 4, notes: 'EU universities, varies significantly by country', updated_at: null, updated_by: null },
]

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: 'var(--cream, #f5f3ee)',
    fontFamily: 'Inter, sans-serif',
  } as React.CSSProperties,

  hero: {
    background: '#1C1A17',
    padding: '32px 48px 28px',
    borderBottom: '1px solid rgba(200,169,110,0.2)',
  } as React.CSSProperties,

  heroEyebrow: {
    fontSize: '9px',
    fontFamily: 'DM Mono, monospace',
    letterSpacing: '0.15em',
    color: 'rgba(200,169,110,0.6)',
    textTransform: 'uppercase' as const,
    marginBottom: '6px',
  },

  heroTitle: {
    fontSize: '22px',
    fontFamily: 'Cormorant Garamond, serif',
    fontWeight: 500,
    color: '#f5f3ee',
    letterSpacing: '0.01em',
    marginBottom: '6px',
  },

  heroSub: {
    fontSize: '11px',
    color: 'rgba(245,243,238,0.45)',
    fontFamily: 'Inter, sans-serif',
    letterSpacing: '0.02em',
  },

  content: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '40px 48px',
  } as React.CSSProperties,

  notice: {
    background: 'rgba(200,169,110,0.08)',
    border: '1px solid rgba(200,169,110,0.25)',
    borderRadius: '4px',
    padding: '12px 16px',
    marginBottom: '32px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
  } as React.CSSProperties,

  noticeText: {
    fontSize: '11px',
    color: '#5a5040',
    lineHeight: 1.6,
    fontFamily: 'Inter, sans-serif',
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    backgroundColor: '#ffffff',
    border: '1px solid rgba(26,24,22,0.08)',
    borderRadius: '4px',
    overflow: 'hidden',
  } as React.CSSProperties,

  thead: {
    backgroundColor: '#1C1A17',
  },

  th: {
    padding: '11px 16px',
    textAlign: 'left' as const,
    fontSize: '8.5px',
    fontFamily: 'DM Mono, monospace',
    letterSpacing: '0.12em',
    color: 'rgba(245,243,238,0.55)',
    textTransform: 'uppercase' as const,
    fontWeight: 400,
    borderBottom: '1px solid rgba(200,169,110,0.15)',
    whiteSpace: 'nowrap' as const,
  },

  tr: (isEditing: boolean, isHovered: boolean) => ({
    borderBottom: '1px solid rgba(26,24,22,0.06)',
    backgroundColor: isEditing ? 'rgba(200,169,110,0.05)' : isHovered ? 'rgba(26,24,22,0.02)' : 'transparent',
    transition: 'background-color 0.15s ease',
  } as React.CSSProperties),

  td: {
    padding: '13px 16px',
    verticalAlign: 'middle' as const,
  } as React.CSSProperties,

  labelCell: {
    fontSize: '12px',
    color: '#1a1a1a',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 500,
  },

  idBadge: {
    display: 'inline-block',
    fontSize: '8px',
    fontFamily: 'DM Mono, monospace',
    color: 'rgba(26,24,22,0.35)',
    letterSpacing: '0.08em',
    marginTop: '2px',
  },

  editInput: {
    width: '100%',
    border: 'none',
    borderBottom: '1.5px solid var(--gold, #c8a96e)',
    background: 'transparent',
    fontSize: '12px',
    fontFamily: 'DM Mono, monospace',
    color: '#1a1a1a',
    padding: '2px 0',
    outline: 'none',
    textAlign: 'right' as const,
  },

  readValue: {
    fontSize: '13px',
    fontFamily: 'DM Mono, monospace',
    color: '#1a1a1a',
    display: 'block',
    textAlign: 'right' as const,
  },

  durationValue: {
    fontSize: '13px',
    fontFamily: 'DM Mono, monospace',
    color: '#1a1a1a',
    textAlign: 'center' as const,
    display: 'block',
  },

  annualValue: {
    fontSize: '13px',
    fontFamily: 'DM Mono, monospace',
    color: '#1a1a1a',
    textAlign: 'right' as const,
    display: 'block',
  },

  editBtn: {
    background: 'none',
    border: '1px solid rgba(200,169,110,0.4)',
    color: '#c8a96e',
    fontSize: '10px',
    fontFamily: 'DM Mono, monospace',
    letterSpacing: '0.08em',
    padding: '4px 10px',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  saveBtn: {
    background: '#1C1A17',
    border: '1px solid #1C1A17',
    color: '#c8a96e',
    fontSize: '10px',
    fontFamily: 'DM Mono, monospace',
    letterSpacing: '0.08em',
    padding: '4px 10px',
    cursor: 'pointer',
    borderRadius: '2px',
    marginRight: '6px',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  cancelBtn: {
    background: 'none',
    border: '1px solid rgba(26,24,22,0.15)',
    color: 'rgba(26,24,22,0.45)',
    fontSize: '10px',
    fontFamily: 'DM Mono, monospace',
    letterSpacing: '0.08em',
    padding: '4px 10px',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  totalCostNote: {
    fontSize: '10px',
    color: 'rgba(26,24,22,0.35)',
    fontFamily: 'DM Mono, monospace',
    display: 'block',
    textAlign: 'right' as const,
    marginTop: '2px',
  },

  footer: {
    marginTop: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as React.CSSProperties,

  lastUpdated: {
    fontSize: '10px',
    fontFamily: 'DM Mono, monospace',
    color: 'rgba(26,24,22,0.35)',
    letterSpacing: '0.06em',
  },

  saveAllBtn: {
    background: '#1C1A17',
    border: 'none',
    color: '#c8a96e',
    fontSize: '10px',
    fontFamily: 'DM Mono, monospace',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    padding: '10px 24px',
    cursor: 'pointer',
    borderRadius: '2px',
    transition: 'opacity 0.15s ease',
  } as React.CSSProperties,

  toast: (show: boolean, type: 'success' | 'error') => ({
    position: 'fixed' as const,
    bottom: '32px',
    right: '32px',
    background: type === 'success' ? '#1C1A17' : '#8b2e2e',
    color: type === 'success' ? '#c8a96e' : '#f5c5c5',
    fontSize: '11px',
    fontFamily: 'DM Mono, monospace',
    letterSpacing: '0.08em',
    padding: '12px 20px',
    borderRadius: '3px',
    opacity: show ? 1 : 0,
    transition: 'opacity 0.3s ease',
    pointerEvents: 'none' as const,
    zIndex: 100,
  }),
}

export default function UniCostsAdminPage() {
  const [rows, setRows] = useState<UniCost[]>(DEFAULT_UNI_COSTS)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<{ annual_fees_living: number; default_duration: number; notes: string }>({ annual_fees_living: 0, default_duration: 4, notes: '' })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({ show: false, message: '', type: 'success' })
  const supabase = createClient()

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => setToast(t => ({ ...t, show: false })), 3000)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('uni_costs').select('*').order('annual_fees_living', { ascending: true })
      if (error) throw error
      if (data && data.length > 0) {
        // Merge with defaults to ensure all entries present
        const merged = DEFAULT_UNI_COSTS.map(def => {
          const fromDb = data.find((d: UniCost) => d.id === def.id)
          return fromDb || def
        })
        setRows(merged)
      }
    } catch {
      // Fall back to defaults silently
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const startEdit = (row: UniCost) => {
    setEditingId(row.id)
    setEditValues({
      annual_fees_living: row.annual_fees_living,
      default_duration: row.default_duration,
      notes: row.notes || '',
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveRow = async (id: string) => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('uni_costs')
        .upsert({
          id,
          label: rows.find(r => r.id === id)?.label || id,
          annual_fees_living: editValues.annual_fees_living,
          default_duration: editValues.default_duration,
          notes: editValues.notes,
          updated_at: new Date().toISOString(),
        })
      if (error) throw error
      setRows(prev => prev.map(r => r.id === id ? {
        ...r,
        annual_fees_living: editValues.annual_fees_living,
        default_duration: editValues.default_duration,
        notes: editValues.notes,
        updated_at: new Date().toISOString(),
      } : r))
      setEditingId(null)
      showToast('Saved successfully')
    } catch {
      showToast('Save failed — check Supabase connection', 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveAll = async () => {
    setSaving(true)
    try {
      const upserts = rows.map(r => ({
        id: r.id,
        label: r.label,
        annual_fees_living: r.annual_fees_living,
        default_duration: r.default_duration,
        notes: r.notes,
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('uni_costs').upsert(upserts)
      if (error) throw error
      showToast('All rows saved to database')
      loadData()
    } catch {
      showToast('Save failed — check Supabase connection', 'error')
    } finally {
      setSaving(false)
    }
  }

  const lastUpdated = rows
    .filter(r => r.updated_at)
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    ?.[0]?.updated_at

  return (
    <div style={styles.page}>
      {/* Hero */}
      <div style={styles.hero}>
        <div style={styles.heroEyebrow}>Admin Settings</div>
        <div style={styles.heroTitle}>University Education Costs</div>
        <div style={styles.heroSub}>
          Annual fees &amp; living expenses by institution type — used in Education Fund calculations across Wealth Protection and Education Planning
        </div>
      </div>

      <div style={styles.content}>
        {/* Notice */}
        <div style={styles.notice}>
          <span style={{ fontSize: '14px', marginTop: '0px' }}>ℹ</span>
          <div style={styles.noticeText}>
            These rates are pulled automatically when advisors select a university type during client discovery sessions.
            Costs represent <strong>annual fees + estimated living expenses</strong> in SGD. Update these periodically to reflect current tuition inflation.
            Changes take effect immediately for all new client sessions.
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: 'rgba(26,24,22,0.35)', fontFamily: 'DM Mono, monospace', fontSize: '11px', letterSpacing: '0.1em' }}>
            LOADING...
          </div>
        ) : (
          <table style={styles.table}>
            <thead style={styles.thead}>
              <tr>
                <th style={{ ...styles.th, width: '30%' }}>University Type</th>
                <th style={{ ...styles.th, textAlign: 'right' as const, width: '18%' }}>Annual Cost (SGD)</th>
                <th style={{ ...styles.th, textAlign: 'center' as const, width: '12%' }}>Duration (yrs)</th>
                <th style={{ ...styles.th, textAlign: 'right' as const, width: '18%' }}>4-yr Total Est.</th>
                <th style={{ ...styles.th, width: '14%' }}>Notes</th>
                <th style={{ ...styles.th, width: '8%' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEditing = editingId === row.id
                const isHovered = hoveredId === row.id
                const annualVal = isEditing ? editValues.annual_fees_living : row.annual_fees_living
                const durVal = isEditing ? editValues.default_duration : row.default_duration
                const totalEst = annualVal * durVal

                return (
                  <tr
                    key={row.id}
                    style={styles.tr(isEditing, isHovered)}
                    onMouseEnter={() => setHoveredId(row.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {/* Label */}
                    <td style={styles.td}>
                      <span style={styles.labelCell}>{row.label}</span>
                      <span style={styles.idBadge}>{row.id}</span>
                    </td>

                    {/* Annual Cost */}
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      {isEditing ? (
                        <input
                          type="number"
                          value={editValues.annual_fees_living}
                          onChange={e => setEditValues(v => ({ ...v, annual_fees_living: Number(e.target.value) }))}
                          style={styles.editInput}
                          step={1000}
                          min={0}
                        />
                      ) : (
                        <span style={styles.annualValue}>
                          ${row.annual_fees_living.toLocaleString()}
                        </span>
                      )}
                    </td>

                    {/* Duration */}
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      {isEditing ? (
                        <input
                          type="number"
                          value={editValues.default_duration}
                          onChange={e => setEditValues(v => ({ ...v, default_duration: Number(e.target.value) }))}
                          style={{ ...styles.editInput, textAlign: 'center', width: '60px' }}
                          min={1}
                          max={6}
                        />
                      ) : (
                        <span style={styles.durationValue}>{row.default_duration}</span>
                      )}
                    </td>

                    {/* Total estimate */}
                    <td style={{ ...styles.td, textAlign: 'right' }}>
                      <span style={{ ...styles.annualValue, color: '#c8a96e' }}>
                        ${totalEst.toLocaleString()}
                      </span>
                      <span style={styles.totalCostNote}>@ {durVal} yrs</span>
                    </td>

                    {/* Notes */}
                    <td style={styles.td}>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValues.notes}
                          onChange={e => setEditValues(v => ({ ...v, notes: e.target.value }))}
                          style={{ ...styles.editInput, textAlign: 'left', fontSize: '10px' }}
                          placeholder="Optional note..."
                        />
                      ) : (
                        <span style={{ fontSize: '10px', color: 'rgba(26,24,22,0.4)', fontFamily: 'Inter, sans-serif', lineHeight: 1.4 }}>
                          {row.notes || '—'}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => saveRow(row.id)}
                            disabled={saving}
                            style={{ ...styles.saveBtn, opacity: saving ? 0.5 : 1 }}
                          >
                            Save
                          </button>
                          <button onClick={cancelEdit} style={styles.cancelBtn}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button onClick={() => startEdit(row)} style={styles.editBtn}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          <div style={styles.lastUpdated}>
            {lastUpdated
              ? `Last updated ${new Date(lastUpdated).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })}`
              : 'Not yet saved to database'
            }
          </div>
          <button onClick={saveAll} disabled={saving} style={{ ...styles.saveAllBtn, opacity: saving ? 0.5 : 1 }}>
            {saving ? 'Saving...' : 'Initialise / Sync All Rows →'}
          </button>
        </div>
      </div>

      {/* Toast */}
      <div style={styles.toast(toast.show, toast.type)}>
        {toast.message}
      </div>
    </div>
  )
}
