/** @type {import('tailwindcss').Config} */
export default {
  // Content paths for CSS purging - only include used classes
  content: [
    './*.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],

  theme: {
    extend: {
      // Custom colors used in the broadcast system
      colors: {
        'broadcast-dark': '#0f172a',
        'broadcast-accent': '#3b82f6',
        'superchat-blue': '#1e88e5',
        'superchat-teal': '#00e5ff',
        'superchat-yellow': '#ffb300',
        'superchat-orange': '#f57c00',
        'superchat-magenta': '#e91e63',
        'superchat-red': '#e62117',
      },

      // Animation timing for smooth transitions
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
      },

      // Custom animations
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.4s ease-out',
        'pulse-slow': 'pulse 3s infinite',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },

      // Font families used in the project
      fontFamily: {
        'oswald': ['Oswald', 'sans-serif'],
        'inter': ['Inter', 'sans-serif'],
        'source': ['"Source Sans Pro"', 'sans-serif'],
      },
    },
  },

  plugins: [],

  // Safelist classes that are dynamically generated
  safelist: [
    // Position classes used dynamically
    'top-4', 'top-8', 'bottom-4', 'bottom-8',
    'left-4', 'left-8', 'right-4', 'right-8',
    'inset-x-0', 'inset-y-0',

    // Opacity classes
    { pattern: /opacity-\d+/ },

    // Transform classes
    { pattern: /translate-[xy]-\d+/ },
    { pattern: /scale-\d+/ },

    // Transition classes
    { pattern: /duration-\d+/ },
    { pattern: /delay-\d+/ },
  ],
};
