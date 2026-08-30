// BrandMark — the platform's shared logo mark: a faceted diamond built from
// four flat-shaded triangles (no gradients, no letters). Firm-agnostic by
// design, since multiple advisory firms use this platform — it sits next to
// each firm's own name rather than representing any single firm itself.
// Tested against white, cream, and charcoal backgrounds; holds up at sizes
// as small as ~20px without the facets blurring together.
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" style={{ flexShrink: 0 }} aria-hidden="true">
      <polygon points="14,1 14,14 1,14" fill="#D9BC8C" />
      <polygon points="14,1 27,14 14,14" fill="#A8834A" />
      <polygon points="14,14 1,14 14,27" fill="#8A6C3A" />
      <polygon points="14,14 14,27 27,14" fill="#5B4020" />
    </svg>
  )
}