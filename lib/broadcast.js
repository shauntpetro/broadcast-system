/**
 * WebSocket Broadcasting Utilities
 * Message batching and delta state updates for performance
 */

const WebSocket = require('ws');

// Connected clients
const clients = new Set();

// Message batching for performance optimization
const messageBatch = {
  queue: [],
  timeout: null,
  BATCH_DELAY: 50, // ms - batch messages within this window
  MAX_BATCH_SIZE: 20 // Maximum messages per batch
};

// Track last sent state for delta comparison
let lastBroadcastState = {};

/**
 * Flush batched messages to all clients
 */
function flushBatch() {
  if (messageBatch.queue.length === 0) return;

  // Combine messages into single payload
  const batchPayload = JSON.stringify({
    type: 'batch',
    messages: messageBatch.queue
  });

  // Send to all clients
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(batchPayload);
    }
  }

  // Clear batch
  messageBatch.queue = [];
  messageBatch.timeout = null;
}

/**
 * Broadcast a message to all connected clients
 * @param {string} type - Message type
 * @param {object} data - Message data
 * @param {object} options - Options (immediate: boolean)
 */
function broadcast(type, data, options = {}) {
  const message = { type, data };

  // Some messages should be sent immediately (e.g., connection status, pin updates, slideshow sync)
  const immediateTypes = ['status', 'error', 'init', 'slideshow_init', 'slideshow_update', 'sports_ticker_init', 'sports_ticker_update', 'state_delta', 'pin', 'queue_update'];
  const shouldBatch = !options.immediate && !immediateTypes.includes(type);

  if (shouldBatch && messageBatch.BATCH_DELAY > 0) {
    // Add to batch
    messageBatch.queue.push(message);

    // Flush if batch is full
    if (messageBatch.queue.length >= messageBatch.MAX_BATCH_SIZE) {
      if (messageBatch.timeout) {
        clearTimeout(messageBatch.timeout);
      }
      flushBatch();
    } else if (!messageBatch.timeout) {
      // Schedule batch flush
      messageBatch.timeout = setTimeout(flushBatch, messageBatch.BATCH_DELAY);
    }
  } else {
    // Send immediately
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

/**
 * Broadcast full state to all clients
 * @param {object} state - Application state
 */
function broadcastState(state) {
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

/**
 * Broadcast only changed state properties (delta updates)
 * Significantly reduces network overhead for frequent updates
 * @param {object} changes - Changed properties
 */
function broadcastDelta(changes) {
  if (Object.keys(changes).length === 0) return;
  broadcast('state_delta', changes, { immediate: true });
}

/**
 * Compare and broadcast only changed state
 * @param {object} newState - New state object
 */
function broadcastStateChanges(newState) {
  const delta = {};

  for (const key of Object.keys(newState)) {
    const newVal = newState[key];
    const oldVal = lastBroadcastState[key];

    // Deep comparison for objects/arrays
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
      delta[key] = newVal;
    }
  }

  if (Object.keys(delta).length > 0) {
    lastBroadcastState = { ...lastBroadcastState, ...delta };
    broadcastDelta(delta);
  }
}

/**
 * Broadcast a single new message (instead of entire queue)
 * @param {object} message - The message to broadcast
 */
function broadcastNewMessage(message) {
  broadcast('message_add', { message }, { immediate: false });
}

/**
 * Broadcast message removal
 * @param {string} messageId - ID of removed message
 */
function broadcastMessageRemoved(messageId) {
  broadcast('message_remove', { messageId }, { immediate: true });
}

/**
 * Add a client to the broadcast list
 * @param {WebSocket} ws - WebSocket client
 */
function addClient(ws) {
  clients.add(ws);
}

/**
 * Remove a client from the broadcast list
 * @param {WebSocket} ws - WebSocket client
 */
function removeClient(ws) {
  clients.delete(ws);
}

/**
 * Get number of connected clients
 * @returns {number}
 */
function getClientCount() {
  return clients.size;
}

module.exports = {
  clients,
  broadcast,
  broadcastState,
  broadcastDelta,
  broadcastStateChanges,
  broadcastNewMessage,
  broadcastMessageRemoved,
  addClient,
  removeClient,
  getClientCount
};
