/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // ArchStudio design tokens (see src/index.css). Legacy views keep Tailwind's slate/cyan.
        page: v('page'),
        surface: v('surface'),
        raised: v('raised'),
        sunken: v('sunken'),
        line: v('line'),
        'line-strong': v('line-strong'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        'ink-3': v('ink-3'),
        accent: v('accent'),
        'accent-ink': v('accent-ink'),
        'accent-soft': v('accent-soft'),
        ok: v('ok'),
        warn: v('warn'),
        danger: v('danger'),
      },
      borderRadius: {
        ctl: '10px',
        card: '16px',
        sheet: '22px',
      },
      boxShadow: {
        card: '0 1px 2px rgb(20 20 18 / 0.04), 0 1px 1px rgb(20 20 18 / 0.03)',
        float: '0 12px 32px -8px rgb(20 20 18 / 0.18), 0 2px 6px rgb(20 20 18 / 0.06)',
      },
      fontSize: {
        '2xs': ['11px', '14px'],
      },
    },
  },
  plugins: [],
};
