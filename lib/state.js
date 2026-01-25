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
  },

  // Nametag slots (1-5)
  nametags: {
    1: { name: '', channelName: '', logoPosition: 'right', visible: false, showLogo: true, logoUrl: '' },
    2: { name: '', channelName: '', logoPosition: 'left', visible: false, showLogo: false, logoUrl: '' },
    3: { name: '', channelName: '', logoPosition: 'right', visible: false, showLogo: false, logoUrl: '' },
    4: { name: '', channelName: '', logoPosition: 'right', visible: false, showLogo: false, logoUrl: '' },
    5: { name: '', channelName: '', logoPosition: 'right', visible: false, showLogo: false, logoUrl: '' }
  },

  // Social media accounts
  socialAccounts: [],
  socialRotationSpeed: 5000,
  showSocials: false,

  // Lower third (info mode)
  lowerThird: {
    visible: false,
    headline: '',
    description: ''
  },

  // Agenda
  agendaItems: [],
  agendaTitle: "TODAY'S AGENDA",
  showAgenda: false,

  // Topic Card (full-screen highlight)
  topicCard: {
    visible: false,
    title: '',
    subtitle: ''
  }
};

module.exports = state;
