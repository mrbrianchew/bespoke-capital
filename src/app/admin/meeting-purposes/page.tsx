'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useConfirm } from '@/components/ConfirmDialog'

const CREATOR_ID = process.env.NEXT_PUBLIC_CREATOR_ID

interface Purpose { id: number; code: string; name: string; sort_order: number }

const S = {
  page:    { maxWidth: 760, margin: '0 auto', padding: '2.5rem 2rem', fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  card:    { background: 'white', border: '0.5px solid #E0DDD6', borderRadius: 10, marginBottom: 24, overflow: 'hidden' } as React.CSSProperties,
  hdr:     { padding: '16px 22px', borderBottom: '0.5px solid #E0DDD6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FAFAF8' } as React.CSSProperties,
  hdrTitle:{ fontSize: 13, fontWeight: 600, color: '#1A1816', letterSpacing: '0.02em' } as React.CSSProperties,
  row:     { display: 'flex', alignItems: 'center', padding: '10px 22px', borderBottom: '0.5px solid #F0EDE8', gap: 10 } as React.CSSProperties,
  inp:     { flex: 1, padding: '7px 10px', border: '1px solid #E0DDD6', borderRadius: 5, fontSize: 13, color: '#1A1816', background: '#FAFAF8', outline: 'none', fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  btn:     { padding: '6px 14px', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  addRow:  { padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 10, background: '#F5F3EE' } as React.CSSProperties,
  del:     { background: 'none', border: 'none', cursor: 'pointer', color: '#C0392B', fontSize: 14, padding: '2px 4px', fontFamily: 'Inter, sans-serif' } as React.CSSProperties,
  save:    { background: '#1A1816', color: 'white' } as React.CSSProperties,
  cancel:  { background: 'none', border: '1px solid #E0DDD6', color: '#9A9690' } as React.CSSProperties,
}

export default function MeetingPurposesAdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const confirmAction = useConfirm()
  const [checking, setChecking] = useState(true)
  const [items, setItems] = useState<Purpose[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [editVal, setEditVal] = useState('')
  const newRef = useRef<HTMLInputElement>(null)

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
    const { data } = await supabase.from('meeting_purposes').select('*').order('sort_order')
    if (data) setItems(data)
  }

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  function toCode(name: string) {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  }

  async function doAdd() {
    const val = newRef.current?.value.trim()
    if (!val) return
    setSaving(true)
    const nextSort = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) + 1 : 1
    await supabase.from('meeting_purposes').insert({ code: toCode(val), name: val, sort_order: nextSort })
    if (newRef.current) newRef.current.value = ''
    await loadAll(); setSaving(false); flash('Added ✓')
  }

  async function saveEdit(item: Purpose) {
    if (!editVal.trim()) return
    setSaving(true)
    // Renaming only changes the display label — the underlying `code` stays
    // the same, so meetings already logged under this purpose keep matching.
    await supabase.from('meeting_purposes').update({ name: editVal.trim() }).eq('id', item.id)
    setEditing(null)
    await loadAll(); setSaving(false); flash('Saved ✓')
  }

  async function doDelete(id: number) {
    if (!await confirmAction('Delete this meeting purpose? Past meetings that used it will keep showing it, but it won\'t be selectable for new ones.', { danger: true, confirmLabel: 'Delete' })) return
    await supabase.from('meeting_purposes').delete().eq('id', id)
    await loadAll(); flash('Deleted')
  }

  if (checking) return null

  return (
    <div style={S.page}>
      <div style={{ marginBottom: 32 }}>
        <button onClick={() => router.push('/admin')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9A9690', marginBottom: 12, padding: 0, fontFamily: 'Inter, sans-serif' }}>
          ← Back to Admin Hub
        </button>
        <h1 style={{ fontSize: 26, fontFamily: 'Cormorant Garamond, serif', fontWeight: 600, color: '#1A1816', margin: '0 0 6px' }}>Meeting Purposes</h1>
        <p style={{ fontSize: 13, color: '#9A9690', margin: 0 }}>
          Manage the "What's this meeting about?" dropdown on New Business meeting cards. Changes take effect immediately.
        </p>
        {msg && <div style={{ marginTop: 12, padding: '8px 14px', background: '#E8F5E9', borderRadius: 6, fontSize: 13, color: '#2D6A4F', fontWeight: 500 }}>{msg}</div>}
      </div>

      <div style={S.card}>
        <div style={S.hdr}>
          <span style={S.hdrTitle}>Purposes</span>
          <span style={{ fontSize: 11, color: '#9A9690' }}>{items.length} options</span>
        </div>

        {items.map((p, i) => (
          <div key={p.id} style={{ ...S.row, background: i % 2 === 0 ? 'white' : '#FAFAF8' }}>
            {editing === p.id ? (
              <>
                <input value={editVal} onChange={e => setEditVal(e.target.value)} style={S.inp} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(p); if (e.key === 'Escape') setEditing(null) }} />
                <button onClick={() => saveEdit(p)} style={{ ...S.btn, ...S.save }} disabled={saving}>Save</button>
                <button onClick={() => setEditing(null)} style={{ ...S.btn, ...S.cancel }}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: 13, color: '#1A1816' }}>{p.name}</span>
                <button onClick={() => { setEditing(p.id); setEditVal(p.name) }} style={{ ...S.btn, background: '#F5F3EE', color: '#4A4740' }}>Edit</button>
                <button onClick={() => doDelete(p.id)} style={S.del}>✕</button>
              </>
            )}
          </div>
        ))}

        <div style={S.addRow}>
          <input ref={newRef} placeholder="New meeting purpose…" style={{ ...S.inp, background: 'white' }}
            onKeyDown={e => { if (e.key === 'Enter') doAdd() }} />
          <button onClick={doAdd} style={{ ...S.btn, ...S.save }} disabled={saving}>+ Add</button>
        </div>
      </div>
    </div>
  )
}