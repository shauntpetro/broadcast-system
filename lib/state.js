/**
 * Application State Management
 * Centralized state for the broadcast system
 */

const state = {
  queue: [],           // Chat message queue
  pinnedMessage: null, // Currently pinned message
  isConnected: false,  // YouTube connection status
  videoId: null,       // Current YouTube video ID
  tickerItems: [       // Ticker content
    { title: 'BREAKING', content: 'Welcome to the broadcast' }
  ],
  tickerSpeed: 100,
  showTicker: true,
  tickerStyle: 'sports', // Always use sports broadcast style
  // Sports ticker specific settings
  sportsTicker: {
    brand: 'SEMEEX',
    category: 'FOOTBALL',
    logoUrl: '/public/logos/SemeexLogo.png'
  },
  // Slideshow state
  slideshow: {
    slides: [],
    currentIndex: 0,
    isPlaying: false,
    globalSettings: {
      transition: 'blur',
      transitionDuration: 0.4,
      defaultKenBurns: 'none',
      defaultKenBurnsDuration: 30
    }
  }
};

module.exports = state;
