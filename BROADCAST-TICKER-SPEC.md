# Broadcast Ticker Specification

A complete specification for building a standalone broadcast-style ticker component with scrolling text, parallax transitions, progress scanner, and real-time WebSocket updates.

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Architecture](#architecture)
4. [Component Specifications](#component-specifications)
5. [Animation System](#animation-system)
6. [Data Structures](#data-structures)
7. [WebSocket Integration](#websocket-integration)
8. [Styling System](#styling-system)
9. [Configuration](#configuration)
10. [Usage Examples](#usage-examples)

---

## Overview

The broadcast ticker system provides two primary ticker implementations:

1. **Standard Ticker** - Continuous horizontal scrolling with segment support
2. **Parallax Ticker** - Advanced news ticker with title/content pairs and staggered transitions

Both feature:
- Smooth GSAP-powered animations at 60fps
- Synchronized scanner line progress indicator
- Real-time WebSocket updates
- Broadcast-optimized styling (white background, dark text)
- Pinned segment highlighting
- Animated text effects (typewriter, wave, fade)

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| GSAP | 3.14.1 | Animation engine |
| Next.js | 14.x | React framework (optional) |
| WebSocket | Native | Real-time updates |
| CSS-in-JS | styled-jsx | Scoped styling |

### Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "gsap": "^3.14.1",
    "next": "^14.0.0"
  }
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Control Panel                             │
│   (tickerItems, tickerSpeed, tickerSegments, etc.)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      WebSocket Server                        │
│         Delta Broadcaster (targeted subscriptions)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Ticker Widget Page                        │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  LowerThird Container                               │   │
│   │  ┌───────────────────────────────────────────────┐  │   │
│   │  │  ParallaxTicker / Ticker                      │  │   │
│   │  │  ┌─────────────────────────────────────────┐  │  │   │
│   │  │  │  AnimatedText (per segment)             │  │  │   │
│   │  │  └─────────────────────────────────────────┘  │  │   │
│   │  │  ┌─────────────────────────────────────────┐  │  │   │
│   │  │  │  ScannerLine (progress indicator)       │  │  │   │
│   │  │  └─────────────────────────────────────────┘  │  │   │
│   │  └───────────────────────────────────────────────┘  │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### 1. Ticker Component (Standard Scrolling)

**Purpose:** Continuous horizontal scrolling ticker with segment support and pinned highlighting.

```jsx
/**
 * components/Ticker.js
 *
 * Standard scrolling ticker with GSAP-powered infinite loop
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import AnimatedText from './ui/AnimatedText';
import ScannerLine from './ui/ScannerLine';

/**
 * Normalize segment to object format
 * Supports: string "News" or object { text: "News", animated: true, animation: "typewriter" }
 */
function normalizeSegment(seg) {
  if (typeof seg === 'string') {
    return { text: seg.trim(), animated: false };
  }
  if (typeof seg === 'object' && seg !== null) {
    return {
      text: (seg.text || '').trim(),
      animated: seg.animated || false,
      animation: seg.animation || 'fadeIn'
    };
  }
  return { text: '', animated: false };
}

/**
 * Split ticker text into segments
 * Supports: pipe (|) or bullet (•) delimiters
 */
function splitTickerIntoSegments(text) {
  if (!text || typeof text !== 'string') return [];

  // Prefer pipe-delimited: "A | B | C"
  if (text.includes('|')) {
    return text.split('|').map(s => s.trim()).filter(Boolean);
  }

  // Fallback: bullet-delimited: "A • B • C"
  if (text.includes('•')) {
    return text.split('•').map(s => s.trim()).filter(Boolean);
  }

  // Single segment
  return [text.trim()].filter(Boolean);
}

const Ticker = ({
  text,                    // Legacy text format with delimiters
  speed = 50,              // Pixels per second
  segments = null,         // Array of segment objects/strings
  pinnedIndex = null,      // Index of segment to highlight
  variant = 'classic'      // 'classic' | 'panel' | 'broadcast'
}) => {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [scrollDuration, setScrollDuration] = useState(0);
  const [scannerKey, setScannerKey] = useState(0);

  const isPanel = variant === 'panel';
  const isBroadcast = variant === 'broadcast';

  // Resolve segments from props
  const resolvedSegments = useMemo(() => {
    if (Array.isArray(segments) && segments.length > 0) {
      return segments.map(normalizeSegment).filter(s => s.text);
    }
    return splitTickerIntoSegments(text).map(s => ({ text: s, animated: false }));
  }, [segments, text]);

  // Validate pinned index
  const normalizedPinnedIndex = useMemo(() => {
    if (typeof pinnedIndex !== 'number' || !Number.isFinite(pinnedIndex)) return null;
    if (pinnedIndex < 0 || pinnedIndex >= resolvedSegments.length) return null;
    return pinnedIndex;
  }, [pinnedIndex, resolvedSegments.length]);

  // Memoize segments key for dependency tracking
  const segmentsKey = useMemo(() =>
    resolvedSegments.map(s => s.text).join('|'),
    [resolvedSegments]
  );

  // GSAP animation setup
  useEffect(() => {
    if (!containerRef.current || !textRef.current) return;

    const textWidth = textRef.current.offsetWidth;

    // Kill existing animations
    gsap.killTweensOf(textRef.current);
    gsap.set(textRef.current, { x: 0 });

    // Calculate duration: width / speed = seconds
    const duration = textWidth / speed;

    // Set scanner duration (half cycle in milliseconds)
    const cycleDuration = (duration / 2) * 1000;
    setScrollDuration(cycleDuration);
    setScannerKey(prev => prev + 1);

    // Create infinite loop animation
    const ctx = gsap.context(() => {
      gsap.to(textRef.current, {
        x: -textWidth / 2,  // Move half (content is repeated)
        duration: duration,
        ease: 'none',
        repeat: -1,
        onRepeat: () => {
          gsap.set(textRef.current, { x: 0 });
          setScannerKey(prev => prev + 1);  // Reset scanner
        }
      });
    }, containerRef);

    return () => ctx.revert();
  }, [text, speed, segmentsKey, normalizedPinnedIndex, variant]);

  // Build segment nodes with separators
  const segmentNodes = useMemo(() => {
    const segs = resolvedSegments.length > 0 ? resolvedSegments : [{ text: '', animated: false }];

    return segs.flatMap((seg, idx) => {
      const isPinned = normalizedPinnedIndex === idx;

      const segmentEl = (
        <span
          key={`seg-${idx}`}
          className={`ticker-segment ${isPinned ? 'is-pinned' : ''} ${seg.animated ? 'is-animated' : ''}`}
          data-seg-index={idx}
        >
          {seg.animated ? (
            <AnimatedText
              text={seg.text}
              animation={seg.animation || 'fadeIn'}
              by="character"
              showCursor={seg.animation === 'typewriter'}
            />
          ) : (
            seg.text
          )}
        </span>
      );

      // Add separator after each segment except the last
      if (idx === segs.length - 1) return [segmentEl];
      return [
        segmentEl,
        <span key={`sep-${idx}`} className="ticker-separator" aria-hidden="true">•</span>
      ];
    });
  }, [resolvedSegments, normalizedPinnedIndex]);

  // Repeat segments 3x for seamless scrolling
  const repeatedNodes = useMemo(() => {
    const repeats = 3;
    const nodes = [];
    for (let i = 0; i < repeats; i++) {
      nodes.push(
        <span key={`rep-${i}`} className="ticker-repeat" aria-hidden={i > 0}>
          {segmentNodes}
          <span className="ticker-separator ticker-separator--gap" aria-hidden="true">•</span>
        </span>
      );
    }
    return nodes;
  }, [segmentNodes]);

  return (
    <div className="ticker-outer-wrapper">
      <div className="ticker-container" ref={containerRef}>
        <div ref={textRef} className="ticker-inner">
          <span className={`ticker-text ${isPanel ? 'ticker-text--panel' : ''} ${isBroadcast ? 'ticker-text--broadcast' : ''}`}>
            {repeatedNodes}
          </span>
        </div>
      </div>

      {/* Scanner line synced with scroll cycle */}
      {scrollDuration > 0 && (
        <div className="scanner-wrapper">
          <ScannerLine
            key={scannerKey}
            duration={scrollDuration}
            isActive={true}
            height={3}
            color={isBroadcast ? 'rgba(220, 38, 38, 0.9)' : 'rgba(255, 255, 255, 0.8)'}
            trackColor={isBroadcast ? 'rgba(220, 38, 38, 0.15)' : 'rgba(255, 255, 255, 0.15)'}
          />
        </div>
      )}

      <style jsx>{`
        .ticker-outer-wrapper {
          width: 100%;
          height: 100%;
          position: relative;
        }

        .ticker-container {
          overflow: hidden;
          white-space: nowrap;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          position: relative;
        }

        .ticker-inner {
          display: inline-block;
          padding-left: 100%;
        }

        .ticker-text {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 42px;
          text-transform: uppercase;
          color: #111;
          letter-spacing: 1.5px;
          display: inline-flex;
          align-items: center;
          gap: 14px;
        }

        /* Broadcast variant - white background, dark text */
        .ticker-text--broadcast {
          color: #1a1a1a;
          font-size: 36px;
          letter-spacing: 1px;
          text-shadow: none;
        }

        .ticker-text--broadcast .ticker-segment {
          background: transparent;
          border: none;
          padding: 2px 8px;
        }

        .ticker-text--broadcast .ticker-separator {
          color: #999;
          opacity: 0.6;
        }

        /* Panel variant - dark background, light text */
        .ticker-text--panel {
          color: rgba(255, 255, 255, 0.92);
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.35);
        }

        .ticker-repeat {
          display: inline-flex;
          align-items: center;
          gap: 14px;
        }

        .ticker-separator {
          opacity: 0.55;
        }

        .ticker-separator--gap {
          opacity: 0.35;
          margin: 0 10px;
        }

        .ticker-segment {
          position: relative;
          display: inline-flex;
          align-items: center;
          padding: 2px 10px 3px;
          border-radius: 999px;
          transition: background 220ms ease, box-shadow 220ms ease, transform 220ms ease;
        }

        /* Pinned segment highlight */
        .ticker-segment.is-pinned {
          transform: translateY(-1px) scale(1.02);
          background: linear-gradient(180deg, rgba(220,38,38,1) 0%, rgba(185,28,28,1) 100%);
          border: 1px solid rgba(127,29,29,0.65);
          color: #fff;
          box-shadow: 0 0 0 1px rgba(220,38,38,0.18), 0 0 16px rgba(220,38,38,0.35);
          text-shadow: 0 1px 0 rgba(0,0,0,0.35);
          animation: pinnedPulse 1.4s ease-in-out infinite;
        }

        @keyframes pinnedPulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(220,38,38,0.20), 0 0 18px rgba(220,38,38,0.28); }
          50% { box-shadow: 0 0 0 1px rgba(220,38,38,0.32), 0 0 26px rgba(220,38,38,0.45); }
        }

        .scanner-wrapper {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 4px;
          z-index: 100;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
};

export default Ticker;
```

### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `text` | `string` | `''` | Legacy format with pipe/bullet delimiters |
| `speed` | `number` | `50` | Scroll speed in pixels per second |
| `segments` | `array` | `null` | Array of segment objects or strings |
| `pinnedIndex` | `number` | `null` | Index of segment to highlight (0-based) |
| `variant` | `string` | `'classic'` | Visual style: `'classic'` \| `'panel'` \| `'broadcast'` |

---

### 2. ParallaxTicker Component (Advanced)

**Purpose:** Sophisticated news ticker with title/content pairs and staggered parallax transitions.

```jsx
/**
 * components/ParallaxTicker.js
 *
 * Advanced ticker with parallax transitions between items
 */

import { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import gsap from 'gsap';

const ParallaxTicker = ({
  items = [],          // Array of { title: string, content: string }
  speed = 100,         // Scroll speed in pixels per second
  variant = 'classic'  // 'classic' | 'panel' | 'broadcast'
}) => {
  const containerRef = useRef(null);
  const currentTitleRef = useRef(null);
  const currentSeparatorRef = useRef(null);
  const currentContentMaskRef = useRef(null);
  const contentRef = useRef(null);
  const nextTitleRef = useRef(null);
  const nextSeparatorRef = useRef(null);
  const nextContentMaskRef = useRef(null);
  const nextContentRef = useRef(null);
  const animationRef = useRef(null);

  // Scanner refs for direct DOM manipulation (bypasses React re-renders)
  const scannerFillRef = useRef(null);
  const scannerHeadRef = useRef(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const isPanel = variant === 'panel';
  const isBroadcast = variant === 'broadcast';

  // Current and next items
  const currentItem = items[currentIndex] || { title: 'NEWS', content: '' };
  const nextIndex = items.length > 0 ? (currentIndex + 1) % items.length : 0;
  const nextItem = items[nextIndex] || { title: 'NEWS', content: '' };

  // Start content scroll animation
  const startContentScroll = useCallback(() => {
    if (!contentRef.current || !currentContentMaskRef.current || items.length === 0) return;

    if (animationRef.current) {
      animationRef.current.kill();
    }

    const contentWidth = contentRef.current.offsetWidth;
    const contentMaskWidth = currentContentMaskRef.current.offsetWidth;

    // Content starts at right edge of mask
    const startX = contentMaskWidth;
    const scrollDistance = startX + contentWidth;
    const duration = scrollDistance / speed;

    // Reset scanner
    if (scannerFillRef.current) scannerFillRef.current.style.width = '0%';
    if (scannerHeadRef.current) scannerHeadRef.current.style.left = '0%';

    gsap.set(contentRef.current, { x: startX });

    // Animate content scrolling left
    animationRef.current = gsap.to(contentRef.current, {
      x: -contentWidth,
      duration: duration,
      ease: 'none',
      onUpdate: function() {
        // Drive scanner directly from GSAP progress
        const progress = this.progress() * 100;
        if (scannerFillRef.current) scannerFillRef.current.style.width = `${progress}%`;
        if (scannerHeadRef.current) scannerHeadRef.current.style.left = `${progress}%`;
      },
      onComplete: () => {
        // Reset scanner
        if (scannerFillRef.current) scannerFillRef.current.style.width = '0%';
        if (scannerHeadRef.current) scannerHeadRef.current.style.left = '0%';

        if (items.length > 1) {
          transitionToNext();
        } else {
          startContentScroll();  // Single item - restart
        }
      }
    });
  }, [items, speed]);

  // Transition to next item with parallax effect
  const transitionToNext = useCallback(() => {
    if (isTransitioning) return;
    if (!currentTitleRef.current || !nextTitleRef.current) return;

    setIsTransitioning(true);

    const tl = gsap.timeline({
      onComplete: () => {
        setCurrentIndex(prev => (prev + 1) % items.length);
        setIsTransitioning(false);
      }
    });

    // Phase 1: Current title exits (slide left with blur)
    tl.to([currentTitleRef.current, currentSeparatorRef.current], {
      x: -80,
      opacity: 0,
      scale: 0.9,
      filter: 'blur(4px)',
      duration: 0.35,
      ease: 'power2.in',
      stagger: 0.05
    });

    // Fade out current content mask
    tl.to(currentContentMaskRef.current, {
      opacity: 0,
      x: -40,
      duration: 0.25,
      ease: 'power2.in'
    }, '-=0.3');

    // Phase 2: New title enters (slide from right)
    tl.fromTo([nextTitleRef.current, nextSeparatorRef.current],
      { x: 60, opacity: 0, scale: 0.9, filter: 'blur(4px)' },
      { x: 0, opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.4, ease: 'power2.out', stagger: 0.08 },
      '-=0.15'
    );

    // Phase 3: New content mask fades in
    tl.fromTo(nextContentMaskRef.current,
      { opacity: 0, x: 30 },
      { opacity: 1, x: 0, duration: 0.35, ease: 'power2.out' },
      '-=0.2'
    );
  }, [isTransitioning, items.length]);

  // Initial setup
  useLayoutEffect(() => {
    if (!contentRef.current || !currentContentMaskRef.current) return;

    const contentMaskWidth = currentContentMaskRef.current.offsetWidth || 800;
    gsap.set(contentRef.current, { x: contentMaskWidth });

    // Hide next item elements
    if (nextTitleRef.current) {
      gsap.set(nextTitleRef.current, { x: 60, opacity: 0, scale: 0.9, filter: 'blur(4px)' });
    }
    if (nextSeparatorRef.current) {
      gsap.set(nextSeparatorRef.current, { x: 60, opacity: 0, scale: 0.9, filter: 'blur(4px)' });
    }
    if (nextContentMaskRef.current) {
      gsap.set(nextContentMaskRef.current, { opacity: 0, x: 30 });
    }

    setIsReady(true);
  }, []);

  // Reset and start animation when currentIndex changes
  useEffect(() => {
    if (!isReady || isTransitioning) return;

    // Reset current elements
    if (currentTitleRef.current) {
      gsap.set(currentTitleRef.current, { x: 0, opacity: 1, scale: 1, filter: 'blur(0px)' });
    }
    if (currentSeparatorRef.current) {
      gsap.set(currentSeparatorRef.current, { x: 0, opacity: 1, scale: 1, filter: 'blur(0px)' });
    }
    if (currentContentMaskRef.current) {
      gsap.set(currentContentMaskRef.current, { x: 0, opacity: 1 });
    }

    // Reset next elements (hidden)
    if (nextTitleRef.current) {
      gsap.set(nextTitleRef.current, { x: 60, opacity: 0, scale: 0.9, filter: 'blur(4px)' });
    }
    if (nextSeparatorRef.current) {
      gsap.set(nextSeparatorRef.current, { x: 60, opacity: 0, scale: 0.9, filter: 'blur(4px)' });
    }
    if (nextContentMaskRef.current) {
      gsap.set(nextContentMaskRef.current, { opacity: 0, x: 30 });
    }

    startContentScroll();

    return () => {
      if (animationRef.current) {
        animationRef.current.kill();
      }
    };
  }, [currentIndex, isTransitioning, isReady, startContentScroll]);

  // Handle items change
  useEffect(() => {
    setCurrentIndex(0);
  }, [items.length]);

  if (!items || items.length === 0) {
    return null;
  }

  // Scanner colors based on variant
  const scannerColor = isBroadcast ? 'rgba(220, 38, 38, 0.9)' :
                       isPanel ? 'rgba(255, 255, 255, 0.8)' :
                       'rgba(220, 38, 38, 0.9)';
  const scannerTrackColor = isBroadcast ? 'rgba(220, 38, 38, 0.15)' :
                            isPanel ? 'rgba(255, 255, 255, 0.15)' :
                            'rgba(220, 38, 38, 0.15)';

  return (
    <div className="parallax-ticker-outer">
      <div className="parallax-ticker-container" ref={containerRef}>
        {/* Current Item */}
        <div className="ticker-item ticker-item--current">
          <div className={`ticker-title ${isBroadcast ? 'ticker-title--broadcast' : ''}`} ref={currentTitleRef}>
            <span className="title-text">{currentItem.title}</span>
          </div>
          <div className={`ticker-separator ${isBroadcast ? 'ticker-separator--broadcast' : ''}`} ref={currentSeparatorRef}>
            ::
          </div>
          <div className="ticker-content-mask" ref={currentContentMaskRef}>
            <div className={`ticker-content ${isBroadcast ? 'ticker-content--broadcast' : ''}`} ref={contentRef}>
              {currentItem.content}
            </div>
          </div>
        </div>

        {/* Next Item (for transition overlay) */}
        {items.length > 1 && (
          <div className="ticker-item ticker-item--next">
            <div className={`ticker-title ${isBroadcast ? 'ticker-title--broadcast' : ''}`} ref={nextTitleRef}>
              <span className="title-text">{nextItem.title}</span>
            </div>
            <div className={`ticker-separator ${isBroadcast ? 'ticker-separator--broadcast' : ''}`} ref={nextSeparatorRef}>
              ::
            </div>
            <div className="ticker-content-mask" ref={nextContentMaskRef}>
              <div className={`ticker-content ${isBroadcast ? 'ticker-content--broadcast' : ''}`} ref={nextContentRef}>
                {nextItem.content}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scanner line - progress driven by GSAP */}
      <div className="scanner-container" style={{ background: scannerTrackColor }}>
        <div ref={scannerFillRef} className="scanner-fill" style={{ background: scannerColor }} />
        <div ref={scannerHeadRef} className="scanner-head" style={{
          background: scannerColor,
          boxShadow: `0 0 8px ${scannerColor}, 0 0 16px ${scannerColor}`
        }} />
      </div>

      <style jsx>{`
        .parallax-ticker-outer {
          width: 100%;
          height: 100%;
          position: relative;
        }

        .parallax-ticker-container {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          display: flex;
          align-items: center;
        }

        .ticker-item {
          position: absolute;
          left: 0;
          right: 0;
          display: flex;
          align-items: center;
          height: 100%;
        }

        .ticker-item--next {
          pointer-events: none;
        }

        /* Title Badge */
        .ticker-title {
          background: linear-gradient(180deg, #dc2626 0%, #b91c1c 100%);
          padding: 8px 24px;
          border-radius: 4px;
          flex-shrink: 0;
          box-shadow: 0 2px 10px rgba(220, 38, 38, 0.35),
                      inset 0 1px 0 rgba(255, 255, 255, 0.15);
          margin-left: 16px;
          will-change: transform, opacity, filter;
          transform-origin: left center;
        }

        .ticker-title .title-text {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 26px;
          color: white;
          text-transform: uppercase;
          letter-spacing: 2px;
          white-space: nowrap;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }

        .ticker-title--broadcast {
          background: linear-gradient(180deg, #e63232 0%, #c92a2a 100%);
          padding: 6px 20px;
          border-radius: 3px;
        }

        .ticker-title--broadcast .title-text {
          font-size: 22px;
          letter-spacing: 1.5px;
        }

        /* Separator */
        .ticker-separator {
          font-family: 'Oswald', sans-serif;
          font-size: 36px;
          font-weight: 300;
          color: rgba(0, 0, 0, 0.25);
          margin: 0 20px;
          flex-shrink: 0;
          will-change: transform, opacity, filter;
        }

        .ticker-separator--broadcast {
          font-size: 32px;
          color: rgba(0, 0, 0, 0.2);
          margin: 0 16px;
        }

        /* Content Mask - clips and fades edges */
        .ticker-content-mask {
          flex: 1;
          overflow: hidden;
          height: 100%;
          display: flex;
          align-items: center;
          position: relative;
          will-change: transform, opacity;
          mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 5%,
            black 95%,
            transparent 100%
          );
          -webkit-mask-image: linear-gradient(
            to right,
            transparent 0%,
            black 5%,
            black 95%,
            transparent 100%
          );
        }

        /* Content text */
        .ticker-content {
          font-family: 'Oswald', sans-serif;
          font-weight: 700;
          font-size: 38px;
          color: #1a1a1a;
          text-transform: uppercase;
          letter-spacing: 1px;
          white-space: nowrap;
          will-change: transform;
          padding-right: 50px;
          transform: translateX(100%);
        }

        .ticker-content--broadcast {
          font-size: 34px;
          letter-spacing: 0.5px;
        }

        /* Scanner */
        .scanner-container {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 3px;
          z-index: 50;
          pointer-events: none;
        }

        .scanner-fill {
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          width: 0%;
          will-change: width;
        }

        .scanner-head {
          position: absolute;
          top: 50%;
          left: 0%;
          transform: translate(-50%, -50%);
          width: 16px;
          height: 6px;
          border-radius: 3px;
          opacity: 0.95;
          will-change: left;
        }
      `}</style>
    </div>
  );
};

export default ParallaxTicker;
```

### Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `array` | `[]` | Array of `{ title: string, content: string }` |
| `speed` | `number` | `100` | Scroll speed in pixels per second |
| `variant` | `string` | `'classic'` | Visual style: `'classic'` \| `'panel'` \| `'broadcast'` |

---

### 3. ScannerLine Component

**Purpose:** Animated progress indicator that sweeps across the ticker container.

```jsx
/**
 * components/ui/ScannerLine.js
 *
 * Progress indicator using requestAnimationFrame for 60fps
 */

import { useEffect, useRef, useState } from 'react';

const ScannerLine = ({
  duration = 5000,      // Duration in milliseconds
  isActive = true,      // Whether scanner should run
  color = 'rgba(255, 255, 255, 0.9)',
  trackColor = 'rgba(0, 0, 0, 0.1)',
  height = 2,           // Height in pixels
  onComplete,           // Callback when scan completes
  className = ''
}) => {
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef(null);
  const animationRef = useRef(null);
  const durationRef = useRef(duration);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    if (!isActive) {
      setProgress(0);
      startTimeRef.current = null;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    if (!startTimeRef.current) {
      startTimeRef.current = performance.now();
    }

    const animate = (currentTime) => {
      if (!startTimeRef.current) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const newProgress = Math.min((elapsed / durationRef.current) * 100, 100);

      setProgress(newProgress);

      if (newProgress >= 100) {
        if (onComplete) onComplete();
        startTimeRef.current = currentTime;  // Reset for next cycle
        setProgress(0);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, onComplete]);

  if (!isActive) return null;

  return (
    <div className={`scanner-line-container ${className}`}>
      <div className="scanner-track" />
      <div className="scanner-progress" style={{ width: `${progress}%` }} />
      <div className="scanner-head" style={{ left: `${progress}%` }} />

      <style jsx>{`
        .scanner-line-container {
          position: relative;
          width: 100%;
          height: ${height}px;
          overflow: visible;
          z-index: 100;
        }

        .scanner-track {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: ${trackColor};
        }

        .scanner-progress {
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          background: ${color};
          will-change: width;
        }

        .scanner-head {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 16px;
          height: ${height * 2}px;
          background: ${color};
          border-radius: ${height}px;
          box-shadow: 0 0 8px ${color}, 0 0 16px ${color};
          opacity: 0.95;
          will-change: left;
        }
      `}</style>
    </div>
  );
};

export default ScannerLine;
```

---

### 4. AnimatedText Component

**Purpose:** Character/word-level text animations for ticker segments.

```jsx
/**
 * components/ui/AnimatedText.js
 *
 * GSAP-powered text animation with multiple presets
 */

import React, { useEffect, useRef, useMemo } from 'react';
import gsap from 'gsap';

const ANIMATION_PRESETS = {
  fadeIn: {
    from: { opacity: 0 },
    to: { opacity: 1 },
    stagger: 0.03,
    ease: 'power2.out'
  },
  typewriter: {
    from: { opacity: 0, visibility: 'hidden' },
    to: { opacity: 1, visibility: 'visible' },
    stagger: 0.05,
    ease: 'none'
  },
  wave: {
    from: { y: 15, opacity: 0 },
    to: { y: 0, opacity: 1 },
    stagger: 0.025,
    ease: 'back.out(1.7)'
  },
  slideUp: {
    from: { y: '100%', opacity: 0 },
    to: { y: 0, opacity: 1 },
    stagger: 0.02,
    ease: 'power2.out'
  },
  highlight: {
    from: { opacity: 0, textShadow: '0 0 0 transparent' },
    to: { opacity: 1 },
    stagger: 0.015,
    ease: 'power2.out',
    glowAfter: true
  }
};

const AnimatedText = ({
  text,
  animation = 'fadeIn',
  duration = 0.5,
  stagger,
  by = 'character',      // 'character' | 'word'
  ease,
  className = '',
  style = {},
  onComplete,
  play = true,
  showCursor
}) => {
  const containerRef = useRef(null);
  const timelineRef = useRef(null);
  const cursorRef = useRef(null);

  const preset = ANIMATION_PRESETS[animation] || ANIMATION_PRESETS.fadeIn;
  const effectiveStagger = stagger ?? preset.stagger;
  const effectiveEase = ease ?? preset.ease;
  const effectiveShowCursor = showCursor ?? (animation === 'typewriter');

  // Split text into spans
  const splitElements = useMemo(() => {
    if (!text) return [];

    if (by === 'word') {
      return text.split(/(\s+)/).map((segment, i) => {
        if (/^\s+$/.test(segment)) {
          return <span key={i} className="animated-text-space">{segment}</span>;
        }
        return (
          <span key={i} className="animated-text-word" style={{ display: 'inline-block' }}>
            {segment}
          </span>
        );
      });
    }

    // Split by character
    return text.split('').map((char, i) => {
      if (char === ' ') {
        return <span key={i} className="animated-text-space">&nbsp;</span>;
      }
      return (
        <span key={i} className="animated-text-char" style={{ display: 'inline-block' }}>
          {char}
        </span>
      );
    });
  }, [text, by]);

  // Run animation
  useEffect(() => {
    if (!containerRef.current || !play) return;

    const container = containerRef.current;
    const chars = container.querySelectorAll('.animated-text-char, .animated-text-word');

    if (chars.length === 0) return;

    if (timelineRef.current) {
      timelineRef.current.kill();
    }

    const tl = gsap.timeline({
      onComplete: () => {
        // Add glow effect after highlight animation
        if (preset.glowAfter) {
          gsap.to(chars, {
            textShadow: '0 0 20px currentColor, 0 0 40px currentColor',
            duration: 0.3,
            stagger: 0.01,
            yoyo: true,
            repeat: 1
          });
        }

        // Hide cursor after typewriter completes
        if (cursorRef.current && animation === 'typewriter') {
          gsap.to(cursorRef.current, { opacity: 0, duration: 0.3, delay: 0.5 });
        }

        if (onComplete) onComplete();
      }
    });

    timelineRef.current = tl;

    gsap.set(chars, preset.from);
    tl.to(chars, {
      ...preset.to,
      duration,
      stagger: effectiveStagger,
      ease: effectiveEase
    });

    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
      }
    };
  }, [text, animation, duration, effectiveStagger, effectiveEase, play, preset, onComplete]);

  return (
    <span ref={containerRef} className={`animated-text ${className}`} style={{ display: 'inline-block', whiteSpace: 'pre-wrap', ...style }}>
      {splitElements}
      {effectiveShowCursor && (
        <span
          ref={cursorRef}
          className="animated-text-cursor"
          style={{
            display: 'inline-block',
            width: '2px',
            height: '1em',
            backgroundColor: 'currentColor',
            marginLeft: '2px',
            verticalAlign: 'text-bottom',
            animation: 'blink 0.7s step-end infinite'
          }}
        />
      )}
    </span>
  );
};

export default AnimatedText;
```

### Animation Presets

| Preset | Effect | Stagger | Use Case |
|--------|--------|---------|----------|
| `fadeIn` | Characters fade in | 0.03s | General text reveal |
| `typewriter` | Characters appear one by one | 0.05s | Breaking news effect |
| `wave` | Characters bounce up | 0.025s | Playful emphasis |
| `slideUp` | Characters slide up from below | 0.02s | Dramatic entrance |
| `highlight` | Fade + glow pulse | 0.015s | Important announcements |

---

## Animation System

### GSAP Timeline Patterns

#### Continuous Scroll (Ticker.js)

```javascript
// Infinite loop with seamless wrap
gsap.to(textRef.current, {
  x: -textWidth / 2,     // Move by half (content repeated 3x)
  duration: textWidth / speed,
  ease: 'none',          // Linear for constant speed
  repeat: -1,            // Infinite
  onRepeat: () => {
    gsap.set(textRef.current, { x: 0 });  // Reset position
    setScannerKey(prev => prev + 1);       // Reset scanner
  }
});
```

#### Parallax Transitions (ParallaxTicker.js)

```javascript
const tl = gsap.timeline({ onComplete: () => setCurrentIndex(prev => (prev + 1) % items.length) });

// Phase 1: Exit (slide left with blur)
tl.to([titleRef, separatorRef], {
  x: -80, opacity: 0, scale: 0.9, filter: 'blur(4px)',
  duration: 0.35, ease: 'power2.in', stagger: 0.05
});

// Phase 2: Enter (slide from right)
tl.fromTo([nextTitleRef, nextSeparatorRef],
  { x: 60, opacity: 0, scale: 0.9, filter: 'blur(4px)' },
  { x: 0, opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.4, ease: 'power2.out' },
  '-=0.15'  // Overlap timing
);
```

#### Direct DOM Scanner Updates

```javascript
// Bypass React re-renders for 60fps performance
animationRef.current = gsap.to(contentRef.current, {
  x: -contentWidth,
  duration: duration,
  ease: 'none',
  onUpdate: function() {
    const progress = this.progress() * 100;
    scannerFillRef.current.style.width = `${progress}%`;
    scannerHeadRef.current.style.left = `${progress}%`;
  }
});
```

---

## Data Structures

### Ticker Segment

```typescript
interface TickerSegment {
  text: string;              // Segment text content
  animated?: boolean;        // Enable text animation
  animation?: AnimationType; // Animation preset name
}

type AnimationType = 'fadeIn' | 'typewriter' | 'wave' | 'slideUp' | 'highlight';
```

### ParallaxTicker Item

```typescript
interface TickerItem {
  title: string;    // Title badge text (e.g., "BREAKING", "UPDATE")
  content: string;  // Scrolling content text
}
```

### Server State

```typescript
interface TickerSettings {
  ticker: string;                    // Legacy pipe-separated text
  tickerItems?: TickerItem[];        // ParallaxTicker items
  tickerSegments?: TickerSegment[];  // Ticker segments
  tickerSpeed: number;               // Pixels per second
  tickerPinnedIndex?: number | null; // Highlighted segment index
  showTicker: boolean;               // Visibility toggle
}
```

---

## WebSocket Integration

### Client-Side Connection

```javascript
/**
 * lib/ws-config.js
 */
export function getWebSocketUrl() {
  if (typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (envUrl) return envUrl;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    if (!host.startsWith('localhost:')) {
      return `${protocol}//${host}/ws`;
    }
  }
  return 'ws://localhost:3000/ws';
}
```

### Message Types

| Type | Direction | Payload | Description |
|------|-----------|---------|-------------|
| `init` | Server → Client | `{ state: { settings } }` | Initial state sync |
| `settings` | Server → Client | `{ data: TickerSettings }` | Settings update |
| `identify_widget` | Client → Server | `{ widgetType: 'ticker' }` | Widget identification |

### Subscription Model

```javascript
// Auto-subscriptions by widget type
const autoSubscriptions = {
  'ticker': [
    'settings.tickerItems',
    'settings.tickerSpeed',
    'settings.showTicker',
    'settings.tickerSegments',
    'settings.tickerPinnedIndex'
  ]
};
```

### Usage in Widget

```jsx
useEffect(() => {
  const ws = new WebSocket(getWebSocketUrl());

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'identify_widget', widgetType: 'ticker' }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'init') {
      setSettings(data.state.settings);
    }

    if (data.type === 'settings') {
      setSettings(prev => ({ ...prev, ...data.data }));
    }
  };

  return () => ws.close();
}, []);
```

---

## Styling System

### Variant Classes

| Variant | Background | Text Color | Scanner Color |
|---------|------------|------------|---------------|
| `classic` | Light | Dark (#111) | Red |
| `panel` | Dark | Light (#fff) | White |
| `broadcast` | White | Dark (#1a1a1a) | Red |

### Broadcast Theme Colors

```css
/* Title Badge */
.ticker-title--broadcast {
  background: linear-gradient(180deg, #e63232 0%, #c92a2a 100%);
}

/* Content */
.ticker-content--broadcast {
  color: #1a1a1a;
  font-size: 34px;
}

/* Separator */
.ticker-separator--broadcast {
  color: rgba(0, 0, 0, 0.2);
}

/* Scanner */
--scanner-color: rgba(220, 38, 38, 0.9);
--scanner-track: rgba(220, 38, 38, 0.15);
```

### Required Fonts

```html
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

---

## Configuration

### Server Settings

```javascript
// server.js state initialization
const state = {
  settings: {
    ticker: 'LATEST NEWS | BREAKING UPDATES | LIVE COVERAGE',
    tickerItems: [
      { title: 'BREAKING', content: 'Manchester United signs new striker in record deal' },
      { title: 'UPDATE', content: 'Premier League announces new broadcasting partnership' },
      { title: 'ANALYSIS', content: 'Top 10 players to watch this season' }
    ],
    tickerSegments: null,
    tickerSpeed: 50,
    tickerPinnedIndex: null,
    showTicker: true
  }
};
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_WS_URL` | Auto-detect | WebSocket URL override |

### Performance Tuning

| Setting | Recommended | Description |
|---------|-------------|-------------|
| `speed` | 50-100 | Pixels per second |
| `repeat` | 3 | Number of content repetitions |
| `stagger` | 0.03-0.05 | Animation stagger delay |

---

## Usage Examples

### Basic Ticker

```jsx
import Ticker from './components/Ticker';

// Simple text with pipe delimiters
<Ticker
  text="BREAKING NEWS | LIVE UPDATES | MATCH HIGHLIGHTS"
  speed={50}
  variant="broadcast"
/>
```

### Ticker with Pinned Segment

```jsx
// Highlight the second segment (index 1)
<Ticker
  segments={[
    'TRANSFER NEWS',
    'BREAKING: NEW SIGNING',  // This will be highlighted
    'MATCH PREVIEW'
  ]}
  pinnedIndex={1}
  speed={60}
  variant="broadcast"
/>
```

### Animated Segments

```jsx
<Ticker
  segments={[
    { text: 'BREAKING NEWS', animated: true, animation: 'typewriter' },
    { text: 'LIVE UPDATES', animated: false },
    { text: 'MATCH HIGHLIGHTS', animated: true, animation: 'wave' }
  ]}
  speed={50}
  variant="broadcast"
/>
```

### ParallaxTicker with Multiple Items

```jsx
import ParallaxTicker from './components/ParallaxTicker';

<ParallaxTicker
  items={[
    { title: 'BREAKING', content: 'Manchester United complete record signing' },
    { title: 'UPDATE', content: 'Premier League announces new schedule' },
    { title: 'ANALYSIS', content: 'Expert predictions for the upcoming match' }
  ]}
  speed={100}
  variant="broadcast"
/>
```

### Full Widget Integration

```jsx
import { useEffect, useState } from 'react';
import Ticker from './components/Ticker';
import ParallaxTicker from './components/ParallaxTicker';
import { getWebSocketUrl } from './lib/ws-config';

export default function TickerWidget() {
  const [settings, setSettings] = useState({
    ticker: 'CONNECTING...',
    tickerItems: null,
    tickerSpeed: 50,
    showTicker: true
  });

  useEffect(() => {
    const ws = new WebSocket(getWebSocketUrl());

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'identify_widget', widgetType: 'ticker' }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'init') {
        setSettings(data.state.settings);
      }
      if (data.type === 'settings') {
        setSettings(prev => ({ ...prev, ...data.data }));
      }
    };

    return () => ws.close();
  }, []);

  if (!settings.showTicker) return null;

  return (
    <div className="ticker-widget">
      {settings.tickerItems?.length > 0 ? (
        <ParallaxTicker
          items={settings.tickerItems}
          speed={settings.tickerSpeed}
          variant="broadcast"
        />
      ) : (
        <Ticker
          text={settings.ticker}
          speed={settings.tickerSpeed}
          segments={settings.tickerSegments}
          pinnedIndex={settings.tickerPinnedIndex}
          variant="broadcast"
        />
      )}
    </div>
  );
}
```

---

## File Structure

```
components/
├── Ticker.js              # Standard scrolling ticker
├── ParallaxTicker.js      # Advanced parallax ticker
└── ui/
    ├── ScannerLine.js     # Progress indicator
    └── AnimatedText.js    # Text animation engine

lib/
└── ws-config.js           # WebSocket configuration

pages/widgets/
└── ticker.js              # Standalone ticker widget page
```

---

## Performance Considerations

1. **Direct DOM Updates** - Scanner uses refs instead of setState for 60fps
2. **Memoization** - Segments and nodes are memoized to prevent recalculation
3. **GSAP Context** - Proper cleanup prevents memory leaks
4. **Content Repetition** - 3x repeat ensures seamless visual loop
5. **will-change** - CSS hints for browser optimization

---

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

---

## License

MIT License - Free to use and modify.
