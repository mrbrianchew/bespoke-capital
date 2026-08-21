'use client'

// Confirm dialog system. Replaces window.confirm() with a styled modal
// that matches the app's design system.
//
// Usage:
//   const confirmAction = useConfirm()
//   const ok = await confirmAction('Delete this note?')
//   if (!ok) return
//
// Drop-in for the old pattern of `if (!window.confirm('...')) return`
// — becomes `if (!await confirmAction('...')) return`. The enclosing
// function needs to be `async` (it usually already is, since it's next
// to a Supabase call).
//
// Optional second argument for a destructive/danger style and custom
// button labels:
//   await confirmAction('Delete this policy? This cannot be undone.', {
//     danger: true, confirmLabel: 'Delete', cancelLabel: 'Cancel'
//   })

import { createContext, useCallback, useContext, useState } from 'react'

type ConfirmOptions = {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

type PendingState = {
  message: string
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null)

  const confirmAction: ConfirmFn = useCallback((message, options = {}) => {
    return new Promise<boolean>(resolve => {
      setPending({ message, options, resolve })
    })
  }, [])

  const close = (value: boolean) => {
    if (pending) pending.resolve(value)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(26,24,22,0.45)',
            padding: 16,
          }}
          onClick={() => close(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--cream)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 380,
              boxShadow: '0 12px 40px rgba(28,26,23,0.25)',
            }}
          >
            {pending.options.title && (
              <div
                className="font-serif"
                style={{ fontSize: 19, color: 'var(--ink)', marginBottom: 8 }}
              >
                {pending.options.title}
              </div>
            )}
            <div style={{ fontSize: 14, color: 'var(--ink2)', lineHeight: 1.5, marginBottom: 20 }}>
              {pending.message}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => close(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: '1px solid var(--line2)',
                  background: 'transparent',
                  color: 'var(--ink2)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {pending.options.cancelLabel || 'Cancel'}
              </button>
              <button
                onClick={() => close(true)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: pending.options.danger ? 'var(--rouge)' : 'var(--emerald)',
                  color: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {pending.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    // Fail safe rather than crash the page if a component renders outside
    // the provider (shouldn't happen — provider is mounted at root layout).
    return async (message: string) =>
      typeof window !== 'undefined' ? window.confirm(message) : false
  }
  return ctx
}
