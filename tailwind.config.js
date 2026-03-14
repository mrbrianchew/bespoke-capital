/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        cream: '#F5F3EE',
        cream2: '#ECEAE4',
        cream3: '#E4E1DA',
        line: '#E0DDD6',
        line2: '#D0CDC5',
        ink: '#1A1816',
        ink2: '#4A4740',
        ink3: '#9A9690',
        gold: '#A8834A',
        'gold-l': '#F5EFE3',
        'gold-tag': '#8A6C3A',
        emerald: '#2A5E46',
        'emerald-l': '#E8F2ED',
        rouge: '#8A2828',
        'rouge-l': '#F2EAEA',
        charcoal: '#1C1A17',
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
