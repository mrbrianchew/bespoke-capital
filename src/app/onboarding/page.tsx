'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

export default function OnboardingPage() {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // If already has a name in advisors table, skip onboarding
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/auth'); return }
      const { data } = await supabase.from('advisors').select('name').eq('id', user.id).maybeSingle()
      if (data?.name) router.push('/dashboard')
    })
  }, [])

  async function save() {
    if (!name.trim()) { setError('Please enter your name'); return }
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { error } = await supabase.from('advisors').upsert({ id: user.id, name: name.trim(), email: user.email })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/dashboard')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', padding: '48px', borderRadius: 12, border: '1px solid var(--line)', width: 400 }}>
        <div className="font-serif text-2xl mb-1" style={{ color: 'var(--ink)' }}>Welcome</div>
        <div className="text-sm mb-8" style={{ color: 'var(--ink3)' }}>Set up your advisor profile</div>
        <label className="text-xs tracking-widest uppercase block mb-1" style={{ color: 'var(--ink3)' }}>Your Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && save()}
          placeholder="e.g. Sarah Tan"
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
