/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#7c3aed',
          dark:    '#6d28d9',
          deep:    '#5b21b6',
          badge:   '#2e1065',
          light:   '#a855f7',
          tint:    '#f1eafe',
          tint2:   '#efe7fd',
        },
        coral:        '#f0518a',
        'coral-soft': '#f0a4d0',
        teal: {
          brand:    '#0d9488',
          light:    '#2dd4bf',
          tint:     '#d6f5f0',
        },
        green: {
          brand:    '#16a34a',
          tint:     '#dcf6e3',
        },
        amber: {
          brand:    '#fbbf24',
          dark:     '#e89b1c',
          tint:     '#fef1d6',
        },
        hof:          '#f4effd',
        cream:        '#fdf3da',
        'card-cream': '#fffdf7',
        border: {
          DEFAULT:  '#efebf5',
          purple:   '#e6dcfb',
          cream:    '#f3eee2',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        hand: ['"Caveat"', 'cursive'],
      },
      maxWidth: {
        container: '1180px',
        how:       '1080px',
      },
      borderRadius: {
        btn:       '13px',
        'btn-sm':  '11px',
        card:      '22px',
        'card-lg': '26px',
        'card-sm': '18px',
        panel:     '17px',
      },
      boxShadow: {
        'btn-primary': '0 10px 24px rgba(124,58,237,0.3)',
        'hero-btn':    '0 6px 16px rgba(124,58,237,0.32)',
        'card-float':  '0 18px 44px rgba(28,22,38,0.18)',
        'hero-frame':  '18px 26px 54px rgba(124,58,237,0.16)',
        'winner-card': '0 8px 22px rgba(28,22,38,0.07)',
        'next-btn':    '0 8px 20px rgba(28,22,38,0.14)',
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0px) rotate(var(--deco-r, 0deg))' },
          '50%':     { transform: 'translateY(-14px) rotate(var(--deco-r, 0deg))' },
        },
        floaty2: {
          '0%,100%': { transform: 'translateY(0px) rotate(var(--deco-r, 0deg))' },
          '50%':     { transform: 'translateY(10px) rotate(var(--deco-r, 0deg))' },
        },
      },
      animation: {
        floaty:  'floaty 4.5s ease-in-out infinite',
        floaty2: 'floaty2 5.2s ease-in-out infinite',
        floaty3: 'floaty 6.0s ease-in-out infinite',
        floaty4: 'floaty2 4.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
