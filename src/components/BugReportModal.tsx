'use client'
import { useState, useRef } from 'react'
import { usePathname } from 'next/navigation'

export default function BugReportModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<'bug' | 'suggestion'>('bug')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()

  const canSubmit = description.trim().length > 0 && !!file && !submitting

  function handleFile(f: File | null) {
    setFile(f)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    const form = new FormData()
    form.set('type', type)
    form.set('description', description.trim())
    form.set('page', pathname || '')
    form.set('screenshot', file as File)

    const res = await fetch('/api/submit-bug-report', { method: 'POST', body: form })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Something went wrong. Try again.')
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(26,24,22,0.6)' }}>
      <div className="w-full max-w-md" style={{ background: 'var(--cream)', borderRadius: 12 }}>
        {done ? (
          <div className="px-6 py-8 text-center">
            <p className="font-serif text-xl mb-2" style={{ color: 'var(--ink)' }}>Thanks — got it</p>
            <p className="text-sm mb-6" style={{ color: 'var(--ink3)' }}>Your {type === 'bug' ? 'bug report' : 'suggestion'} has been logged.</p>
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-white" style={{ background: 'var(--ink)', borderRadius: 8 }}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="font-serif text-xl" style={{ color: 'var(--ink)' }}>Report a bug or suggestion</div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setType('bug')}
                  className="flex-1 py-2 text-sm"
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${type === 'bug' ? 'var(--emerald)' : 'var(--line)'}`,
                    background: type === 'bug' ? 'var(--emerald)' : 'transparent',
                    color: type === 'bug' ? 'var(--cream)' : 'var(--ink)',
                  }}
                >
                  Bug
                </button>
                <button
                  onClick={() => setType('suggestion')}
                  className="flex-1 py-2 text-sm"
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${type === 'suggestion' ? 'var(--emerald)' : 'var(--line)'}`,
                    background: type === 'suggestion' ? 'var(--emerald)' : 'transparent',
                    color: type === 'suggestion' ? 'var(--cream)' : 'var(--ink)',
                  }}
                >
                  Suggestion
                </button>
              </div>

              <div>
                <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What happened, or what should change?"
                  className="w-full px-3 py-2.5 text-sm outline-none"
                  style={{ minHeight: 90, border: '1px solid var(--line)', color: 'var(--ink)', background: 'white', borderRadius: 8, resize: 'vertical' }}
                />
              </div>

              <div>
                <label className="block text-xs tracking-widest uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>Screenshot (required)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={e => handleFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {preview ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="cursor-pointer"
                    style={{ borderRadius: 8, border: '1px solid var(--line)', overflow: 'hidden' }}
                  >
                    <img src={preview} alt="Screenshot preview" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="cursor-pointer text-center"
                    style={{ borderRadius: 8, border: '1px dashed var(--gold)', padding: '20px 12px' }}
                  >
                    <p className="text-sm" style={{ color: 'var(--ink3)' }}>Click to attach a screenshot of the area in question</p>
                  </div>
                )}
              </div>

              {error && <div className="text-sm px-3 py-2" style={{ background: 'var(--rouge-l)', color: 'var(--rouge)', borderRadius: 6 }}>{error}</div>}
              {!canSubmit && !submitting && (description.trim().length > 0 || file) && (
                <p className="text-xs" style={{ color: 'var(--ink3)' }}>
                  {!file ? 'Attach a screenshot to continue.' : 'Add a short description to continue.'}
                </p>
              )}
            </div>
            <div className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--line)' }}>
              <button onClick={onClose} className="px-4 py-2 text-sm" style={{ color: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 8 }}>Cancel</button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="px-4 py-2 text-sm font-medium"
                style={{ background: canSubmit ? 'var(--gold)' : 'var(--ink2)', color: 'var(--cream)', borderRadius: 8, opacity: canSubmit ? 1 : 0.6 }}
              >
                {submitting ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}