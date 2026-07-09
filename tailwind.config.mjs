/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1ba89a',
          dark:    '#158c80',
          deep:    '#0f6e68',
          badge:   '#002d6b',
          light:   '#20b7ac',
          tint:    '#e8f7f6',
          tint2:   '#cff0ed',
        },
        coral:        '#ff6b54',
        'coral-soft': '#ffbcaf',
        navy: {
          DEFAULT: '#002d6b',
          light:   '#1a3d7a',
          tint:    '#e8edf6',
        },
        mauve: {
          DEFAULT: '#9b6ba8',
          tint:    '#f3eef6',
        },
        teal: {
          brand:   '#1ba89a',
          light:   '#20b7ac',
          tint:    '#cff0ed',
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
        red: {
          brand:    '#ef4444',
          tint:     '#fee2e2',
        },
        hof:          '#e8f7f6',
        cream:        '#fdf3da',
        'card-cream': '#fffdf7',
        border: {
          DEFAULT:  '#daeeed',
          purple:   '#b8e4e0',
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
        'btn-primary': '0 10px 24px rgba(27,168,154,0.30)',
        'hero-btn':    '0 6px 16px rgba(27,168,154,0.32)',
        'card-float':  '0 18px 44px rgba(28,22,38,0.18)',
        'hero-frame':  '18px 26px 54px rgba(27,168,154,0.16)',
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
