'use client'
export default function ProtectionPage() {
  return (
    <div className="flex flex-col min-h-full">
      <div style={{ background: 'var(--charcoal)', padding: '0 48px' }}>
        <div className="py-8"><div className="font-serif text-3xl font-light" style={{ color: '#F0EDE8' }}>Wealth Protection</div><div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Insurance coverage dashboard — coming soon</div></div>
      </div>
      <div style={{ padding: '48px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="text-center"><div className="font-serif text-2xl mb-3" style={{ color: 'var(--ink)' }}>Wealth Protection</div><p className="text-sm" style={{ color: 'var(--ink3)' }}>Family financial runway, CI analysis and Death/TPD will be here.</p></div>
      </div>
    </div>
  )
}