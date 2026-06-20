/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // accent is driven at runtime via CSS variables (theme accent setting)
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent) / 0.15)'
        },
        surface: {
          DEFAULT: 'rgb(18 18 22 / <alpha-value>)',
          raised: 'rgb(30 30 38 / <alpha-value>)'
        }
      },
      borderRadius: {
        panel: '24px'
      },
      backdropBlur: {
        xs: '2px'
      },
      boxShadow: {
        panel: '0 32px 80px -12px rgba(0,0,0,0.75)',
        glow: '0 0 24px -4px rgb(var(--accent) / 0.5)'
      },
      fontFamily: {
        sans: ['Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
