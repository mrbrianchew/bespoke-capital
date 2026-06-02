'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [firm, setFirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    if (mode === 'login') {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); setLoading(false); return }
      // Check approval status
      const { data: adv } = await supabase.from('advisors').select('status').eq('id', data.user.id).single()
      if (!adv || adv.status !== 'approved') {
        await supabase.auth.signOut()
        setError('Your account is awaiting approval. You will be notified once approved.')
        setLoading(false)
        return
      }
      router.push('/dashboard')
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name, firm } } })
      if (error) { setError(error.message); setLoading(false); return }
      if (data.user) {
        // Create advisor row as pending
        await supabase.from('advisors').upsert({ id: data.user.id, name, email, firm, status: 'pending' })
        // Notify admin
        await fetch('/api/notify-signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, firm }) })
      }
      setMessage('Account created! Your account is pending approval. We will notify you once approved.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--cream)' }}>
      <div className="w-96 flex-shrink-0 flex flex-col justify-between p-12" style={{ background: 'var(--charcoal)' }}>
        <div>
          <div className="font-serif text-2xl font-semibold mb-1" style={{ color: '#F0EDE8' }}>Bespoke Capital</div>
          <div className="text-xs tracking-widest uppercase" style={{ color: 'rgba(168,131,74,0.6)' }}>Financial Plan</div>
        </div>
        <div>
          <div className="font-serif text-3xl font-light leading-tight mb-4" style={{ color: '#F0EDE8' }}>
            Your clients.<br />Their future.<br />
            <span style={{ color: '#C4A464' }}>Planned precisely.</span>
          </div>
          <div className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>A professional financial planning platform built for Singapore advisors.</div>
        </div>
        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>Financial Planning Advisory Pte Ltd</div>
      </div>
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="font-serif text-3xl font-light mb-2" style={{ color: 'var(--ink)' }}>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
            <p className="text-sm" style={{ color: 'var(--ink3)' }}>{mode === 'login' ? 'Sign in to your advisor account' : 'Set up your advisor profile'}</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Full Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Sarah Tan" className="w-full px-4 py-3 text-sm outline-none" style={{ background: 'white', border: '1px solid var(--line)', color: 'var(--ink)' }} />
                </div>
                <div>
                  <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Company / Firm</label>
                  <input type="text" value={firm} onChange={e => setFirm(e.target.value)} placeholder="e.g. Financial Planning Advisory" className="w-full px-4 py-3 text-sm outline-none" style={{ background: 'white', border: '1px solid var(--line)', color: 'var(--ink)' }} />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" className="w-full px-4 py-3 text-sm outline-none" style={{ background: 'white', border: '1px solid var(--line)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" className="w-full px-4 py-3 text-sm outline-none" style={{ background: 'white', border: '1px solid var(--line)', color: 'var(--ink)' }} />
            </div>
            {error && <div className="px-4 py-3 text-sm" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', borderLeft: '2px solid var(--rouge)' }}>{error}</div>}
            {message && <div className="px-4 py-3 text-sm" style={{ background: 'var(--emerald-l)', color: 'var(--emerald)', borderLeft: '2px solid var(--emerald)' }}>{message}</div>}
            <button type="submit" disabled={loading} className="w-full py-3 text-sm font-semibold tracking-widest uppercase" style={{ background: loading ? 'var(--ink2)' : 'var(--ink)', color: 'white' }}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
          <div className="mt-6 text-center">
            <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }} className="text-sm" style={{ color: 'var(--ink3)' }}>
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
