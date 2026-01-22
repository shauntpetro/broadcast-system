/**
 * YouTube Chat Scraper
 * Scrapes live chat messages from YouTube livestreams
 */

const fetch = require('node-fetch');

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

module.exports = YouTubeChatScraper;
