'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

// Auto-logout after IDLE_TIMEOUT_MS of no user activity, with a WARNING_MS
// countdown shown before it fires. Mounted once inside the dashboard layout
// (see dashboard/layout.tsx) — never on /auth itself, so there's no risk of
// this racing with the sign-in flow.
//
// Activity is tracked via a ref (not state) so mousemove doesn't trigger a
// re-render on every pixel — only the 1s tick that drives the visible
// countdown causes a render, and only once the warning is actually showing.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const WARNING_MS = 60 * 1000
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const

export default function IdleLogoutGuard() {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const loggingOutRef = useRef(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    function markActive() {
      lastActivityRef.current = Date.now()
      // Once the warning banner is up, any activity should dismiss it
      // immediately rather than waiting for the next tick.
      setSecondsLeft(prev => (prev !== null ? null : prev))
    }
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, markActive, { passive: true }))

    const interval = setInterval(async () => {
      if (loggingOutRef.current) return
      const idleFor = Date.now() - lastActivityRef.current
      const remaining = IDLE_TIMEOUT_MS - idleFor
      if (remaining <= 0) {
        loggingOutRef.current = true
        await supabase.auth.signOut()
        router.push('/auth')
        return
      }
      setSecondsLeft(remaining <= WARNING_MS ? Math.ceil(remaining / 1000) : null)
    }, 1000)

    return () => {
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, markActive))
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stayLoggedIn() {
    lastActivityRef.current = Date.now()
    setSecondsLeft(null)
  }

  async function signOutNow() {
    loggingOutRef.current = true
    await supabase.auth.signOut()
    router.push('/auth')
  }

  if (secondsLeft === null) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-sm" style={{ background: 'white', borderRadius: 8, border: '1px solid var(--line)' }}>
        <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Still there?</div>
          <div className="text-sm mt-1" style={{ color: 'var(--ink3)' }}>You'll be signed out in {secondsLeft}s due to inactivity.</div>
        </div>
        <div className="px-6 py-5">
          <div className="w-full h-1.5 overflow-hidden" style={{ background: 'var(--cream2)', borderRadius: 999 }}>
            <div
              style={{
                height: '100%',
                borderRadius: 999,
                background: 'var(--gold)',
                width: `${Math.max(0, Math.min(100, (secondsLeft / (WARNING_MS / 1000)) * 100))}%`,
                transition: 'width 1s linear',
              }}
            />
          </div>
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
          <button onClick={signOutNow} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)' }}>Sign out now</button>
          <button onClick={stayLoggedIn} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)' }}>Stay signed in</button>
        </div>
      </div>
    </div>
  )
}