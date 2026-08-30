'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function OnboardingPage() {
  const [name, setName] = useState('')
  const [firm, setFirm] = useState('')
  const [phone, setPhone] = useState('')
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/auth'); return }
      const { data } = await supabase.from('advisors').select('name, firm, phone').eq('id', user.id).maybeSingle()
      if (data?.name && data?.firm && data?.phone) { router.push('/dashboard'); return }
      // Prefill whatever's already on file so returning/partially-onboarded
      // advisors only need to fill in what's missing, not retype everything.
      if (data?.name) setName(data.name)
      if (data?.firm) setFirm(data.firm)
      if (data?.phone) setPhone(data.phone)
      setChecking(false)
    })
  }, [])

  async function save() {
    if (!name.trim()) { setError('Please enter your name'); return }
    if (!firm.trim()) { setError('Please enter your firm/team name'); return }
    const phoneDigits = phone.replace(/\D/g, '')
    if (phoneDigits.length < 8) { setError('Please enter a valid phone number'); return }
    setError('')
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { error } = await supabase.from('advisors').upsert({
      id: user.id,
      name: name.trim(),
      firm: firm.trim(),
      phone: phone.trim(),
      email: user.email,
    })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/dashboard')
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading…</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', padding: '48px', borderRadius: 12, border: '1px solid var(--line)', width: 420 }}>
        <div className="font-serif text-2xl mb-1" style={{ color: 'var(--ink)' }}>Welcome</div>
        <div className="text-sm mb-8" style={{ color: 'var(--ink3)' }}>Set up your advisor profile — all fields below are required before you can continue.</div>

        <label className="text-xs tracking-widest uppercase block mb-1" style={{ color: 'var(--ink3)' }}>Your Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Sarah Tan"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 14, background: 'var(--cream)', marginBottom: 16 }}
        />

        <label className="text-xs tracking-widest uppercase block mb-1" style={{ color: 'var(--ink3)' }}>Firm/Team Name</label>
        <input
          value={firm}
          onChange={e => setFirm(e.target.value)}
          placeholder="e.g. Financial Alliance Pte Ltd"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 14, background: 'var(--cream)', marginBottom: 16 }}
        />
        <div className="text-xs mb-4" style={{ color: 'var(--ink3)', marginTop: -12 }}>
          Appears on client-facing reports and forms — including the Will Preparation form your clients will see.
        </div>

        <label className="text-xs tracking-widest uppercase block mb-1" style={{ color: 'var(--ink3)' }}>Phone Number</label>
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && save()}
          placeholder="e.g. 9123 4567"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 14, background: 'var(--cream)', marginBottom: 16 }}
        />

        {error && <div className="text-xs mb-3" style={{ color: '#C0392B' }}>{error}</div>}
        <button onClick={save} disabled={loading}
          style={{ width: '100%', padding: '12px', background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}>
          {loading ? 'Saving…' : 'Get Started'}
        </button>
      </div>
    </div>
  )
}