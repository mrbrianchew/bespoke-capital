"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase"

interface Band {
  id: string
  age_from: number
  age_to: number | null
  annual_limit: number
  notes: string | null
  sort_order: number
}

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #E0DDD6', borderRadius: 6,
  fontSize: 13, background: '#FAFAF8', fontFamily: 'Inter, sans-serif',
  color: '#1A1816', outline: 'none', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase' as const,
  color: '#9A9690', marginBottom: 4, display: 'block',
}

export default function MedisaveLimitsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [checking, setChecking]   = useState(true)
  const [bands, setBands]         = useState<Band[]>([])
  const [saving, setSaving]       = useState<string | null>(null)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [successId, setSuccessId] = useState<string | null>(null)
  const [draft, setDraft]         = useState({ age_from: '', age_to: '', annual_limit: '', notes: '' })
  const [addingNew, setAddingNew] = useState(false)
  const [savingNew, setSavingNew] = useState(false)

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.id !== CREATOR_ID) { router.replace('/dashboard'); return }
      setChecking(false)
      load()
    }
    check()
  }, [])

  async function load() {
    const { data, error: err } = await supabase
      .from('medisave_withdrawal_limits').select('*').order('sort_order', { ascending: true })
    if (err) { setError(err.message); return }
    setBands(data || [])
  }

  function updBand(id: string, field: keyof Band, val: any) {
    setBands(prev => prev.map(b => b.id === id ? { ...b, [field]: val } : b))
  }

  async function saveBand(band: Band) {
    setSaving(band.id); setError(null)
    const { error: err } = await supabase
      .from('medisave_withdrawal_limits').update({
        age_from: Number(band.age_from),
        age_to: band.age_to !== null && String(band.age_to) !== '' ? Number(band.age_to) : null,
        annual_limit: Number(band.annual_limit),
        notes: band.notes || null,
        sort_order: band.sort_order,
      }).eq('id', band.id)
    if (err) setError(err.message)
    else { setSuccessId(band.id); setTimeout(() => setSuccessId(null), 2000) }
    setSaving(null)
  }

  async function deleteBand(id: string) {
    if (!confirm('Delete this age band?')) return
    setDeleting(id)
    await supabase.from('medisave_withdrawal_limits').delete().eq('id', id)
    await load()
    setDeleting(null)
  }

  async function addBand() {
    setSavingNew(true); setError(null)
    const { error: err } = await supabase.from('medisave_withdrawal_limits').insert({
      age_from: Number(draft.age_from),
      age_to: draft.age_to !== '' ? Number(draft.age_to) : null,
      annual_limit: Number(draft.annual_limit),
      notes: draft.notes || null,
      sort_order: bands.length > 0 ? Math.max(...bands.map(b => b.sort_order)) + 1 : 0,
    })
    if (err) { setError(err.message); setSavingNew(false); return }
    setDraft({ age_from: '', age_to: '', annual_limit: '', notes: '' })
    setAddingNew(false)
    await load()
    setSavingNew(false)
  }

  if (checking) return null

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '2.5rem 2rem', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ marginBottom: 32 }}>
        <Link href="/admin"
          style={{ fontSize: 12, color: '#9A9690', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 16 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#A8834A'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#9A9690'}
        >← Back to Admin Hub</Link>
        <p style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9A9690', margin: '0 0 6px' }}>Admin — Medisave</p>
        <h1 style={{ fontSize: 26, fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, color: '#1A1816', margin: '0 0 8px' }}>
          Medisave Withdrawal Limits
        </h1>
        <p style={{ fontSize: 14, color: '#4A4740', margin: 0, lineHeight: 1.6 }}>
          Integrated Shield Plan Medisave withdrawal limits by age band. Changes here apply instantly across all recommendation cards.
        </p>
      </div>

      {error && (
        <div style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#9B1C1C' }}>
          {error}
        </div>
      )}

      <div style={{ background: '#F5EFE3', border: '1px solid #E8DCCC', borderRadius: 8, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#854F0B', lineHeight: 1.6 }}>
        <strong>How it works:</strong> Leave "Age To" blank for the highest band (open-ended). Bands are matched in sort order — the first band where the person's age falls within age_from–age_to is used.
      </div>

      {/* Bands table */}
      <div style={{ background: 'white', border: '1px solid #E0DDD6', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 140px 1fr 100px', gap: 12, padding: '10px 16px', background: '#F5F3EE', borderBottom: '1px solid #E0DDD6' }}>
          {['Age From', 'Age To', 'Annual Limit (S$)', 'Notes', ''].map(h => (
            <div key={h} style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9A9690', fontWeight: 600 }}>{h}</div>
          ))}
        </div>

        {bands.length === 0 && (
          <div style={{ padding: '28px 16px', fontSize: 13, color: '#9A9690', fontStyle: 'italic', textAlign: 'center' }}>
            No age bands yet — add one below, or run the SQL script to seed defaults.
          </div>
        )}

        {bands.map((band, idx) => (
          <div key={band.id} style={{
            display: 'grid', gridTemplateColumns: '80px 80px 140px 1fr 100px',
            gap: 12, padding: '12px 16px', alignItems: 'center',
            borderBottom: idx < bands.length - 1 ? '1px solid #F0EDE6' : 'none',
          }}>
            <input type="number" style={inp} value={band.age_from}
              onChange={e => updBand(band.id, 'age_from', Number(e.target.value))} />
            <input type="number" style={inp}
              value={band.age_to !== null && band.age_to !== undefined ? band.age_to : ''}
              onChange={e => updBand(band.id, 'age_to', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="∞" />
            <input type="number" style={inp} value={band.annual_limit}
              onChange={e => updBand(band.id, 'annual_limit', Number(e.target.value))} />
            <input style={inp} value={band.notes || ''}
              onChange={e => updBand(band.id, 'notes', e.target.value)}
              placeholder="Optional note…" />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => saveBand(band)} disabled={saving === band.id} style={{
                padding: '6px 12px',
                background: successId === band.id ? '#2D5A4E' : '#1C1A17',
                color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              }}>
                {saving === band.id ? '…' : successId === band.id ? '✓' : 'Save'}
              </button>
              <button onClick={() => deleteBand(band.id)} disabled={deleting === band.id} style={{
                padding: '6px 10px', background: 'white', color: '#C0392B',
                border: '1px solid #C0392B', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              }}>
                {deleting === band.id ? '…' : '✕'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add new */}
      {!addingNew ? (
        <button onClick={() => setAddingNew(true)} style={{
          padding: '9px 20px', background: 'transparent', color: '#1C1A17',
          border: '1px dashed #C0B9A8', borderRadius: 8, fontSize: 13, cursor: 'pointer',
        }}>+ Add age band</button>
      ) : (
        <div style={{ background: 'white', border: '1px solid #A8834A', borderRadius: 12, padding: 16, marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1816', marginBottom: 14 }}>New age band</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={lbl}>Age From</label>
              <input type="number" style={inp} value={draft.age_from}
                onChange={e => setDraft(p => ({ ...p, age_from: e.target.value }))} placeholder="e.g. 0" />
            </div>
            <div>
              <label style={lbl}>Age To (blank = open)</label>
              <input type="number" style={inp} value={draft.age_to}
                onChange={e => setDraft(p => ({ ...p, age_to: e.target.value }))} placeholder="∞" />
            </div>
            <div>
              <label style={lbl}>Annual Limit (S$)</label>
              <input type="number" style={inp} value={draft.annual_limit}
                onChange={e => setDraft(p => ({ ...p, annual_limit: e.target.value }))} placeholder="e.g. 300" />
            </div>
            <div>
              <label style={lbl}>Notes</label>
              <input style={inp} value={draft.notes}
                onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))} placeholder="Optional…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addBand} disabled={savingNew || !draft.age_from || !draft.annual_limit} style={{
              padding: '8px 20px', background: '#1C1A17', color: 'white',
              border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500,
            }}>
              {savingNew ? 'Adding…' : 'Add band'}
            </button>
            <button onClick={() => { setAddingNew(false); setDraft({ age_from: '', age_to: '', annual_limit: '', notes: '' }) }} style={{
              padding: '8px 16px', background: 'transparent', color: '#9A9690',
              border: '1px solid #E0DDD6', borderRadius: 6, fontSize: 13, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* SQL setup block */}
      <div style={{ marginTop: 40, padding: 20, background: '#1C1A17', borderRadius: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9A9690', marginBottom: 12 }}>
          Supabase SQL — run once to create table + seed defaults
        </div>
        <pre style={{ fontSize: 11, color: '#c8a96e', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.8, fontFamily: 'DM Mono, monospace' }}>{`create table if not exists medisave_withdrawal_limits (
  id           uuid primary key default gen_random_uuid(),
  age_from     integer not null,
  age_to       integer,
  annual_limit integer not null,
  notes        text,
  sort_order   integer not null default 0,
  created_at   timestamptz default now()
);

alter table medisave_withdrawal_limits enable row level security;

create policy "read_authenticated"
  on medisave_withdrawal_limits for select
  using (auth.role() = 'authenticated');

create policy "write_authenticated"
  on medisave_withdrawal_limits for all
  using (auth.role() = 'authenticated');

-- Seed Singapore ISP defaults
insert into medisave_withdrawal_limits
  (age_from, age_to, annual_limit, notes, sort_order) values
  (0,  39,  300, 'Below age 40',     0),
  (40, 60,  600, 'Age 40 to 60',     1),
  (61, null, 900, 'Age 61 and above', 2);`}</pre>
      </div>
    </div>
  )
}
