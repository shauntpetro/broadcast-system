# OBS Slideshow Application - Technical Specification

## Overview

A browser-based slideshow application designed to be used as a source in OBS (Open Broadcaster Software). The application provides a control interface for managing slides and a clean output view for broadcast capture.

---

## Architecture

### Recommended Stack
- **Framework**: React + Vite (fast dev, easy build)
- **Styling**: Tailwind CSS
- **State Management**: Zustand or React Context (simple, effective)
- **Local Storage**: For persisting slideshow state between sessions
- **Build Output**: Static HTML that can be opened directly in browser

### Window Architecture

**Option A: Single Window with Dual Views (Recommended)**
- Main window contains both control panel and preview
- "Pop-out Output" button opens a new window that renders the same state
- Use `window.opener` reference to share state object directly
- Output window polls parent for state changes (avoids blob URL issues)

**Option B: Electron App (Future)**
- Would allow proper multi-window state sharing
- Native file system access
- Better for production use

---

## Core Features

### 1. Media Management

#### File Upload
- Accept: images (png, jpg, jpeg, gif, webp, svg, avif, bmp) and videos (mp4, webm, mov, avi, mkv, m4v, ogg)
- Drag-and-drop support
- Multi-file upload
- Generate blob URLs for preview (note: these don't persist across sessions)

#### Slide Data Structure
```javascript
{
  id: string,              // Unique identifier
  url: string,             // Blob URL or file path
  type: 'image' | 'video', // Media type
  fileName: string,        // Original filename
  
  // Metadata
  name: string,            // User-defined slide name (shown in sidebar)
  notes: string,           // Private notes (not displayed in output)
  
  // Display Text
  title: string,           // Large title text
  subtitle: string,        // Smaller subtitle text
  quote: string,           // Centered quote text
  quoteAuthor: string,     // Quote attribution
  
  // Effects
  kenBurns: 'none' | 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight',
  kenBurnsDuration: number, // 10-120 seconds
  
  // Transitions
  transitionIn: 'cut' | 'fade' | 'blur' | 'whipPan' | 'slideLeft' | 'slideRight',
  transitionDuration: number, // 0.2-2 seconds
  
  // Fit Mode
  fitMode: 'contain' | 'cover' | 'stretch',
  
  // Video-specific
  videoStartTime: number,  // Start position in seconds
  videoEndTime: number,    // End position (null = end of video)
  videoMuted: boolean,     // Audio mute state
  videoLoop: boolean,      // Loop when reaching end
}
```

#### Global Settings (Apply to All Slides by Default)
```javascript
{
  defaultTransition: string,
  defaultTransitionDuration: number,
  defaultKenBurns: string,
  defaultKenBurnsDuration: number,
  defaultFitMode: string,
  backgroundColor: string,  // For letterboxing
  showBlurBackground: boolean, // Blur effect behind contained media
}
```

---

### 2. User Interface Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  SIDEBAR (260px)  │     MAIN PREVIEW AREA      │  EDITOR PANEL     │
│                   │                            │  (320px, optional)│
│  ┌─────────────┐  │  ┌──────────────────────┐  │                   │
│  │ Slide 1    │  │  │                      │  │  Slide Name       │
│  │ [thumb]    │  │  │                      │  │  [___________]    │
│  │ Name       │  │  │     16:9 Preview     │  │                   │
│  └─────────────┘  │  │                      │  │  Notes            │
│  ┌─────────────┐  │  │     with effects    │  │  [___________]    │
│  │ Slide 2    │  │  │                      │  │                   │
│  │ [thumb]    │  │  │     and overlays     │  │  ─────────────    │
│  │ Name       │  │  │                      │  │                   │
│  └─────────────┘  │  └──────────────────────┘  │  Title            │
│  ┌─────────────┐  │                            │  [___________]    │
│  │ + Add      │  │  ┌──────────────────────┐  │                   │
│  └─────────────┘  │  │   ◄  │ 2/5 │  ►     │  │  Subtitle         │
│                   │  │   Navigation Bar    │  │  [___________]    │
│  ───────────────  │  └──────────────────────┘  │                   │
│  [OBS Output]     │                            │  ...etc           │
│  [Settings]       │                            │                   │
└─────────────────────────────────────────────────────────────────────┘
```

#### Sidebar
- Scrollable list of all slide thumbnails
- Shows: thumbnail, slide number, name, notes preview
- Click to navigate to slide
- Drag to reorder (optional enhancement)
- Visual indicator for current slide (red border/highlight)
- "Add Media" button/dropzone at bottom
- "OBS Output Window" button
- "Global Settings" button

#### Main Preview
- 16:9 aspect ratio preview of current slide
- Shows all effects and overlays as they'll appear in output
- Navigation bar below with:
  - Previous/Next buttons
  - Slide counter (e.g., "2 / 5")
  - Video play/pause (only for video slides)
  - Edit button to open/close editor panel

#### Editor Panel (Right Side)
- Opens when editing a slide
- All changes apply in real-time (no save button)
- Sections:
  1. **Metadata**: Slide name, notes
  2. **Display Text**: Title, subtitle, quote, quote author
  3. **Effects**: Ken Burns dropdown, duration slider
  4. **Transition**: Type dropdown, duration slider
  5. **Fit Mode**: Contain/Cover/Stretch radio buttons
  6. **Video Options** (if video): Start time, end time, mute, loop
  7. **Actions**: Delete slide, move up/down

---

### 3. Output Window (OBS Capture)

#### Requirements
- Completely clean - no UI elements, controls, or borders
- Full viewport 16:9 content
- Syncs with main control window in real-time
- URL parameter to open directly: `?output=1` or `?obs=1`

#### Rendering
- Blurred/zoomed background (if enabled)
- Main media with fit mode applied
- Ken Burns animation
- Text overlays (title, subtitle, quote)
- Transitions between slides

#### Sync Mechanism
```javascript
// In main window
window.slideshowState = { slides, currentIndex, isPlaying };

// In output window
setInterval(() => {
  if (window.opener?.slideshowState) {
    const state = window.opener.slideshowState;
    if (stateChanged(state)) {
      updateDisplay(state);
    }
  }
}, 50); // Poll at 20fps for smooth updates
```

---

### 4. Transitions

#### Types

| Transition | Description |
|------------|-------------|
| `cut` | Instant switch, no animation |
| `fade` | Crossfade opacity |
| `blur` | Blur out → blur in |
| `whipPan` | Fast horizontal motion blur |
| `slideLeft` | New slide enters from right |
| `slideRight` | New slide enters from left |
| `zoom` | Zoom out old → zoom in new |

#### Implementation
- Use CSS transitions/animations
- Transition duration: 0.2s - 2s (user configurable)
- Default: `blur` at 0.4s

```css
/* Example: Blur transition */
.slide-exit {
  animation: blurOut 0.4s ease-out forwards;
}
@keyframes blurOut {
  from { filter: blur(0); opacity: 1; transform: scale(1); }
  to { filter: blur(20px); opacity: 0; transform: scale(0.95); }
}

.slide-enter {
  animation: blurIn 0.4s ease-out forwards;
}
@keyframes blurIn {
  from { filter: blur(20px); opacity: 0; transform: scale(1.05); }
  to { filter: blur(0); opacity: 1; transform: scale(1); }
}
```

---

### 5. Fit Modes

| Mode | Behavior |
|------|----------|
| `contain` | Fit entire image, maintain aspect ratio, letterbox if needed |
| `cover` | Fill frame, maintain aspect ratio, crop overflow |
| `stretch` | Fill frame, ignore aspect ratio (distorts image) |

#### Background Options (for `contain` mode)
- **Blur**: Zoomed and blurred version of the image
- **Solid Color**: User-defined background color
- **Transparent**: For compositing in OBS

---

### 6. Ken Burns Effects

#### Types
| Effect | Description |
|--------|-------------|
| `none` | Static image |
| `zoomIn` | Slowly zoom from 100% to ~112% |
| `zoomOut` | Start at ~112%, slowly zoom to 100% |
| `panLeft` | Slowly pan from right to left |
| `panRight` | Slowly pan from left to right |

#### Settings
- Duration: 10s - 120s (very slow movement)
- Timing function: `linear` (constant speed)
- Scale factor: subtle (1.0 → 1.12 max)

#### Implementation
```css
.kb-zoom-in {
  animation: kenBurnsZoomIn var(--kb-duration, 30s) linear forwards;
}
@keyframes kenBurnsZoomIn {
  from { transform: scale(1); }
  to { transform: scale(1.12); }
}
```

---

### 7. Text Overlays

#### Title/Subtitle
- Position: Bottom of frame
- Background: Gradient from transparent to semi-opaque black
- Typography:
  - Title: Bold, 3-5rem, white, text shadow
  - Subtitle: Light weight, 1.5-2rem, white/80%

#### Quote
- Position: Center of frame (vertically and horizontally)
- Background: Semi-transparent black box with blur
- Typography:
  - Quote: Italic, serif font, 2-3rem
  - Author: Regular weight, 1.25rem, preceded by em dash

#### Future Enhancements
- Custom positioning (drag to place)
- Custom fonts and colors
- Animated text entrance

---

### 8. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` | Previous slide |
| `→` | Next slide |
| `Space` | Play/pause video |
| `P` | Pin current slide (disable auto-advance if implemented) |
| `H` | Toggle UI visibility (for main window preview) |
| `E` | Toggle editor panel |
| `Escape` | Close editor panel |
| `Delete` | Delete current slide (with confirmation) |

---

### 9. Video Handling

#### Playback Rules
- Videos should NOT autoplay when navigating to a slide
- User must explicitly press play
- Video state (playing/paused) should sync to output window

#### Controls
- Play/pause button in navigation bar
- Mute toggle
- (Future) Scrubber/timeline
- (Future) Playback speed

#### Looping
- Optional per-slide setting
- If disabled, video pauses at end

---

### 10. Data Persistence

#### Local Storage
Save to `localStorage` on every change:
```javascript
{
  slides: [...], // Without blob URLs (can't persist those)
  globalSettings: {...},
  currentIndex: number,
  lastModified: timestamp
}
```

#### File Export/Import
- Export slideshow as JSON file
- Import JSON to restore slideshow
- Note: Media files need to be re-uploaded (blob URLs don't persist)

#### Future: Project Files
- Package slides + media into a single file
- Could use zip format with manifest.json

---

## Implementation Priority

### Phase 1: Core (MVP)
1. ✅ File upload and slide management
2. ✅ Sidebar with thumbnails
3. ✅ Preview with blur background
4. ✅ Basic navigation (arrows)
5. ✅ Title/subtitle/quote overlays
6. ✅ Ken Burns effects
7. ⚠️ OBS output window sync (needs fix)
8. ❌ Transition types (only blur currently)
9. ❌ Fit modes (only contain currently)

### Phase 2: Polish
1. Video controls (no autoplay, play/pause sync)
2. Transition type selector
3. Fit mode selector
4. Global settings panel
5. Keyboard shortcuts
6. Drag-to-reorder slides

### Phase 3: Advanced
1. Local storage persistence
2. Export/import JSON
3. Custom text positioning
4. More transition effects
5. Video trimming (start/end points)
6. Audio controls

---

## Technical Notes

### Blob URL Limitations
- Blob URLs are session-only (lost on page refresh)
- Cannot be shared across different origins
- For persistence, would need:
  - IndexedDB to store actual file data
  - Or server-side storage
  - Or export/import workflow

### Cross-Window Communication
The most reliable approaches:
1. **Direct reference**: `window.opener.state` (same origin only)
2. **BroadcastChannel API**: Works across tabs (same origin)
3. **localStorage events**: Fires on other tabs when storage changes
4. **Polling**: Simple but effective - output window polls parent state

Recommended: Combine direct reference with polling fallback.

### Performance Considerations
- Use `object-fit` CSS for fit modes (GPU accelerated)
- Use CSS animations for Ken Burns (GPU accelerated)
- Debounce input handlers that trigger re-renders
- Use `will-change` hint for animated elements
- Consider `requestAnimationFrame` for smooth transitions

### OBS Browser Source Settings
Recommended settings for users:
- Width: 1920
- Height: 1080
- FPS: 30 or 60
- Custom CSS: `body { margin: 0; overflow: hidden; }`

---

## File Structure (Suggested)

```
obs-slideshow/
├── src/
│   ├── components/
│   │   ├── Sidebar.jsx
│   │   ├── SlidePreview.jsx
│   │   ├── EditorPanel.jsx
│   │   ├── OutputView.jsx
│   │   ├── NavigationBar.jsx
│   │   └── GlobalSettings.jsx
│   ├── hooks/
│   │   ├── useSlideshow.js      # Main state management
│   │   ├── useKeyboardShortcuts.js
│   │   └── useOutputSync.js     # Cross-window sync
│   ├── utils/
│   │   ├── fileHandling.js
│   │   ├── transitions.js
│   │   └── storage.js
│   ├── styles/
│   │   └── animations.css       # Ken Burns, transitions
│   ├── App.jsx
│   └── main.jsx
├── public/
├── index.html
├── package.json
└── vite.config.js
```

---

## Example User Flow

1. User opens `slideshow.html` in browser
2. Clicks "Add Media" and selects 5 images
3. Images appear in sidebar as slides
4. User clicks slide 2 to view it
5. Clicks Edit button, types a title "Darren Fletcher"
6. Title appears immediately in preview
7. Changes Ken Burns to "Slow Zoom In", duration to 45s
8. Clicks "OBS Output Window" button
9. New window opens showing clean 16:9 output
10. In main window, navigates to slide 3
11. Output window transitions to slide 3 with blur effect
12. User points OBS Browser Source at output window
13. Goes live with slideshow!

---

## Reference Screenshots

The user provided screenshots showing "Talk of the Devils" style graphics:
- Dark/black background aesthetic
- White text overlays with semi-transparent backgrounds
- Professional sports broadcast styling
- 16:9 format optimized for streaming

Design should accommodate this Manchester United fan channel aesthetic.
