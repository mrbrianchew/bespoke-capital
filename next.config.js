/** @type {import('next').NextConfig} */
const nextConfig = {
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

module.exports = nextConfig
