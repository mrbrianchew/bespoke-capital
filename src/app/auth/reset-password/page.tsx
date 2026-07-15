'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [done, setDone] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // The reset link lands here with a recovery code in the URL. The browser
    // client auto-exchanges it for a temporary recovery session on load; we
    // just wait for that (or for an existing session) before showing the form.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    const timeout = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) setLinkInvalid(true)
      })
    }, 2500)
    return () => { listener.subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) { setError(error.message); return }
    setDone(true)
    await supabase.auth.signOut()
    setTimeout(() => router.push('/auth'), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-12" style={{ background: 'var(--cream)' }}>
      <div className="w-full max-w-md">
        <div className="mb-8">
          <div className="font-serif text-2xl font-semibold mb-1" style={{ color: 'var(--ink)' }}>Bespoke Capital</div>
          <h1 className="font-serif text-3xl font-light mb-2 mt-4" style={{ color: 'var(--ink)' }}>Set a new password</h1>
          {!done && <p className="text-sm" style={{ color: 'var(--ink3)' }}>Choose a new password for your advisor account.</p>}
        </div>

        {done ? (
          <div className="px-4 py-3 text-sm" style={{ background: 'var(--emerald-l)', color: 'var(--emerald)', borderLeft: '2px solid var(--emerald)' }}>
            Password updated. Redirecting you to sign in…
          </div>
        ) : linkInvalid ? (
          <div>
            <div className="px-4 py-3 text-sm mb-4" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', borderLeft: '2px solid var(--rouge)' }}>
              This reset link is invalid or has expired. Reset links are single-use and expire after a short time.
            </div>
            <button onClick={() => router.push('/auth')} className="w-full py-3 text-sm font-semibold tracking-widest uppercase" style={{ background: 'var(--ink)', color: 'white' }}>
              Back to Sign In
            </button>
          </div>
        ) : !ready ? (
          <p className="text-sm" style={{ color: 'var(--ink3)' }}>Verifying your reset link…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>New Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" className="w-full px-4 py-3 text-sm outline-none" style={{ background: 'white', border: '1px solid var(--line)', color: 'var(--ink)' }} />
            </div>
            <div>
              <label className="block text-xs tracking-widest uppercase mb-2" style={{ color: 'var(--ink3)' }}>Confirm New Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required placeholder="••••••••" className="w-full px-4 py-3 text-sm outline-none" style={{ background: 'white', border: '1px solid var(--line)', color: 'var(--ink)' }} />
            </div>
            {error && <div className="px-4 py-3 text-sm" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', borderLeft: '2px solid var(--rouge)' }}>{error}</div>}
            <button type="submit" disabled={loading} className="w-full py-3 text-sm font-semibold tracking-widest uppercase" style={{ background: loading ? 'var(--ink2)' : 'var(--ink)', color: 'white' }}>
              {loading ? 'Please wait…' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
