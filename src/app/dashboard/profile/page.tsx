'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export default function ProfilePage() {
  const [name, setName] = useState('')
  const [firm, setFirm] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const supabase = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data } = await supabase.from('advisors').select('name,firm,email').eq('id', user.id).maybeSingle()
    if (data) { setName(data.name || ''); setFirm(data.firm || ''); setEmail(data.email || user.email || '') }
    setLoading(false)
  }

  async function save() {
    if (!name.trim()) { setError('Name is required'); return }
    setError('')
    setSaved(false)
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const { error: err } = await supabase
      .from('advisors')
      .update({ name: name.trim(), firm: firm.trim() || null })
      .eq('id', user.id)
    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div className="px-8 py-10 text-sm" style={{ color: 'var(--ink3)' }}>Loading…</div>

  return (
    <div className="max-w-lg mx-auto px-8 py-10">
      <div className="font-serif text-2xl mb-1" style={{ color: 'var(--ink)' }}>My Profile</div>
      <div className="text-sm mb-8" style={{ color: 'var(--ink3)' }}>
        Update your name and firm name. Firm name replaces the default sidebar branding and appears on client-facing reports.
      </div>
      <div className="space-y-5">
        <div>
          <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Your Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sarah Tan"
            className="w-full px-3 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'white' }} />
        </div>
        <div>
          <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Firm/Team Name</label>
          <input value={firm} onChange={e => setFirm(e.target.value)} placeholder="e.g. Financial Alliance Pte Ltd"
            className="w-full px-3 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--line)', color: 'var(--ink)', background: 'white' }} />
          <div className="text-xs mt-1.5" style={{ color: 'var(--ink3)' }}>Leave blank to use the default "Bespoke Heartwork" branding.</div>
        </div>
        <div>
          <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Email</label>
          <input value={email} disabled
            className="w-full px-3 py-2.5 text-sm outline-none"
            style={{ border: '1px solid var(--line)', color: 'var(--ink3)', background: 'var(--cream)' }} />
        </div>
        {error && <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)' }}>{error}</div>}
        {saved && <div className="text-sm px-3 py-2" style={{ background: 'var(--emerald-l)', color: 'var(--emerald)' }}>Saved.</div>}
        <button onClick={save} disabled={saving}
          className="px-4 py-2.5 text-sm font-medium text-white"
          style={{ background: saving ? 'var(--ink2)' : 'var(--ink)' }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
