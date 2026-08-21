'use client'
import { useEffect, useState } from 'react'
import { useConfirm } from '@/components/ConfirmDialog'

type Status = { connected: boolean; email: string | null; connectedAt: string | null }

const RESULT_MESSAGES: Record<string, { text: string; tone: 'error' | 'success' }> = {
  connected: { text: 'Calendar connected.', tone: 'success' },
  denied: { text: 'Google sign-in was cancelled.', tone: 'error' },
  invalid_state: { text: 'That connection link expired — please try again.', tone: 'error' },
  no_refresh_token: { text: "Google didn't grant offline access — please try connecting again.", tone: 'error' },
  unauthorized: { text: 'Please sign in and try again.', tone: 'error' },
  error: { text: 'Something went wrong connecting Calendar. Please try again.', tone: 'error' },
}

export default function CalendarConnectCard() {
  const confirmAction = useConfirm()
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [banner, setBanner] = useState<{ text: string; tone: 'error' | 'success' } | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('calendar')
    if (result && RESULT_MESSAGES[result]) {
      setBanner(RESULT_MESSAGES[result])
      const url = new URL(window.location.href)
      url.searchParams.delete('calendar')
      window.history.replaceState({}, '', url.toString())
    }
    fetchStatus()
  }, [])

  async function fetchStatus() {
    setLoading(true)
    try {
      const res = await fetch('/api/calendar/status')
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus({ connected: false, email: null, connectedAt: null })
    }
    setLoading(false)
  }

  async function disconnect() {
    if (!await confirmAction('Disconnect Calendar? Scheduled meetings will stop syncing until you reconnect.')) return
    setDisconnecting(true)
    try {
      await fetch('/api/calendar/disconnect', { method: 'POST' })
      await fetchStatus()
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="mt-8 pt-8" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Calendar — Meeting Scheduling</div>
      <div className="text-sm mb-4" style={{ color: 'var(--ink3)' }}>
        Connect your Google Calendar so "Schedule meeting" on a Service Request creates a real event on your calendar,
        not just a note in the app.
      </div>

      {banner && (
        <div className="text-sm px-3 py-2 mb-4" style={{
          background: banner.tone === 'success' ? 'var(--emerald-l)' : 'var(--rouge-l)',
          color: banner.tone === 'success' ? 'var(--emerald)' : 'var(--rouge)',
        }}>{banner.text}</div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: 'var(--ink3)' }}>Checking connection…</div>
      ) : status?.connected ? (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm" style={{ color: 'var(--ink)' }}>
              Connected as <b>{status.email}</b>
            </div>
            {status.connectedAt && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--ink3)' }}>
                Since {new Date(status.connectedAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            )}
          </div>
          <button onClick={disconnect} disabled={disconnecting}
            className="px-4 py-2 text-sm font-medium"
            style={{ border: '1px solid var(--rouge)', color: 'var(--rouge)', background: 'white', opacity: disconnecting ? 0.6 : 1 }}>
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <a href="/api/calendar/connect"
          className="inline-block px-4 py-2.5 text-sm font-medium text-white"
          style={{ background: 'var(--ink)' }}>
          Connect Calendar
        </a>
      )}
    </div>
  )
}