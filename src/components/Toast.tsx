'use client'

// Toast notification system. Replaces window.alert() with a small,
// non-blocking message that appears bottom-right and auto-dismisses.
//
// Usage:
//   const toast = useToast()
//   toast('Saved!')                    // neutral/success styling
//   toast('Could not save: ' + msg, 'error')
//
// Drop-in for the old pattern of `alert('Save failed: ' + error.message)`
// — just call `toast(...)` instead. No await needed; it never blocks.

import { createContext, useCallback, useContext, useRef, useState } from 'react'

type ToastType = 'success' | 'error' | 'info'

type ToastItem = {
  id: number
  message: string
  type: ToastType
}

type ToastFn = (message: string, type?: ToastType) => void

const ToastContext = createContext<ToastFn | null>(null)

const COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: 'var(--emerald-l)', border: 'var(--emerald)', text: 'var(--emerald)' },
  error: { bg: 'var(--rouge-l)', border: 'var(--rouge)', text: 'var(--rouge)' },
  info: { bg: 'var(--gold-l)', border: 'var(--gold)', text: 'var(--gold-tag)' },
}

const AUTO_DISMISS_MS = 4500

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast: ToastFn = useCallback((message, type = 'success') => {
    const id = ++idRef.current
    setItems(prev => [...prev, { id, message, type }])
    window.setTimeout(() => remove(id), AUTO_DISMISS_MS)
  }, [remove])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 360,
          width: 'calc(100vw - 32px)',
        }}
      >
        {items.map(item => {
          const c = COLORS[item.type]
          return (
            <div
              key={item.id}
              role="status"
              onClick={() => remove(item.id)}
              style={{
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: c.text,
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                lineHeight: 1.4,
                boxShadow: '0 4px 16px rgba(28,26,23,0.12)',
                cursor: 'pointer',
                animation: 'toast-in 0.18s ease-out',
              }}
            >
              {item.message}
            </div>
          )
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Fail safe rather than crash the page if a component renders outside
    // the provider (shouldn't happen — provider is mounted at root layout).
    return (message: string) => console.error('[toast, no provider]', message)
  }
  return ctx
}
