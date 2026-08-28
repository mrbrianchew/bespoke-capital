const withPWA = require('@ducanh2912/next-pwa').default({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  // Route-level (client-side) navigation caching is OFF on purpose: several
  // dashboard routes render client PII/financial data and we don't want any
  // chance of a stale cached view surfacing after logout or on a shared
  // device. See runtimeCaching below for the same reasoning applied to the
  // service worker's fetch interception.
  cacheOnFrontEndNav: false,
  workboxOptions: {
    // This REPLACES next-pwa's default runtime caching (which caches API
    // responses and page navigations by default) with an explicit allowlist.
    // Anything not matched below simply isn't intercepted by the service
    // worker and always goes straight to the network.
    runtimeCaching: [
      {
        // Supabase (auth + all client/financial data) and our own API
        // routes: never cache. This is the one that matters — it's the
        // guarantee that no client PII or financial figures can ever be
        // served stale from the service worker cache.
        urlPattern: ({ url }) =>
          url.origin.includes('.supabase.co') || url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
      },
      {
        // Page navigations (HTML documents), including the token-gated
        // /share, /statement, /report-print routes: never cache. If the
        // network is down, the browser shows its normal offline error
        // instead of a stale cached page — deliberate, not an oversight.
        urlPattern: ({ request }) => request.mode === 'navigate',
        handler: 'NetworkOnly',
      },
      {
        // Hashed build output (JS/CSS chunks) — filenames change on every
        // deploy, so caching them aggressively is safe and just makes
        // repeat loads faster.
        urlPattern: /^\/_next\/static\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'next-static',
          expiration: { maxEntries: 200 },
        },
      },
      {
        // Self-hosted fonts (next/font) and images/icons — static, no PII.
        urlPattern: ({ request }) =>
          request.destination === 'font' || request.destination === 'image',
        handler: 'CacheFirst',
        options: {
          cacheName: 'static-assets',
          expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @sparticuz/chromium ships a Chromium binary at a specific path relative
  // to its own package folder (node_modules/@sparticuz/chromium/bin). If
  // Next.js's webpack build bundles that package like ordinary application
  // code, it gets relocated into the .next server output and can no longer
  // find its own binary at runtime — the export-pdf route fails with "input
  // directory .../bin does not exist" (confirmed in production). Marking it
  // (and puppeteer-core, which loads it) as an external server package keeps
  // both as plain node_modules requires instead, so the relative path holds.
  //
  // Both serverComponentsExternalPackages and outputFileTracingIncludes MUST
  // stay nested under `experimental` on Next.js 14.2.x — they only became
  // stable, top-level config keys (serverExternalPackages /
  // outputFileTracingIncludes) starting in Next.js 15. Putting either at the
  // top level on 14.2.x silently no-ops instead of erroring, which is why
  // this took a few tries to get right.
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],

    // serverComponentsExternalPackages (above) stops webpack from bundling
    // @sparticuz/chromium's JS, but Vercel's separate output file tracing
    // step — which decides which files actually get copied into the
    // deployed function — doesn't detect the package's binary assets
    // (chromium.br, fonts.tar.br, etc.) because they're extracted at
    // runtime via fs calls, not require()'d or imported. Without this, the
    // function deploys without its own Chromium binary. Key is the route's
    // URL PATH (matched with picomatch per Next's docs), not a file path —
    // no /route suffix.
    outputFileTracingIncludes: {
      '/api/report/export-pdf': ['node_modules/@sparticuz/chromium/bin/**/*'],
    },
  },

  // Strip client-side console.* from production bundles, but keep error/warn
  // so genuine failures still surface. This removes the debug console.log
  // statements that were dumping client financial data / PII to the browser
  // console in production. Dev builds are unaffected.
  compiler: {
    removeConsole: { exclude: ['error', 'warn'] },
  },

  // Baseline security headers. These are safe (non-breaking) for the current
  // app: no cross-origin framing is used, and all external calls are simple
  // fetches, not embedded contexts.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Anti-clickjacking / anti-framing (protects the password-gated
          // share pages from being framed into a phishing wrapper).
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Prevent MIME-type sniffing.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Don't leak tokenized share URLs in the Referer to third parties.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Force HTTPS on this host (Vercel is always HTTPS).
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Disable browser features the app doesn't use.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },

          // ── Content-Security-Policy (report-only template) ──────────────
          // Left commented and in Report-Only form on purpose: enabling a
          // strict CSP blind can break the share page (Google Fonts, the
          // Frankfurter FX fetch) or Supabase auth/realtime. To adopt it:
          //   1. Uncomment the line below.
          //   2. Deploy, open the app + a share link, and watch the browser
          //      console for "Content Security Policy" violation reports.
          //   3. Add any missing origins your app actually calls.
          //   4. Once clean, rename the header to 'Content-Security-Policy'
          //      to enforce it.
          // Migrating fonts to next/font (audit item M-2) lets you drop the
          // fonts.googleapis.com / fonts.gstatic.com entries entirely.
          //
          // { key: 'Content-Security-Policy-Report-Only', value: [
          //   "default-src 'self'",
          //   "script-src 'self' 'unsafe-inline'",
          //   "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          //   "font-src 'self' https://fonts.gstatic.com",
          //   "img-src 'self' data: blob:",
          //   "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.frankfurter.app",
          //   "frame-ancestors 'none'",
          //   "base-uri 'self'",
          //   "form-action 'self'",
          // ].join('; ') },
        ],
      },
    ]
  },
}

module.exports = withPWA(nextConfig)
