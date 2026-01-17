# YouTube Live Chat & Superchat Scraper Specification

A complete specification for building a standalone YouTube live chat and superchat scraper with real-time WebSocket broadcasting.

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Architecture](#architecture)
4. [Backend Implementation](#backend-implementation)
5. [Frontend Implementation](#frontend-implementation)
6. [Data Structures](#data-structures)
7. [WebSocket Protocol](#websocket-protocol)
8. [API Endpoints](#api-endpoints)
9. [Error Handling](#error-handling)
10. [Configuration](#configuration)
11. [Deployment](#deployment)

---

## Overview

This system scrapes YouTube live chat messages and superchats in real-time without requiring YouTube API quotas. It uses YouTube's internal `youtubei/v1/live_chat` endpoint with browser-like headers to avoid bot detection.

### Features

- Real-time live chat scraping (no API quota limits)
- Superchat detection with amount parsing
- User badge detection (Owner, Moderator, Verified, Member)
- WebSocket broadcasting to multiple clients
- Message deduplication
- Pin/unpin functionality for on-screen display
- Automatic reconnection handling
- Stream switching with data cleanup

---

## Technology Stack

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime environment |
| Express | 4.x | HTTP server |
| ws | 8.x | WebSocket server |
| axios | 1.x | HTTP client with browser headers |
| EventEmitter | built-in | Event-based scraper architecture |

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| Next.js | 14.x | React framework (optional) |
| GSAP | 3.x | Animation library |
| Tailwind CSS | 3.x | Styling |

### Optional Dependencies

| Technology | Purpose |
|------------|---------|
| youtube-chat | Fallback scraper library |
| YouTube Data API v3 | Members-only stream access |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    YouTube Live Stream                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  YouTubeChatScraper                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 1. Fetch live page HTML                             │    │
│  │ 2. Extract: API key, client version, continuation   │    │
│  │ 3. Poll youtubei/v1/live_chat endpoint              │    │
│  │ 4. Parse messages and superchats                    │    │
│  │ 5. Emit 'chat' events                               │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Express Server                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ - WebSocket server (ws)                             │    │
│  │ - State management (comments[], superchats[])       │    │
│  │ - Message deduplication                             │    │
│  │ - Broadcast to connected clients                    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌───────────────────┐ ┌───────────────┐ ┌───────────────┐
│   Queue Popout    │ │ Control Panel │ │ Stream Widget │
│   (Management)    │ │   (Admin)     │ │  (Display)    │
└───────────────────┘ └───────────────┘ └───────────────┘
```

---

## Backend Implementation

### YouTubeChatScraper Class

```javascript
/**
 * lib/youtube-chat-scraper.js
 *
 * Custom YouTube Live Chat Scraper
 * Server-friendly implementation with browser-like headers
 */

const axios = require('axios');
const EventEmitter = require('events');

// Browser-like headers to avoid bot detection
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// Headers for API requests
const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/json',
  'Origin': 'https://www.youtube.com',
  'Referer': 'https://www.youtube.com/',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'same-origin',
  'Sec-Fetch-Site': 'same-origin',
  'X-Youtube-Client-Name': '1',
  'X-Youtube-Client-Version': '2.20240101.00.00',
};

class YouTubeChatScraper extends EventEmitter {
  constructor(options = {}) {
    super();
    this.liveId = options.liveId || null;
    this.channelId = options.channelId || null;
    this.handle = options.handle || null;
    this.interval = options.interval || 2000; // Poll every 2 seconds
    this.isRunning = false;
    this.pollTimer = null;

    // Chat state
    this.apiKey = null;
    this.clientVersion = null;
    this.continuation = null;
    this.seenMessageIds = new Set();
  }

  async start() {
    if (this.isRunning) {
      return false;
    }

    try {
      // Fetch the live page to get required tokens
      const pageData = await this._fetchLivePage();

      if (!pageData) {
        throw new Error('Failed to fetch live page data');
      }

      this.apiKey = pageData.apiKey;
      this.clientVersion = pageData.clientVersion;
      this.continuation = pageData.continuation;
      this.liveId = pageData.liveId;

      this.isRunning = true;
      this.emit('start', this.liveId);

      // Start polling
      this._poll();

      return true;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  stop(reason) {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.isRunning) {
      this.isRunning = false;
      this.emit('end', reason || 'Stopped');
    }
  }

  async _fetchLivePage() {
    let url;

    if (this.liveId) {
      url = `https://www.youtube.com/watch?v=${this.liveId}`;
    } else if (this.channelId) {
      url = `https://www.youtube.com/channel/${this.channelId}/live`;
    } else if (this.handle) {
      const handle = this.handle.startsWith('@') ? this.handle : `@${this.handle}`;
      url = `https://www.youtube.com/${handle}/live`;
    } else {
      throw new Error('No video ID, channel ID, or handle provided');
    }

    try {
      const response = await axios.get(url, {
        headers: BROWSER_HEADERS,
        timeout: 15000,
        maxRedirects: 5,
      });

      const html = response.data;

      // Extract live ID from canonical URL
      const idMatch = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([^"]+)"/);
      if (!idMatch) {
        if (html.includes('"isReplay":true') || html.includes("'isReplay':true")) {
          throw new Error('This is a finished/replay stream, not a live stream');
        }
        throw new Error('Live stream not found - make sure the stream is currently live');
      }

      const liveId = idMatch[1];

      // Check if it's a replay
      if (html.includes('"isReplay":true') || html.includes("'isReplay':true")) {
        throw new Error(`Stream ${liveId} is a replay/finished stream`);
      }

      // Extract API key
      const keyMatch = html.match(/["']INNERTUBE_API_KEY["']:\s*["']([^"']+)["']/);
      if (!keyMatch) {
        throw new Error('Could not find YouTube API key');
      }
      const apiKey = keyMatch[1];

      // Extract client version
      const versionMatch = html.match(/["']clientVersion["']:\s*["']([\d.]+)["']/);
      if (!versionMatch) {
        throw new Error('Could not find client version');
      }
      const clientVersion = versionMatch[1];

      // Extract continuation token for live chat
      const continuationMatch = html.match(/["']continuation["']:\s*["']([^"']+)["']/);
      if (!continuationMatch) {
        const altMatch = html.match(/"continuation":"([^"]+)"/);
        if (!altMatch) {
          throw new Error('Could not find chat continuation token - live chat may be disabled');
        }
        return { liveId, apiKey, clientVersion, continuation: altMatch[1] };
      }

      return { liveId, apiKey, clientVersion, continuation: continuationMatch[1] };
    } catch (err) {
      if (err.response) {
        const status = err.response.status;
        if (status === 404) throw new Error('Video not found (404)');
        if (status === 403) throw new Error('Access forbidden (403) - video may be private or members-only');
        if (status === 429) throw new Error('Rate limited by YouTube (429) - try again later');
        throw new Error(`YouTube returned status ${status}: ${err.message}`);
      }
      throw err;
    }
  }

  async _fetchChat() {
    if (!this.apiKey || !this.continuation) {
      throw new Error('Not initialized - call start() first');
    }

    const url = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${this.apiKey}`;

    try {
      const response = await axios.post(url, {
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: this.clientVersion,
          },
        },
        continuation: this.continuation,
      }, {
        headers: API_HEADERS,
        timeout: 10000,
      });

      const data = response.data;

      // Update continuation for next request
      const continuationData = data?.continuationContents?.liveChatContinuation?.continuations?.[0];
      if (continuationData) {
        this.continuation =
          continuationData.invalidationContinuationData?.continuation ||
          continuationData.timedContinuationData?.continuation ||
          this.continuation;
      }

      // Parse chat messages
      const actions = data?.continuationContents?.liveChatContinuation?.actions || [];
      const chatItems = [];

      for (const action of actions) {
        const item = this._parseAction(action);
        if (item && !this.seenMessageIds.has(item.id)) {
          this.seenMessageIds.add(item.id);
          chatItems.push(item);
        }
      }

      // Keep seen messages set from growing too large
      if (this.seenMessageIds.size > 5000) {
        const arr = Array.from(this.seenMessageIds);
        this.seenMessageIds = new Set(arr.slice(-2500));
      }

      return chatItems;
    } catch (err) {
      if (err.response) {
        const status = err.response.status;
        if (status === 404) throw new Error('Chat not found - stream may have ended');
        if (status === 403) throw new Error('Chat access forbidden - may be members-only');
        if (status === 429) throw new Error('Rate limited by YouTube');
      }
      throw err;
    }
  }

  _parseAction(action) {
    const item = action?.addChatItemAction?.item;
    if (!item) return null;

    const renderer =
      item.liveChatTextMessageRenderer ||
      item.liveChatPaidMessageRenderer ||
      item.liveChatPaidStickerRenderer ||
      item.liveChatMembershipItemRenderer;

    if (!renderer) return null;

    // Parse message content
    let message = [];
    if (renderer.message?.runs) {
      message = renderer.message.runs.map(run => {
        if (run.text) {
          return { text: run.text };
        } else if (run.emoji) {
          const thumb = run.emoji.image?.thumbnails?.[0];
          return {
            url: thumb?.url || '',
            alt: run.emoji.shortcuts?.[0] || '',
            isCustomEmoji: !!run.emoji.isCustomEmoji,
            emojiText: run.emoji.isCustomEmoji ? (run.emoji.shortcuts?.[0] || '') : run.emoji.emojiId,
          };
        }
        return null;
      }).filter(Boolean);
    } else if (renderer.headerSubtext?.runs) {
      message = renderer.headerSubtext.runs.map(run => ({ text: run.text || '' }));
    }

    // Parse author info
    const authorName = renderer.authorName?.simpleText || '';
    const authorPhoto = renderer.authorPhoto?.thumbnails?.pop();
    const authorChannelId = renderer.authorExternalChannelId;

    // Parse badges
    let isOwner = false;
    let isModerator = false;
    let isVerified = false;
    let isMembership = false;
    let badge = null;

    if (renderer.authorBadges) {
      for (const entry of renderer.authorBadges) {
        const badgeRenderer = entry.liveChatAuthorBadgeRenderer;
        if (badgeRenderer?.customThumbnail) {
          isMembership = true;
          const thumb = badgeRenderer.customThumbnail.thumbnails?.[0];
          badge = {
            thumbnail: { url: thumb?.url || '', alt: badgeRenderer.tooltip || '' },
            label: badgeRenderer.tooltip || '',
          };
        } else {
          const iconType = badgeRenderer?.icon?.iconType;
          if (iconType === 'OWNER') isOwner = true;
          else if (iconType === 'MODERATOR') isModerator = true;
          else if (iconType === 'VERIFIED') isVerified = true;
        }
      }
    }

    // Build result
    const result = {
      id: renderer.id,
      author: {
        name: authorName,
        thumbnail: authorPhoto ? { url: authorPhoto.url, alt: authorName } : null,
        channelId: authorChannelId,
        badge,
      },
      message,
      isOwner,
      isModerator,
      isVerified,
      isMembership,
      timestamp: new Date(Number(renderer.timestampUsec) / 1000),
    };

    // Check for superchat
    if (renderer.purchaseAmountText) {
      result.superchat = {
        amount: renderer.purchaseAmountText.simpleText,
        color: renderer.bodyBackgroundColor
          ? `#${renderer.bodyBackgroundColor.toString(16).slice(2).toUpperCase()}`
          : '#FFCA28',
      };
    }

    // Check for sticker
    if (renderer.sticker) {
      const stickerThumb = renderer.sticker.thumbnails?.pop();
      result.superchat = {
        amount: renderer.purchaseAmountText?.simpleText || '',
        color: renderer.backgroundColor
          ? `#${renderer.backgroundColor.toString(16).slice(2).toUpperCase()}`
          : '#FFCA28',
        sticker: stickerThumb ? {
          url: stickerThumb.url,
          alt: renderer.sticker.accessibility?.accessibilityData?.label || '',
        } : null,
      };
    }

    return result;
  }

  async _poll() {
    if (!this.isRunning) return;

    try {
      const chatItems = await this._fetchChat();

      for (const item of chatItems) {
        this.emit('chat', item);
      }
    } catch (err) {
      this.emit('error', err);

      // Check for fatal errors
      const errMsg = err.message || '';
      if (
        errMsg.includes('ended') ||
        errMsg.includes('not found') ||
        errMsg.includes('forbidden') ||
        errMsg.includes('disabled')
      ) {
        this.stop(errMsg);
        return;
      }
    }

    // Schedule next poll
    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this._poll(), this.interval);
    }
  }
}

module.exports = { YouTubeChatScraper };
```

### Server Implementation

```javascript
/**
 * server.js
 *
 * Express + WebSocket server for YouTube chat scraping
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { YouTubeChatScraper } = require('./lib/youtube-chat-scraper');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// Configuration
const MAX_SCRAPER_ERRORS = 10;
let scraperErrorCount = 0;
let liveChat = null;

// State management
const state = {
  currentVideoId: null,
  comments: [],      // Array of comment objects
  superchats: [],    // Array of superchat objects
  pinnedItem: null,  // Currently pinned message
};

// Connected clients
const clients = new Set();

// Broadcast to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Stop all YouTube connections
function stopAllYouTubeConnections() {
  if (liveChat) {
    liveChat.stop();
    liveChat = null;
  }
  scraperErrorCount = 0;
}

// Clear old YouTube data when switching streams
function clearOldYouTubeData(newVideoId) {
  const isSwitchingStreams = state.currentVideoId && state.currentVideoId !== newVideoId;

  if (isSwitchingStreams || !state.currentVideoId) {
    // Unpin if pinned item is from old stream
    if (state.pinnedItem && state.pinnedItem.videoId &&
        state.pinnedItem.videoId !== newVideoId && !state.pinnedItem.isTest) {
      state.pinnedItem = null;
      broadcast({ type: 'unpin' });
    }

    // Remove comments/superchats from old streams (keep test data)
    state.comments = state.comments.filter(c => c.isTest || !c.videoId);
    state.superchats = state.superchats.filter(s => s.isTest || !s.videoId);

    broadcast({
      type: 'stream_changed',
      data: {
        oldVideoId: state.currentVideoId,
        newVideoId,
        comments: state.comments,
        superchats: state.superchats
      }
    });
  }
}

// Connect using YouTube chat scraper
async function connectWithScraper(videoId) {
  scraperErrorCount = 0;

  if (liveChat) {
    liveChat.stop();
    liveChat = null;
  }

  try {
    liveChat = new YouTubeChatScraper({ liveId: videoId });

    liveChat.on('chat', (chatItem) => {
      scraperErrorCount = 0;

      try {
        // Determine badge
        let badge = null;
        if (chatItem.isOwner) badge = 'OWNER';
        else if (chatItem.isModerator) badge = 'MOD';
        else if (chatItem.isVerified) badge = 'VERIFIED';
        else if (chatItem.isMembership) badge = 'MEMBER';

        // Extract message text
        const messageText = chatItem.message?.map(part => {
          if (typeof part === 'string') return part;
          if (part.text) return part.text;
          if (part.emojiText) return part.emojiText;
          return '';
        }).join('') || '';

        if (chatItem.superchat) {
          // Superchat
          const superchat = {
            id: chatItem.id || `sc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            username: chatItem.author?.name || 'Anonymous',
            message: messageText,
            amount: chatItem.superchat.amount || '£0.00',
            avatar: chatItem.author?.thumbnail?.url || null,
            badge,
            timestamp: Date.now(),
            type: 'superchat',
            videoId,
            isOwner: chatItem.isOwner,
            isMod: chatItem.isModerator,
            isMember: chatItem.isMembership,
          };
          handleMessage({ type: 'add_superchat', data: superchat });
        } else {
          // Regular comment
          const comment = {
            id: chatItem.id || `cm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            username: chatItem.author?.name || 'Anonymous',
            message: messageText,
            avatar: chatItem.author?.thumbnail?.url || null,
            badge,
            timestamp: Date.now(),
            type: 'comment',
            videoId,
            isOwner: chatItem.isOwner,
            isMod: chatItem.isModerator,
            isMember: chatItem.isMembership,
          };
          handleMessage({ type: 'add_comment', data: comment });
        }
      } catch (err) {
        console.error('Error processing chat message:', err);
      }
    });

    liveChat.on('error', (err) => {
      scraperErrorCount++;
      const errorMsg = err.message || 'Unknown error';

      const isCriticalError =
        errorMsg.includes('not found') ||
        errorMsg.includes('ended') ||
        errorMsg.includes('replay') ||
        errorMsg.includes('forbidden') ||
        errorMsg.includes('disabled') ||
        errorMsg.includes('(404)') ||
        errorMsg.includes('(403)');

      if (isCriticalError || scraperErrorCount >= MAX_SCRAPER_ERRORS) {
        broadcast({ type: 'youtube_error', data: { message: errorMsg } });
        stopAllYouTubeConnections();
      }
    });

    liveChat.on('end', (reason) => {
      broadcast({ type: 'youtube_disconnected', data: { reason } });
    });

    const started = await liveChat.start();
    if (started) {
      clearOldYouTubeData(videoId);
      state.currentVideoId = videoId;
      broadcast({ type: 'youtube_connected', data: { success: true, videoId, method: 'scraper' } });
    } else {
      broadcast({ type: 'youtube_error', data: { message: 'Failed to start scraper' } });
    }
  } catch (err) {
    broadcast({ type: 'youtube_error', data: { message: err.message } });
  }
}

// Handle incoming messages
function handleMessage(data) {
  switch (data.type) {
    case 'connect_youtube':
      connectWithScraper(data.videoId);
      break;

    case 'disconnect_youtube':
      stopAllYouTubeConnections();
      state.currentVideoId = null;
      broadcast({ type: 'youtube_disconnected', data: { reason: 'User disconnected' } });
      break;

    case 'add_comment':
      const comment = { ...data.data, id: data.data.id || `cm_${Date.now()}` };
      const commentExists = state.comments.some(c => c.id === comment.id);
      if (!commentExists) {
        state.comments.push(comment);
        broadcast({ type: 'comment_added', data: comment });
      }
      break;

    case 'add_superchat':
      const superchat = { ...data.data, id: data.data.id || `sc_${Date.now()}` };
      const superchatExists = state.superchats.some(s => s.id === superchat.id);
      if (!superchatExists) {
        state.superchats.push(superchat);
        broadcast({ type: 'superchat_added', data: superchat });
      }
      break;

    case 'pin_comment':
    case 'pin_superchat':
      if (state.pinnedItem?.id === data.data.id) {
        state.pinnedItem = null;
        broadcast({ type: 'unpin' });
      } else {
        state.pinnedItem = {
          ...data.data,
          type: data.type === 'pin_superchat' ? 'superchat' : 'comment'
        };
        broadcast({ type: 'pin', data: state.pinnedItem });
      }
      break;

    case 'unpin':
      state.pinnedItem = null;
      broadcast({ type: 'unpin' });
      break;
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  clients.add(ws);

  // Send initial state
  ws.send(JSON.stringify({
    type: 'init',
    state: {
      comments: state.comments,
      superchats: state.superchats,
      pinnedItem: state.pinnedItem,
      currentVideoId: state.currentVideoId,
    }
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(data);
    } catch (err) {
      console.error('Invalid message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// API endpoints
app.use(express.json());

app.post('/api/add-sample-data', (req, res) => {
  const sampleComments = [
    { username: '@FootballFan123', message: 'Great stream!', isTest: true },
    { username: '@RedDevil_UK', message: 'COME ON UNITED!', isTest: true },
  ];

  const sampleSuperchats = [
    { username: '@SuperFan', message: 'Love the content!', amount: '£5.00', isTest: true },
    { username: '@BigSupporter', message: 'Keep it up!', amount: '£20.00', isTest: true },
  ];

  sampleComments.forEach(c => handleMessage({ type: 'add_comment', data: c }));
  sampleSuperchats.forEach(s => handleMessage({ type: 'add_superchat', data: s }));

  res.json({ success: true, added: sampleComments.length + sampleSuperchats.length });
});

app.post('/api/clear-test-batch', (req, res) => {
  const commentsRemoved = state.comments.filter(c => c.isTest).length;
  const superchatsRemoved = state.superchats.filter(s => s.isTest).length;

  state.comments = state.comments.filter(c => !c.isTest);
  state.superchats = state.superchats.filter(s => !s.isTest);

  if (state.pinnedItem?.isTest) {
    state.pinnedItem = null;
    broadcast({ type: 'unpin' });
  }

  broadcast({ type: 'test_batch_cleared', data: { commentsRemoved, superchatsRemoved } });
  res.json({ success: true, commentsRemoved, superchatsRemoved });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

---

## Frontend Implementation

### WebSocket Configuration

```javascript
/**
 * lib/ws-config.js
 *
 * WebSocket URL configuration for different environments
 */

export function getWebSocketUrl() {
  if (typeof window !== 'undefined') {
    // Check for environment variable
    const envUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (envUrl) return envUrl;

    // Auto-detect from current host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    if (!host.startsWith('localhost:')) {
      return `${protocol}//${host}/ws`;
    }
  }

  return 'ws://localhost:3000/ws';
}
```

### Chat Queue Component

```jsx
/**
 * pages/widgets/chat-popout.js
 *
 * Queue management popout window
 */

import { useEffect, useState } from 'react';

export default function ChatPopout() {
  const [comments, setComments] = useState([]);
  const [superchats, setSuperchats] = useState([]);
  const [pinnedId, setPinnedId] = useState(null);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [ws, setWs] = useState(null);

  // Filter to current stream
  const filteredComments = comments.filter(c => {
    if (c.isTest) return true;
    if (!currentVideoId) return !c.videoId;
    if (!c.videoId) return true;
    return c.videoId === currentVideoId;
  });

  const filteredSuperchats = superchats.filter(s => {
    if (s.isTest) return true;
    if (!currentVideoId) return !s.videoId;
    if (!s.videoId) return true;
    return s.videoId === currentVideoId;
  });

  useEffect(() => {
    let reconnectTimeout;
    let websocket = null;

    const connect = () => {
      try {
        websocket = new WebSocket(getWebSocketUrl());

        websocket.onopen = () => {
          setWs(websocket);
          websocket.send(JSON.stringify({
            type: 'identify_widget',
            widgetType: 'chat-popout'
          }));
        };

        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'init') {
              setComments(data.state.comments || []);
              setSuperchats(data.state.superchats || []);
              setPinnedId(data.state.pinnedItem?.id || null);
              setCurrentVideoId(data.state.currentVideoId || null);
            }

            if (data.type === 'comment_added') {
              setComments(prev => {
                const exists = prev.some(c => c.id === data.data.id);
                if (!exists) return [...prev, data.data];
                return prev;
              });
            }

            if (data.type === 'superchat_added') {
              setSuperchats(prev => {
                const exists = prev.some(s => s.id === data.data.id);
                if (!exists) return [...prev, data.data];
                return prev;
              });
            }

            if (data.type === 'pin' || data.type === 'pin_comment' || data.type === 'pin_superchat') {
              setPinnedId(data.data?.id || null);
            }

            if (data.type === 'unpin') {
              setPinnedId(null);
            }

            if (data.type === 'stream_changed') {
              setCurrentVideoId(data.data.newVideoId || null);
              if (data.data?.comments) setComments(data.data.comments);
              if (data.data?.superchats) setSuperchats(data.data.superchats);
            }

            if (data.type === 'test_batch_cleared') {
              setComments(prev => prev.filter(c => !c.isTest));
              setSuperchats(prev => prev.filter(s => !s.isTest));
            }
          } catch (e) {
            console.error('Error parsing message:', e);
          }
        };

        websocket.onclose = () => {
          setWs(null);
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (websocket) {
        websocket.onclose = null;
        websocket.close();
      }
    };
  }, []);

  const togglePin = (item) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (pinnedId === item.id) {
      ws.send(JSON.stringify({ type: 'unpin' }));
      setPinnedId(null);
    } else {
      ws.send(JSON.stringify({
        type: item.amount ? 'pin_superchat' : 'pin_comment',
        data: item
      }));
      setPinnedId(item.id);
    }
  };

  return (
    <div className="chat-popout">
      <div className="superchats-column">
        <h2>Superchats ({filteredSuperchats.length})</h2>
        {filteredSuperchats.slice().reverse().map(item => (
          <div
            key={item.id}
            className={`queue-card ${pinnedId === item.id ? 'pinned' : ''}`}
            onClick={() => togglePin(item)}
          >
            <div className="avatar">{item.username[0]}</div>
            <div className="content">
              <div className="username">{item.username}</div>
              <div className="amount">{item.amount}</div>
              <div className="message">{item.message}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="comments-column">
        <h2>Live Chat ({filteredComments.length})</h2>
        {filteredComments.slice().reverse().map(item => (
          <div
            key={item.id}
            className={`queue-card ${pinnedId === item.id ? 'pinned' : ''}`}
            onClick={() => togglePin(item)}
          >
            <div className="avatar">{item.username[0]}</div>
            <div className="content">
              <div className="username">{item.username}</div>
              <div className="message">{item.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Pinned Comment Display Component

```jsx
/**
 * components/PinnedComment.js
 *
 * Animated on-screen display for pinned comments/superchats
 */

import React, { useEffect, useRef, useState, memo } from 'react';
import gsap from 'gsap';

// Superchat tier system
const getTier = (amount) => {
  if (!amount) return { tier: 'comment', color: '#666666' };
  const num = parseFloat(amount.replace(/[^0-9.]/g, ''));
  if (num >= 100) return { tier: 'red', color: '#dc2626' };
  if (num >= 50) return { tier: 'magenta', color: '#e91e63' };
  if (num >= 20) return { tier: 'orange', color: '#f57c00' };
  if (num >= 10) return { tier: 'yellow', color: '#ffb300' };
  if (num >= 5) return { tier: 'cyan', color: '#00bcd4' };
  return { tier: 'blue', color: '#1e88e5' };
};

const PinnedComment = ({ pinnedItem }) => {
  const containerRef = useRef(null);
  const [displayedPinned, setDisplayedPinned] = useState(null);
  const isAnimatingRef = useRef(false);

  const tier = displayedPinned ? getTier(displayedPinned.amount) : { tier: 'comment', color: '#666666' };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (pinnedItem && !isAnimatingRef.current) {
      // Entrance animation
      isAnimatingRef.current = true;
      setDisplayedPinned(pinnedItem);

      gsap.set(container, { visibility: 'visible', opacity: 1 });
      gsap.fromTo(container,
        { x: 100, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out', onComplete: () => {
          isAnimatingRef.current = false;
        }}
      );
    } else if (!pinnedItem && displayedPinned) {
      // Exit animation
      isAnimatingRef.current = true;
      gsap.to(container, {
        x: 100, opacity: 0, duration: 0.4, ease: 'power2.in',
        onComplete: () => {
          gsap.set(container, { visibility: 'hidden' });
          setDisplayedPinned(null);
          isAnimatingRef.current = false;
        }
      });
    }
  }, [pinnedItem, displayedPinned]);

  return (
    <div
      ref={containerRef}
      className="pinned-container"
      style={{ '--tier-color': tier.color }}
    >
      <div className="pinned-label">
        {displayedPinned?.type === 'superchat' ? 'SUPERCHAT' : 'COMMENT'}
      </div>
      <div className="pinned-card">
        <div className="avatar">
          {displayedPinned?.avatar ? (
            <img src={displayedPinned.avatar} alt="" />
          ) : (
            <span>{(displayedPinned?.username || 'U')[0]}</span>
          )}
        </div>
        <div className="content">
          <div className="header">
            <span className="username">{displayedPinned?.username}</span>
            {displayedPinned?.badge && (
              <span className="badge">{displayedPinned.badge}</span>
            )}
            {displayedPinned?.amount && (
              <span className="amount">{displayedPinned.amount}</span>
            )}
          </div>
          <div className="message">{displayedPinned?.message}</div>
        </div>
      </div>
    </div>
  );
};

export default memo(PinnedComment);
```

---

## Data Structures

### Comment Object

```typescript
interface Comment {
  id: string;                    // Unique identifier (YouTube ID or generated)
  username: string;              // Display name
  message: string;               // Message text
  avatar: string | null;         // Profile picture URL
  badge: 'OWNER' | 'MOD' | 'VERIFIED' | 'MEMBER' | null;
  timestamp: number;             // Unix timestamp (ms)
  videoId: string;               // YouTube video ID
  type: 'comment';               // Message type
  isTest?: boolean;              // Test data flag
  isOwner?: boolean;             // Channel owner flag
  isMod?: boolean;               // Moderator flag
  isMember?: boolean;            // Member flag
}
```

### Superchat Object

```typescript
interface Superchat {
  id: string;                    // Unique identifier
  username: string;              // Display name
  message: string;               // Message text
  amount: string;                // Formatted amount (e.g., "£25.00")
  avatar: string | null;         // Profile picture URL
  badge: 'OWNER' | 'MOD' | 'VERIFIED' | 'MEMBER' | null;
  timestamp: number;             // Unix timestamp (ms)
  videoId: string;               // YouTube video ID
  type: 'superchat';             // Message type
  isTest?: boolean;              // Test data flag
  isOwner?: boolean;             // Channel owner flag
  isMod?: boolean;               // Moderator flag
  isMember?: boolean;            // Member flag
}
```

### Scraped Chat Item (Raw from YouTube)

```typescript
interface ChatItem {
  id: string;
  author: {
    name: string;
    thumbnail: { url: string; alt: string } | null;
    channelId: string;
    badge: { thumbnail: { url: string; alt: string }; label: string } | null;
  };
  message: Array<{ text?: string; url?: string; alt?: string; emojiText?: string }>;
  isOwner: boolean;
  isModerator: boolean;
  isVerified: boolean;
  isMembership: boolean;
  timestamp: Date;
  superchat?: {
    amount: string;
    color: string;
    sticker?: { url: string; alt: string };
  };
}
```

---

## WebSocket Protocol

### Client → Server Messages

| Type | Payload | Description |
|------|---------|-------------|
| `connect_youtube` | `{ videoId: string }` | Connect to YouTube stream |
| `disconnect_youtube` | `{}` | Disconnect from stream |
| `pin_comment` | `{ data: Comment }` | Pin a comment |
| `pin_superchat` | `{ data: Superchat }` | Pin a superchat |
| `unpin` | `{}` | Unpin current item |
| `identify_widget` | `{ widgetType: string }` | Identify client type |

### Server → Client Messages

| Type | Payload | Description |
|------|---------|-------------|
| `init` | `{ state: State }` | Initial state sync |
| `comment_added` | `{ data: Comment }` | New comment received |
| `superchat_added` | `{ data: Superchat }` | New superchat received |
| `pin` | `{ data: PinnedItem }` | Item pinned |
| `unpin` | `{}` | Item unpinned |
| `youtube_connected` | `{ success: boolean, videoId: string, method: string }` | Connection established |
| `youtube_disconnected` | `{ reason: string }` | Connection closed |
| `youtube_error` | `{ message: string }` | Connection error |
| `stream_changed` | `{ oldVideoId, newVideoId, comments, superchats }` | Stream switched |
| `test_batch_cleared` | `{ commentsRemoved, superchatsRemoved }` | Test data cleared |

---

## API Endpoints

### POST `/api/add-sample-data`

Adds sample test data for testing.

**Response:**
```json
{
  "success": true,
  "added": 9
}
```

### POST `/api/clear-test-batch`

Removes all test data.

**Response:**
```json
{
  "success": true,
  "commentsRemoved": 5,
  "superchatsRemoved": 4
}
```

---

## Error Handling

### Scraper Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| `Video not found (404)` | Invalid video ID | Stop scraper, notify user |
| `Access forbidden (403)` | Private/members-only | Stop scraper, suggest API mode |
| `Rate limited (429)` | Too many requests | Retry with backoff |
| `Stream ended/replay` | Stream not live | Stop scraper, notify user |
| `Chat disabled` | Chat turned off | Stop scraper, notify user |

### Recovery Strategy

```javascript
const MAX_SCRAPER_ERRORS = 10;
let scraperErrorCount = 0;

liveChat.on('error', (err) => {
  scraperErrorCount++;

  const isCriticalError =
    err.message.includes('not found') ||
    err.message.includes('ended') ||
    err.message.includes('forbidden');

  if (isCriticalError || scraperErrorCount >= MAX_SCRAPER_ERRORS) {
    stopAllYouTubeConnections();
    broadcast({ type: 'youtube_error', data: { message: err.message } });
  }
});

liveChat.on('chat', () => {
  scraperErrorCount = 0; // Reset on success
});
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NEXT_PUBLIC_WS_URL` | Auto-detect | WebSocket URL override |

### Scraper Options

```javascript
const scraper = new YouTubeChatScraper({
  liveId: 'VIDEO_ID',        // YouTube video ID
  channelId: 'CHANNEL_ID',   // Channel ID (alternative)
  handle: '@username',        // Channel handle (alternative)
  interval: 2000,            // Poll interval (ms)
});
```

### Constants

```javascript
const MAX_SCRAPER_ERRORS = 10;      // Max consecutive errors
const POLL_INTERVAL = 2000;          // Scraper poll interval (ms)
const MAX_SEEN_MESSAGES = 5000;      // Deduplication set limit
const RECONNECT_DELAY = 3000;        // Client reconnect delay (ms)
```

---

## Deployment

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install express ws axios
```

### Start Server

```bash
# Development
node server.js

# Production
NODE_ENV=production node server.js
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Environment Setup

```bash
# .env
PORT=3000
NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws
```

---

## Superchat Tier System

| Amount Range | Tier | Color |
|--------------|------|-------|
| £0-5 | Blue | `#1e88e5` |
| £5-10 | Cyan | `#00bcd4` |
| £10-20 | Yellow | `#ffb300` |
| £20-50 | Orange | `#f57c00` |
| £50-100 | Magenta | `#e91e63` |
| £100+ | Red | `#dc2626` |

---

## Security Considerations

1. **Rate Limiting**: YouTube may block IPs that make too many requests
2. **User Agent**: Must use browser-like headers to avoid detection
3. **No API Key Required**: Scraper doesn't need YouTube API credentials
4. **Members-Only Streams**: Require YouTube Data API v3 with OAuth

---

## Limitations

1. Only works with public live streams (scraper mode)
2. Members-only streams require YouTube API with OAuth
3. YouTube may change their internal API structure
4. Rate limiting can occur on high-traffic streams

---

## License

MIT License - Free to use and modify for any project.
