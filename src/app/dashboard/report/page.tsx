'use client'
export default function ReportPage() {
  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="py-8"><div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>Report & PDF</div></div>
      </div>
      <div style={{ padding: '48px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="text-center"><div className="font-serif text-2xl mb-3" style={{ color: 'var(--ink) ' }}>Report & PDF</div></div>
      </div>
    </div>
  )
}