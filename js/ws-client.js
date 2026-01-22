/**
 * SEMEEX Broadcast System - Shared WebSocket Client
 * Unified WebSocket connection management for all pages
 *
 * Usage:
 *   const ws = new BroadcastWSClient({
 *     onInit: (data) => { ... },
 *     onMessage: (msg) => { ... },
 *     onError: (err) => { ... }
 *   });
 *   ws.connect();
 *   ws.send('pin_message', { messageId: '123' });
 */

class BroadcastWSClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.isConnecting = false;
    this.messageQueue = []; // Queue messages while disconnected

    // Default handlers
    this.defaultHandlers = {
      onOpen: () => console.log('[WS] Connected'),
      onClose: () => console.log('[WS] Disconnected'),
      onError: (err) => console.error('[WS] Error:', err),
      onReconnect: (attempt) => console.log(`[WS] Reconnecting (${attempt}/${this.maxReconnectAttempts})...`)
    };
  }

  /**
   * Get WebSocket URL based on current location
   */
  getWSUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

    // In development, always use port 8888 for WebSocket
    const wsPort = host === 'localhost' || host === '127.0.0.1' ? '8888' : port;

    return `${protocol}//${host}:${wsPort}`;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    const url = this.getWSUrl();

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Flush queued messages
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          this.send(msg.type, msg.data);
        }

        (this.handlers.onOpen || this.defaultHandlers.onOpen)();
      };

      this.ws.onclose = (event) => {
        this.isConnecting = false;
        (this.handlers.onClose || this.defaultHandlers.onClose)(event);

        // Auto-reconnect unless intentionally closed
        if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        this.isConnecting = false;
        (this.handlers.onError || this.defaultHandlers.onError)(error);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };

    } catch (error) {
      this.isConnecting = false;
      (this.handlers.onError || this.defaultHandlers.onError)(error);
      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);

      // Handle batched messages
      if (data.type === 'batch' && Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          this.dispatchMessage(msg);
        }
        return;
      }

      this.dispatchMessage(data);

    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  }

  /**
   * Dispatch a single message to appropriate handler
   */
  dispatchMessage(data) {
    const { type, data: payload } = data;

    // Check for specific handler first
    const handlerName = `on${this.capitalize(type)}`;
    if (this.handlers[handlerName]) {
      this.handlers[handlerName](payload);
      return;
    }

    // Common message type handlers
    switch (type) {
      case 'init':
        if (this.handlers.onInit) this.handlers.onInit(payload);
        break;
      case 'state':
        if (this.handlers.onState) this.handlers.onState(payload);
        break;
      case 'status':
        if (this.handlers.onStatus) this.handlers.onStatus(payload);
        break;
      case 'error':
        if (this.handlers.onServerError) this.handlers.onServerError(payload);
        break;
      case 'message':
        if (this.handlers.onChatMessage) this.handlers.onChatMessage(payload);
        break;
      case 'superchat':
        if (this.handlers.onSuperchat) this.handlers.onSuperchat(payload);
        break;
      case 'pin':
        if (this.handlers.onPin) this.handlers.onPin(payload);
        break;
      case 'queue_update':
        if (this.handlers.onQueueUpdate) this.handlers.onQueueUpdate(payload);
        break;
      case 'ticker_update':
        if (this.handlers.onTickerUpdate) this.handlers.onTickerUpdate(payload);
        break;
      case 'slideshow_update':
        if (this.handlers.onSlideshowUpdate) this.handlers.onSlideshowUpdate(payload);
        break;
      case 'slideshow_init':
        if (this.handlers.onSlideshowInit) this.handlers.onSlideshowInit(payload);
        break;
      case 'sports_ticker_update':
        if (this.handlers.onSportsTickerUpdate) this.handlers.onSportsTickerUpdate(payload);
        break;
      case 'sports_ticker_init':
        if (this.handlers.onSportsTickerInit) this.handlers.onSportsTickerInit(payload);
        break;
      default:
        // Generic handler for unknown types
        if (this.handlers.onMessage) {
          this.handlers.onMessage(data);
        }
    }
  }

  /**
   * Send a message to the server
   */
  send(type, data = {}) {
    const message = { type, ...data };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    } else {
      // Queue message for later
      this.messageQueue.push({ type, data });
      console.warn('[WS] Not connected, message queued:', type);
      return false;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    (this.handlers.onReconnect || this.defaultHandlers.onReconnect)(this.reconnectAttempts);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  /**
   * Check if connected
   */
  get isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Capitalize first letter
   */
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  }

  // ============================================================================
  // Convenience Methods for Common Operations
  // ============================================================================

  /**
   * Connect to YouTube video chat
   */
  connectToYouTube(url) {
    return this.send('connect', { url });
  }

  /**
   * Disconnect from YouTube
   */
  disconnectFromYouTube() {
    return this.send('disconnect');
  }

  /**
   * Pin a message
   */
  pinMessage(messageId) {
    return this.send('pin_message', { messageId });
  }

  /**
   * Unpin current message
   */
  unpinMessage() {
    return this.send('unpin');
  }

  /**
   * Add manual message to queue
   */
  addToQueue(author, message, isSuperchat = false, amount = 0) {
    return this.send('add_to_queue', { author, message, isSuperchat, amount });
  }

  /**
   * Remove message from queue
   */
  removeFromQueue(messageId) {
    return this.send('remove_from_queue', { messageId });
  }

  /**
   * Clear all messages from queue
   */
  clearQueue() {
    return this.send('clear_queue');
  }

  /**
   * Update ticker settings
   */
  updateTicker(settings) {
    return this.send('update_ticker', settings);
  }

  /**
   * Sync slideshow state
   */
  syncSlideshow(state) {
    return this.send('slideshow_sync', state);
  }

  /**
   * Navigate to slide
   */
  navigateSlide(index) {
    return this.send('slideshow_navigate', { index });
  }

  /**
   * Set slideshow play state
   */
  setPlaying(isPlaying) {
    return this.send('slideshow_play', { isPlaying });
  }

  /**
   * Request slideshow state
   */
  requestSlideshowState() {
    return this.send('slideshow_get');
  }

  /**
   * Sync sports ticker state
   */
  syncSportsTicker(state) {
    return this.send('sports_ticker_sync', state);
  }

  /**
   * Request sports ticker state
   */
  requestSportsTickerState() {
    return this.send('sports_ticker_get');
  }
}

// Export for module systems, also expose globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BroadcastWSClient;
}
if (typeof window !== 'undefined') {
  window.BroadcastWSClient = BroadcastWSClient;
}
