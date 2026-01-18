/**
 * Broadcast System Server
 * Express + WebSocket server with YouTube Chat Scraper
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8888;

// ============================================================================
// File Upload Setup
// ============================================================================

const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('[Server] Created uploads directory');
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `slide-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images and videos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'), false);
    }
  }
});

// ============================================================================
// State Management
// ============================================================================

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
  tickerStyle: 'tape', // 'tape' (ripped paper) or 'sports'
  // Sports ticker specific settings
  sportsTicker: {
    brand: 'SEMEEX',
    category: 'FOOTBALL',
    logoUrl: '/uploads/SemeexLogo.png'
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

// ============================================================================
// YouTube Chat Scraper Class
// ============================================================================

class YouTubeChatScraper {
  constructor() {
    this.videoId = null;
    this.continuation = null;
    this.apiKey = null;
    this.isRunning = false;
    this.pollInterval = null;
    this.messageCallback = null;
    this.superchatCallback = null;
    this.errorCallback = null;
    this.seenMessageIds = new Set();
  }

  /**
   * Extract video ID from various YouTube URL formats
   */
  static extractVideoId(urlOrId) {
    if (!urlOrId) return null;

    // Already a video ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
      return urlOrId;
    }

    try {
      const url = new URL(urlOrId);

      // youtube.com/watch?v=VIDEO_ID
      if (url.searchParams.has('v')) {
        return url.searchParams.get('v');
      }

      // youtu.be/VIDEO_ID
      if (url.hostname === 'youtu.be') {
        return url.pathname.slice(1);
      }

      // youtube.com/live/VIDEO_ID
      if (url.pathname.startsWith('/live/')) {
        return url.pathname.split('/')[2];
      }
    } catch (e) {
      // Not a valid URL
    }

    return null;
  }

  /**
   * Fetch initial page data to get API key and continuation token
   */
  async fetchInitialData() {
    try {
      const response = await fetch(`https://www.youtube.com/watch?v=${this.videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const html = await response.text();

      // Extract API key
      const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
      if (apiKeyMatch) {
        this.apiKey = apiKeyMatch[1];
      }

      // Extract continuation token from live chat iframe
      const continuationMatch = html.match(/"continuation":"([^"]+)"/);
      if (continuationMatch) {
        this.continuation = continuationMatch[1];
      }

      // Alternative: look for live chat replay continuation
      if (!this.continuation) {
        const replayContinuation = html.match(/"liveChatRenderer".*?"continuations":\[{"reloadContinuationData":{"continuation":"([^"]+)"/);
        if (replayContinuation) {
          this.continuation = replayContinuation[1];
        }
      }

      if (!this.apiKey || !this.continuation) {
        throw new Error('Could not find API key or continuation token. Is this a live stream?');
      }

      console.log('[YouTubeChatScraper] Initialized with API key and continuation token');
      return true;
    } catch (error) {
      console.error('[YouTubeChatScraper] Failed to fetch initial data:', error.message);
      if (this.errorCallback) this.errorCallback(error);
      return false;
    }
  }

  /**
   * Fetch chat messages from YouTube's internal API
   */
  async fetchMessages() {
    if (!this.apiKey || !this.continuation) {
      return [];
    }

    try {
      const response = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20231219.04.00'
            }
          },
          continuation: this.continuation
        })
      });

      const data = await response.json();

      // Update continuation token for next request
      const continuations = data.continuationContents?.liveChatContinuation?.continuations;
      if (continuations && continuations.length > 0) {
        const newContinuation = continuations[0].invalidationContinuationData?.continuation ||
                               continuations[0].timedContinuationData?.continuation ||
                               continuations[0].reloadContinuationData?.continuation;
        if (newContinuation) {
          this.continuation = newContinuation;
        }
      }

      // Parse messages
      const actions = data.continuationContents?.liveChatContinuation?.actions || [];
      const messages = [];

      for (const action of actions) {
        const item = action.replayChatItemAction?.actions?.[0]?.addChatItemAction?.item ||
                    action.addChatItemAction?.item;

        if (!item) continue;

        // Regular chat message
        if (item.liveChatTextMessageRenderer) {
          const msg = this.parseTextMessage(item.liveChatTextMessageRenderer);
          if (msg && !this.seenMessageIds.has(msg.id)) {
            this.seenMessageIds.add(msg.id);
            messages.push(msg);
          }
        }

        // Superchat
        if (item.liveChatPaidMessageRenderer) {
          const superchat = this.parseSuperchat(item.liveChatPaidMessageRenderer);
          if (superchat && !this.seenMessageIds.has(superchat.id)) {
            this.seenMessageIds.add(superchat.id);
            messages.push(superchat);
            if (this.superchatCallback) {
              this.superchatCallback(superchat);
            }
          }
        }
      }

      return messages;
    } catch (error) {
      console.error('[YouTubeChatScraper] Error fetching messages:', error.message);
      if (this.errorCallback) this.errorCallback(error);
      return [];
    }
  }

  /**
   * Parse a regular text message
   */
  parseTextMessage(renderer) {
    try {
      const authorName = renderer.authorName?.simpleText || 'Unknown';
      const authorPhoto = renderer.authorPhoto?.thumbnails?.[0]?.url || '';
      const messageText = renderer.message?.runs?.map(r => r.text || r.emoji?.emojiId || '').join('') || '';
      const id = renderer.id || `msg_${Date.now()}_${Math.random()}`;
      const timestamp = parseInt(renderer.timestampUsec) / 1000 || Date.now();

      // Check for badges (member, moderator, owner)
      const badges = [];
      if (renderer.authorBadges) {
        for (const badge of renderer.authorBadges) {
          const badgeRenderer = badge.liveChatAuthorBadgeRenderer;
          if (badgeRenderer?.icon?.iconType) {
            badges.push(badgeRenderer.icon.iconType.toLowerCase());
          }
          if (badgeRenderer?.customThumbnail) {
            badges.push('member');
          }
        }
      }

      return {
        id,
        type: 'message',
        author: authorName,
        authorPhoto,
        message: messageText,
        timestamp,
        badges,
        isSuperchat: false
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Parse a superchat message
   */
  parseSuperchat(renderer) {
    try {
      const authorName = renderer.authorName?.simpleText || 'Unknown';
      const authorPhoto = renderer.authorPhoto?.thumbnails?.[0]?.url || '';
      const messageText = renderer.message?.runs?.map(r => r.text || r.emoji?.emojiId || '').join('') || '';
      const id = renderer.id || `sc_${Date.now()}_${Math.random()}`;
      const timestamp = parseInt(renderer.timestampUsec) / 1000 || Date.now();

      // Parse purchase amount
      const purchaseAmount = renderer.purchaseAmountText?.simpleText || '$0.00';
      const amountMatch = purchaseAmount.match(/[\d,.]+/);
      const amount = amountMatch ? parseFloat(amountMatch[0].replace(/,/g, '')) : 0;

      // Determine superchat tier based on amount
      const tier = this.getSuperchatTier(amount);

      return {
        id,
        type: 'superchat',
        author: authorName,
        authorPhoto,
        message: messageText,
        timestamp,
        badges: [],
        isSuperchat: true,
        amount,
        amountFormatted: purchaseAmount,
        tier,
        backgroundColor: renderer.bodyBackgroundColor,
        headerBackgroundColor: renderer.headerBackgroundColor
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get superchat tier based on amount
   */
  getSuperchatTier(amount) {
    if (amount >= 100) return { tier: 7, color: '#e62117', name: 'red' };
    if (amount >= 50) return { tier: 6, color: '#e62117', name: 'red' };
    if (amount >= 20) return { tier: 5, color: '#e91e63', name: 'magenta' };
    if (amount >= 10) return { tier: 4, color: '#f57c00', name: 'orange' };
    if (amount >= 5) return { tier: 3, color: '#ffb300', name: 'yellow' };
    if (amount >= 2) return { tier: 2, color: '#00e5ff', name: 'teal' };
    return { tier: 1, color: '#1e88e5', name: 'blue' };
  }

  /**
   * Set video ID and reset state
   */
  setVideoId(urlOrId) {
    const videoId = YouTubeChatScraper.extractVideoId(urlOrId);
    if (!videoId) {
      throw new Error('Invalid YouTube URL or video ID');
    }
    this.videoId = videoId;
    this.continuation = null;
    this.apiKey = null;
    this.seenMessageIds.clear();
    return videoId;
  }

  /**
   * Start scraping
   */
  async start() {
    if (this.isRunning) {
      console.log('[YouTubeChatScraper] Already running');
      return false;
    }

    if (!this.videoId) {
      throw new Error('No video ID set');
    }

    console.log(`[YouTubeChatScraper] Starting for video: ${this.videoId}`);

    const initialized = await this.fetchInitialData();
    if (!initialized) {
      return false;
    }

    this.isRunning = true;

    // Poll for messages every 2.5 seconds
    this.pollInterval = setInterval(async () => {
      const messages = await this.fetchMessages();
      for (const msg of messages) {
        if (this.messageCallback) {
          this.messageCallback(msg);
        }
      }
    }, 2500);

    return true;
  }

  /**
   * Stop scraping
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    console.log('[YouTubeChatScraper] Stopped');
  }

  /**
   * Event callbacks
   */
  onMessage(callback) {
    this.messageCallback = callback;
  }

  onSuperchat(callback) {
    this.superchatCallback = callback;
  }

  onError(callback) {
    this.errorCallback = callback;
  }

  get isConnected() {
    return this.isRunning;
  }
}

// Global scraper instance
const scraper = new YouTubeChatScraper();

// ============================================================================
// WebSocket Server
// ============================================================================

const clients = new Set();

function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function broadcastState() {
  broadcast('state', {
    queue: state.queue,
    pinnedMessage: state.pinnedMessage,
    isConnected: state.isConnected,
    videoId: state.videoId,
    tickerItems: state.tickerItems,
    tickerSpeed: state.tickerSpeed,
    showTicker: state.showTicker
  });
}

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');
  clients.add(ws);

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
    try {
      const message = JSON.parse(data);
      console.log('[WebSocket] Received:', message.type);

      switch (message.type) {
        case 'connect':
          // Connect to YouTube video
          try {
            const videoId = scraper.setVideoId(message.url);
            const success = await scraper.start();
            if (success) {
              state.isConnected = true;
              state.videoId = videoId;
              broadcast('status', { connected: true, videoId });
            } else {
              broadcast('error', { message: 'Failed to connect to video' });
            }
          } catch (error) {
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
          const msgToPin = state.queue.find(m => m.id === message.messageId);
          if (msgToPin) {
            state.pinnedMessage = msgToPin;
            broadcast('pin', { message: state.pinnedMessage });
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
    } catch (error) {
      console.error('[WebSocket] Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
    clients.delete(ws);
  });
});

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
// Express Routes
// ============================================================================

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve uploads directory
app.use('/uploads', express.static(UPLOADS_DIR));

// File upload endpoint for slideshow
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  console.log(`[Upload] Saved: ${req.file.originalname} -> ${fileUrl}`);

  res.json({
    success: true,
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
    size: req.file.size
  });
});

// Multiple file upload
app.post('/api/upload-multiple', upload.array('files', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const results = req.files.map(file => ({
    success: true,
    url: `/uploads/${file.filename}`,
    filename: file.filename,
    originalName: file.originalname,
    type: file.mimetype.startsWith('video/') ? 'video' : 'image',
    size: file.size
  }));

  console.log(`[Upload] Saved ${results.length} files`);
  res.json({ success: true, files: results });
});

// Delete uploaded file
app.delete('/api/upload/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(UPLOADS_DIR, filename);

  // Security: ensure filename doesn't contain path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    console.log(`[Upload] Deleted: ${filename}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// List uploaded files
app.get('/api/uploads', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR).map(filename => {
      const filepath = path.join(UPLOADS_DIR, filename);
      const stats = fs.statSync(filepath);
      const ext = path.extname(filename).toLowerCase();
      const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v'];

      return {
        filename,
        url: `/uploads/${filename}`,
        type: videoExts.includes(ext) ? 'video' : 'image',
        size: stats.size,
        created: stats.birthtime
      };
    });
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    connected: state.isConnected,
    videoId: state.videoId,
    queueSize: state.queue.length,
    clients: clients.size
  });
});

// Get current state
app.get('/api/state', (req, res) => {
  res.json({
    queue: state.queue,
    pinnedMessage: state.pinnedMessage,
    isConnected: state.isConnected,
    videoId: state.videoId,
    tickerItems: state.tickerItems,
    tickerSpeed: state.tickerSpeed,
    showTicker: state.showTicker,
    tickerStyle: state.tickerStyle,
    sportsTicker: state.sportsTicker,
    slideshow: state.slideshow
  });
});

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
