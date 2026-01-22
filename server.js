/**
 * Broadcast System Server
 * Express + WebSocket server with YouTube Chat Scraper
 *
 * Modular architecture - see /lib/ for individual modules:
 * - YouTubeChatScraper: YouTube live chat integration
 * - state: Centralized application state
 * - broadcast: WebSocket message batching and broadcasting
 * - rateLimit: Rate limiting for WebSocket connections
 * - imageOptimizer: Sharp-based image optimization
 * - routes: Express API routes
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const compression = require('compression');

// Import modular components
const YouTubeChatScraper = require('./lib/YouTubeChatScraper');
const state = require('./lib/state');
const { broadcast, addClient, removeClient, getClientCount } = require('./lib/broadcast');
const { checkRateLimit, startCleanupInterval } = require('./lib/rateLimit');
const { router: apiRouter, createStateRoutes, UPLOADS_DIR } = require('./lib/routes');

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8888;

// ============================================================================
// Performance Optimizations
// ============================================================================

// Enable gzip compression for all responses
app.use(compression({
  level: 6, // Balanced compression level
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    // Compress all text-based content
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Cache static assets for 1 day, HTML files for 1 hour
app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (['.js', '.css', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
  } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico'].includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
  } else if (['.mp4', '.webm', '.ogg', '.mov'].includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
  } else if (['.html', '.htm'].includes(ext)) {
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour
  }
  next();
});

// ============================================================================
// Express Routes
// ============================================================================

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve uploads directory
app.use('/uploads', express.static(UPLOADS_DIR));

// API routes
app.use('/api', apiRouter);
app.use('/api', createStateRoutes(state));

// ============================================================================
// YouTube Chat Scraper
// ============================================================================

const scraper = new YouTubeChatScraper();

// Set up scraper callbacks
scraper.onMessage((msg) => {
  console.log(`[Chat] ${msg.author}: ${msg.message}`);
  state.queue.push(msg);
  // Keep queue to last 100 messages
  if (state.queue.length > 100) {
    state.queue = state.queue.slice(-100);
  }
  broadcast('message', { message: msg });
  broadcast('queue_update', { queue: state.queue });
});

scraper.onSuperchat((superchat) => {
  console.log(`[Superchat] ${superchat.author} sent ${superchat.amountFormatted}: ${superchat.message}`);
  broadcast('superchat', { superchat });
});

scraper.onError((error) => {
  console.error('[Scraper Error]', error.message);
  broadcast('error', { message: error.message });
});

// ============================================================================
// WebSocket Server
// ============================================================================

// Start rate limit cleanup
startCleanupInterval();

let clientIdCounter = 0;

wss.on('connection', (ws) => {
  const clientId = ++clientIdCounter;
  ws.clientId = clientId;

  console.log(`[WebSocket] Client ${clientId} connected`);
  addClient(ws);

  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      queue: state.queue,
      pinnedMessage: state.pinnedMessage,
      isConnected: state.isConnected,
      videoId: state.videoId,
      tickerItems: state.tickerItems,
      tickerSpeed: state.tickerSpeed,
      showTicker: state.showTicker,
      tickerStyle: state.tickerStyle,
      sportsTicker: state.sportsTicker
    }
  }));

  ws.on('message', async (data) => {
    // Check rate limit
    if (!checkRateLimit(clientId)) {
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: 'Rate limit exceeded. Please slow down.' }
      }));
      return;
    }

    try {
      const message = JSON.parse(data);
      console.log(`[WebSocket] Client ${clientId}:`, message.type);

      await handleWebSocketMessage(ws, message, scraper);
    } catch (error) {
      console.error('[WebSocket] Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    removeClient(ws);
  });

  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
    removeClient(ws);
  });
});

// ============================================================================
// WebSocket Message Handler
// ============================================================================

async function handleWebSocketMessage(ws, message, scraper) {
  switch (message.type) {
    case 'connect':
      // Connect to YouTube video
      try {
        console.log('[YouTube] Connect request for URL:', message.url);
        const videoId = scraper.setVideoId(message.url);
        console.log('[YouTube] Extracted video ID:', videoId);
        const success = await scraper.start();
        console.log('[YouTube] Start result:', success);
        if (success) {
          state.isConnected = true;
          state.videoId = videoId;
          broadcast('status', { connected: true, videoId });
          console.log('[YouTube] Successfully connected to video:', videoId);
        } else {
          console.log('[YouTube] Failed to connect - start() returned false');
          broadcast('error', { message: 'Failed to connect to video. Make sure it is a live stream with chat enabled.' });
        }
      } catch (error) {
        console.error('[YouTube] Connection error:', error.message);
        broadcast('error', { message: error.message });
      }
      break;

    case 'disconnect':
      scraper.stop();
      state.isConnected = false;
      state.videoId = null;
      broadcast('status', { connected: false, videoId: null });
      break;

    case 'pin_message':
      // Pin a message
      console.log('[Pin] Request to pin message ID:', message.messageId);
      console.log('[Pin] Queue has', state.queue.length, 'messages');
      console.log('[Pin] Queue IDs:', state.queue.map(m => m.id));
      const msgToPin = state.queue.find(m => m.id === message.messageId);
      if (msgToPin) {
        state.pinnedMessage = msgToPin;
        broadcast('pin', { message: state.pinnedMessage });
        console.log('[Pin] Successfully pinned message from:', msgToPin.author);
      } else {
        console.log('[Pin] Message not found in queue');
      }
      break;

    case 'unpin':
      state.pinnedMessage = null;
      broadcast('pin', { message: null });
      break;

    case 'add_to_queue':
      // Manually add a message
      const newMsg = {
        id: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: message.isSuperchat ? 'superchat' : 'message',
        author: message.author || 'Anonymous',
        authorPhoto: '',
        message: message.message || '',
        timestamp: Date.now(),
        badges: [],
        isSuperchat: message.isSuperchat || false,
        amount: message.amount || 0,
        amountFormatted: message.amount ? `$${message.amount.toFixed(2)}` : '',
        tier: message.isSuperchat ? scraper.getSuperchatTier(message.amount || 0) : null
      };
      state.queue.push(newMsg);
      // Keep queue to last 100 messages
      if (state.queue.length > 100) {
        state.queue = state.queue.slice(-100);
      }
      broadcast('queue_update', { queue: state.queue });
      break;

    case 'remove_from_queue':
      state.queue = state.queue.filter(m => m.id !== message.messageId);
      broadcast('queue_update', { queue: state.queue });
      break;

    case 'clear_queue':
      state.queue = [];
      broadcast('queue_update', { queue: state.queue });
      break;

    case 'update_ticker':
      if (message.items) state.tickerItems = message.items;
      if (message.speed !== undefined) state.tickerSpeed = message.speed;
      if (message.show !== undefined) state.showTicker = message.show;
      if (message.style) state.tickerStyle = message.style;
      if (message.sportsTicker) {
        if (message.sportsTicker.brand !== undefined) state.sportsTicker.brand = message.sportsTicker.brand;
        if (message.sportsTicker.category !== undefined) state.sportsTicker.category = message.sportsTicker.category;
        if (message.sportsTicker.logoUrl !== undefined) state.sportsTicker.logoUrl = message.sportsTicker.logoUrl;
      }
      broadcast('ticker_update', {
        tickerItems: state.tickerItems,
        tickerSpeed: state.tickerSpeed,
        showTicker: state.showTicker,
        tickerStyle: state.tickerStyle,
        sportsTicker: state.sportsTicker
      });
      break;

    // ============== SLIDESHOW MESSAGES ==============
    case 'slideshow_sync':
      // Full state sync from control panel
      if (message.slides !== undefined) state.slideshow.slides = message.slides;
      if (message.currentIndex !== undefined) state.slideshow.currentIndex = message.currentIndex;
      if (message.isPlaying !== undefined) state.slideshow.isPlaying = message.isPlaying;
      if (message.globalSettings) state.slideshow.globalSettings = message.globalSettings;
      broadcast('slideshow_update', state.slideshow);
      break;

    case 'slideshow_navigate':
      // Navigate to specific slide
      state.slideshow.currentIndex = message.index;
      broadcast('slideshow_update', state.slideshow);
      break;

    case 'slideshow_play':
      state.slideshow.isPlaying = message.isPlaying;
      broadcast('slideshow_update', state.slideshow);
      break;

    case 'slideshow_get':
      // Request current slideshow state (for OBS windows)
      ws.send(JSON.stringify({
        type: 'slideshow_init',
        data: state.slideshow
      }));
      break;

    // ============== SPORTS TICKER MESSAGES ==============
    case 'sports_ticker_sync':
      // Full state sync from control panel
      if (message.brand !== undefined) state.sportsTicker.brand = message.brand;
      if (message.category !== undefined) state.sportsTicker.category = message.category;
      if (message.topic !== undefined) state.sportsTicker.topic = message.topic;
      if (message.description !== undefined) state.sportsTicker.description = message.description;
      if (message.logoUrl !== undefined) state.sportsTicker.logoUrl = message.logoUrl;
      if (message.show !== undefined) state.sportsTicker.show = message.show;
      if (message.scrollEnabled !== undefined) state.sportsTicker.scrollEnabled = message.scrollEnabled;
      if (message.scrollSpeed !== undefined) state.sportsTicker.scrollSpeed = message.scrollSpeed;
      broadcast('sports_ticker_update', state.sportsTicker);
      break;

    case 'sports_ticker_get':
      // Request current sports ticker state (for OBS windows)
      ws.send(JSON.stringify({
        type: 'sports_ticker_init',
        data: state.sportsTicker
      }));
      break;

    default:
      console.log('[WebSocket] Unknown message type:', message.type);
  }
}

// ============================================================================
// Start Server
// ============================================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Broadcast System Server Started                   ║
╠════════════════════════════════════════════════════════════╣
║  HTTP Server:     http://localhost:${PORT}                    ║
║  WebSocket:       ws://localhost:${PORT}                      ║
╠════════════════════════════════════════════════════════════╣
║  Pages:                                                     ║
║  - Control Panel: http://localhost:${PORT}/youtube_chat.html  ║
║  - Ticker Widget: http://localhost:${PORT}/ticker.html        ║
║  - Sports Ticker: http://localhost:${PORT}/ticker_sports.html ║
║  - Slideshow:     http://localhost:${PORT}/slideshow_4.html   ║
╠════════════════════════════════════════════════════════════╣
║  API:                                                       ║
║  - Health Check:  http://localhost:${PORT}/api/health         ║
║  - State:         http://localhost:${PORT}/api/state          ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Export for testing
module.exports = { app, server, wss, state, scraper };
