/**
 * Express Routes
 * API endpoints and file upload handling
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const multer = require('multer');
const imageOptimizer = require('./imageOptimizer');
const broadcast = require('./broadcast');
const { fetchManUtdNews } = require('./newsScraper');
const claudeApi = require('./claudeApi');

const router = express.Router();

// ============================================================================
// File Upload Setup
// ============================================================================

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const TEMP_UPLOADS_DIR = path.join(UPLOADS_DIR, 'temp');

// Create uploads directories if they don't exist
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('[Routes] Created uploads directory');
}

if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
  fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
  console.log('[Routes] Created temp uploads directory');
}

// Clean temp uploads on startup
function cleanTempUploads() {
  try {
    const files = fs.readdirSync(TEMP_UPLOADS_DIR);
    for (const file of files) {
      if (file === '.gitkeep') continue;
      fs.unlinkSync(path.join(TEMP_UPLOADS_DIR, file));
    }
    console.log(`[Routes] Cleaned ${files.length} temp files on startup`);
  } catch (e) {
    // Ignore errors
  }
}
cleanTempUploads();

// Configure multer for file uploads (uses temp directory, cleaned on restart)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_UPLOADS_DIR);
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
// Upload Routes
// ============================================================================

// File upload endpoint for slideshow (saves to temp, cleaned on restart)
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const isImage = req.file.mimetype.startsWith('image/');
  const filePath = path.join(TEMP_UPLOADS_DIR, req.file.filename);

  // Optimize image if Sharp is available
  let optimizeResult = { optimized: false };
  if (isImage && imageOptimizer.isAvailable()) {
    const skipOptimization = req.query.skipOptimize === 'true';
    optimizeResult = await imageOptimizer.optimizeImage(filePath, { skipOptimization });
  }

  const fileUrl = `/uploads/temp/${req.file.filename}`;
  console.log(`[Upload] Saved to temp: ${req.file.originalname} -> ${fileUrl}`);

  // Get final file size
  const finalStats = fs.statSync(filePath);

  res.json({
    success: true,
    url: fileUrl,
    filename: req.file.filename,
    originalName: req.file.originalname,
    type: isImage ? 'image' : 'video',
    size: finalStats.size,
    originalSize: req.file.size,
    optimized: optimizeResult.optimized,
    savedPercent: optimizeResult.savedPercent || 0
  });
});

// Multiple file upload (saves to temp, cleaned on restart)
router.post('/upload-multiple', upload.array('files', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const skipOptimization = req.query.skipOptimize === 'true';

  // Process all files with optimization
  const results = await Promise.all(req.files.map(async (file) => {
    const isImage = file.mimetype.startsWith('image/');
    const filePath = path.join(TEMP_UPLOADS_DIR, file.filename);

    let optimizeResult = { optimized: false };
    if (isImage && imageOptimizer.isAvailable()) {
      optimizeResult = await imageOptimizer.optimizeImage(filePath, { skipOptimization });
    }

    const finalStats = fs.statSync(filePath);

    return {
      success: true,
      url: `/uploads/temp/${file.filename}`,
      filename: file.filename,
      originalName: file.originalname,
      type: isImage ? 'image' : 'video',
      size: finalStats.size,
      originalSize: file.size,
      optimized: optimizeResult.optimized,
      savedPercent: optimizeResult.savedPercent || 0
    };
  }));

  const totalOriginal = results.reduce((sum, r) => sum + r.originalSize, 0);
  const totalFinal = results.reduce((sum, r) => sum + r.size, 0);
  const totalSaved = totalOriginal - totalFinal;

  console.log(`[Upload] Saved ${results.length} files (${(totalSaved / 1024).toFixed(0)}KB optimized)`);
  res.json({ success: true, files: results, totalSaved });
});

// Delete uploaded file
router.delete('/upload/:filename', (req, res) => {
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
router.get('/uploads', (req, res) => {
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

// ============================================================================
// News Scraper API
// ============================================================================

// Fetch Manchester United news from multiple sources
router.get('/news/manutd', async (req, res) => {
  try {
    console.log('[API] Fetching Man United news...');
    const news = await fetchManUtdNews();
    res.json({
      success: true,
      count: news.length,
      items: news,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] News fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// Image Suggestions API
// ============================================================================

// Generate image suggestions from ticker items
router.post('/image-suggestions', express.json(), async (req, res) => {
  try {
    const { tickerItems } = req.body;

    if (!claudeApi.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Claude API not available'
      });
    }

    console.log('[API] Generating image suggestions from ticker...');
    const suggestions = await claudeApi.generateImageSuggestions(tickerItems);

    res.json({
      success: true,
      suggestions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Image suggestion error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Search for images using Unsplash API (free tier)
router.get('/image-search', async (req, res) => {
  try {
    const { query, count = 5 } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`[API] Searching images for: ${query}`);

    // Use Unsplash Source API (no API key needed for random images)
    // Or fallback to a simple search that returns URLs for manual review
    const searchUrl = `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(query)}&per_page=${count}`;

    const results = await new Promise((resolve, reject) => {
      const options = {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json'
        }
      };

      https.get(searchUrl, options, (response) => {
        if (response.statusCode !== 200) {
          // Fallback: return placeholder URLs
          resolve({ fallback: true, results: [] });
          return;
        }

        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ fallback: false, results: json.results || [] });
          } catch (e) {
            resolve({ fallback: true, results: [] });
          }
        });
      }).on('error', () => {
        resolve({ fallback: true, results: [] });
      });
    });

    if (results.fallback || results.results.length === 0) {
      // Return search URLs for manual selection
      res.json({
        success: true,
        images: [],
        searchUrls: {
          google: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`,
          unsplash: `https://unsplash.com/s/photos/${encodeURIComponent(query.replace(/\s+/g, '-'))}`,
          pexels: `https://www.pexels.com/search/${encodeURIComponent(query.replace(/\s+/g, '%20'))}/`
        },
        message: 'No direct results - use search links to find images'
      });
      return;
    }

    // Map Unsplash results to usable format
    const images = results.results.map(img => ({
      id: img.id,
      url: img.urls?.regular || img.urls?.small,
      thumbnail: img.urls?.thumb || img.urls?.small,
      description: img.description || img.alt_description || query,
      author: img.user?.name || 'Unknown',
      source: 'unsplash',
      downloadUrl: img.links?.download || img.urls?.full
    }));

    res.json({
      success: true,
      images,
      query
    });
  } catch (error) {
    console.error('[API] Image search error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Search Bing Images for recent photos
 * Bing is more accessible than Getty and provides good sports images
 * @param {string} query - Search query
 * @returns {Promise<Array>} - Array of image results
 */
async function searchBingImages(query) {
  return new Promise((resolve) => {
    // Ensure query includes 2026 for recent images
    let searchQuery = query;
    if (!query.includes('2026') && !query.includes('2025')) {
      searchQuery = query + ' 2026';
    }
    searchQuery = encodeURIComponent(searchQuery);
    // Use news image filter to get recent editorial images
    const bingUrl = `https://www.bing.com/images/search?q=${searchQuery}&qft=+filterui:photo-photo&first=1`;

    const options = {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache'
      }
    };

    https.get(bingUrl, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        https.get(response.headers.location, options, (redirectRes) => {
          handleBingResponse(redirectRes, query, resolve);
        }).on('error', () => resolve([]));
        return;
      }

      handleBingResponse(response, query, resolve);
    }).on('error', (e) => {
      console.error('[Bing] Request error:', e.message);
      resolve([]);
    });
  });
}

function handleBingResponse(response, query, resolve) {
  if (response.statusCode !== 200) {
    console.log(`[Bing] Search returned status ${response.statusCode}`);
    resolve([]);
    return;
  }

  let html = '';
  response.on('data', chunk => html += chunk);
  response.on('end', () => {
    try {
      const images = [];

      // Check if we got valid HTML
      if (html.length < 1000) {
        console.log('[Bing] Response too short, likely blocked');
        resolve([]);
        return;
      }

      // Decode HTML entities first for easier parsing
      const decodedHtml = html
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'");

      // Low quality domains to skip - these often have low-res, watermarked, or compressed images
      const lowQualityDomains = [
        'pinterest', 'pinimg',           // Pinterest - heavily compressed
        'facebook', 'fbcdn',             // Facebook - compressed
        'instagram', 'cdninstagram',     // Instagram - compressed
        'twitter', 'twimg',              // Twitter - compressed
        'tiktok',                        // TikTok
        'reddit', 'redd.it',             // Reddit - often memes/low quality
        'imgur',                         // Imgur - variable quality
        'giphy',                         // GIFs
        'tenor',                         // GIFs
        'wikimedia', 'wikipedia',        // Often logos/diagrams
        'shopify',                       // Product images
        'ebay', 'amazon',                // E-commerce
        'aliexpress', 'alibaba',
        'thumbnail', 'thumb',            // Thumbnails
        'avatar', 'profile',             // Profile pics
        'icon', 'logo', 'sprite',        // UI elements
        'placeholder', 'blank', 'default'
      ];

      // High quality domains to prefer
      const highQualityDomains = [
        'gettyimages', 'getty',          // Getty - professional
        'reuters',                       // Reuters - news agency
        'ap', 'apnews',                  // AP - news agency
        'skysports',                     // Sky Sports
        'bbc',                           // BBC
        'espn',                          // ESPN
        'goal.com',                      // Goal
        'manutd.com',                    // Official club
        'premierleague',                 // Premier League official
        'theguardian', 'guardian',       // Guardian
        'telegraph',                     // Telegraph
        'mirror',                        // Mirror
        'dailymail',                     // Daily Mail
        'independent',                   // Independent
        'transfermarkt', 'tmssl',        // Transfermarkt
        'sofascore',                     // Sofascore
        'footballfancast',               // Football sites
        'football365', '90min',
        'fotmob', 'flashscore'
      ];

      // Check if URL is from a low quality source
      const isLowQuality = (url) => {
        const lowerUrl = url.toLowerCase();
        return lowQualityDomains.some(domain => lowerUrl.includes(domain));
      };

      // Check if URL is from a high quality source
      const isHighQuality = (url) => {
        const lowerUrl = url.toLowerCase();
        return highQualityDomains.some(domain => lowerUrl.includes(domain));
      };

      // Method 1: Look for murl (media URL) in decoded HTML
      // Format: "murl":"https://example.com/image.jpg"
      const murlRegex = /"murl":"(https?:\/\/[^"]+)"/g;
      let murlMatch;
      const highQualityImages = [];
      const otherImages = [];

      while ((murlMatch = murlRegex.exec(decodedHtml)) !== null) {
        let url = murlMatch[1];
        // Clean up escaped characters
        url = url.replace(/\\u002f/g, '/').replace(/\\\//g, '/').replace(/\\/g, '');

        if (url && url.startsWith('http') && url.length < 500) {
          // Skip low quality sources
          if (isLowQuality(url)) {
            continue;
          }

          // Categorize by quality
          if (isHighQuality(url) && !highQualityImages.some(img => img.url === url)) {
            highQualityImages.push({ url, source: 'bing', query });
          } else if (!otherImages.some(img => img.url === url)) {
            otherImages.push({ url, source: 'bing', query });
          }
        }
      }

      // Prefer high quality images, then fill with others
      images.push(...highQualityImages.slice(0, 8));
      if (images.length < 8) {
        images.push(...otherImages.slice(0, 8 - images.length));
      }

      console.log(`[Bing] Found ${images.length} images (${highQualityImages.length} high quality) for: ${query}`);
      resolve(images);
    } catch (e) {
      console.error('[Bing] Parse error:', e.message);
      resolve([]);
    }
  });
}

/**
 * Search DuckDuckGo Images as backup
 * @param {string} query - Search query
 * @returns {Promise<Array>} - Array of image results
 */
async function searchDuckDuckGoImages(query) {
  return new Promise((resolve) => {
    const searchQuery = encodeURIComponent(query + ' football');
    // DuckDuckGo image search
    const ddgUrl = `https://duckduckgo.com/?q=${searchQuery}&t=h_&iax=images&ia=images`;

    const options = {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    };

    https.get(ddgUrl, options, (response) => {
      if (response.statusCode !== 200) {
        resolve([]);
        return;
      }

      let html = '';
      response.on('data', chunk => html += chunk);
      response.on('end', () => {
        try {
          const images = [];
          // DDG uses vqd token and separate API, harder to scrape
          // Try to find any image URLs in the initial response
          const matches = html.matchAll(/https:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)/gi);
          for (const match of matches) {
            const url = match[0];
            if (url && !url.includes('duckduckgo') && !images.some(img => img.url === url)) {
              images.push({ url, source: 'ddg', query });
              if (images.length >= 5) break;
            }
          }
          console.log(`[DDG] Found ${images.length} images for: ${query}`);
          resolve(images);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

/**
 * Search for sports images using free APIs
 * @param {string} query - Search query
 * @returns {Promise<string|null>} - Direct image URL or null
 */
async function searchSportsImages(query) {
  // Try Wikimedia Commons for free, usable images
  return new Promise((resolve) => {
    const searchQuery = encodeURIComponent(query);
    const wikimediaUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srnamespace=6&format=json&srlimit=5`;

    https.get(wikimediaUrl, { timeout: 8000 }, (response) => {
      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.query?.search?.length > 0) {
            const title = json.query.search[0].title;
            // Get actual image URL
            const imageInfoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&format=json`;

            https.get(imageInfoUrl, { timeout: 5000 }, (infoRes) => {
              let infoData = '';
              infoRes.on('data', chunk => infoData += chunk);
              infoRes.on('end', () => {
                try {
                  const infoJson = JSON.parse(infoData);
                  const pages = infoJson.query?.pages;
                  if (pages) {
                    const page = Object.values(pages)[0];
                    if (page.imageinfo?.[0]?.url) {
                      resolve(page.imageinfo[0].url);
                      return;
                    }
                  }
                  resolve(null);
                } catch (e) {
                  resolve(null);
                }
              });
            }).on('error', () => resolve(null));
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// Auto-populate slideshow with images from suggestions
router.post('/auto-populate-slideshow', express.json(), async (req, res) => {
  try {
    const { tickerItems } = req.body;

    if (!claudeApi.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Claude API not available'
      });
    }

    console.log('[API] Auto-populating slideshow from ticker...');

    // Step 1: Get image suggestions
    const suggestions = await claudeApi.generateImageSuggestions(tickerItems);

    if (!suggestions || suggestions.length === 0) {
      return res.json({
        success: false,
        error: 'No suggestions generated'
      });
    }

    // Step 2: Search for real images for each suggestion (one per ticker item)
    const slides = [];

    for (let i = 0; i < suggestions.length; i++) {
      const suggestion = suggestions[i];
      console.log(`[API] Searching images for: ${suggestion.query}`);

      // Try multiple sources in order of preference
      let imageUrl = null;
      let imageSource = 'picsum';

      // Try Bing Images first (most reliable for sports images)
      const bingResults = await searchBingImages(suggestion.query);
      if (bingResults.length > 0) {
        imageUrl = bingResults[0].url;
        imageSource = 'bing';
        console.log(`[API] Found Bing image for: ${suggestion.query}`);
      }

      // Fallback to DuckDuckGo
      if (!imageUrl) {
        const ddgResults = await searchDuckDuckGoImages(suggestion.query);
        if (ddgResults.length > 0) {
          imageUrl = ddgResults[0].url;
          imageSource = 'ddg';
          console.log(`[API] Found DDG image for: ${suggestion.query}`);
        }
      }

      // Fallback to Wikimedia Commons (free, high quality)
      if (!imageUrl) {
        imageUrl = await searchSportsImages(suggestion.query);
        if (imageUrl) {
          imageSource = 'wikimedia';
          console.log(`[API] Found Wikimedia image for: ${suggestion.query}`);
        }
      }

      // Final fallback to Picsum with sports-like seed
      if (!imageUrl) {
        const seed = suggestion.query.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + i;
        imageUrl = `https://picsum.photos/seed/${seed}/1280/720`;
        imageSource = 'picsum';
        console.log(`[API] Using Picsum fallback for: ${suggestion.query}`);
      }

      slides.push({
        query: suggestion.query,
        context: suggestion.context,
        imageUrl: imageUrl,
        source: imageSource,
        searchLinks: {
          bing: `https://www.bing.com/images/search?q=${encodeURIComponent(suggestion.query)}`,
          google: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(suggestion.query)}`,
          unsplash: `https://unsplash.com/s/photos/${encodeURIComponent(suggestion.query.replace(/\s+/g, '-'))}`
        }
      });
    }

    res.json({
      success: true,
      slides,
      message: `Generated ${slides.length} slides with images. Sources: ${slides.map(s => s.source).join(', ')}`
    });
  } catch (error) {
    console.error('[API] Auto-populate error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Download image from URL and save to uploads
router.post('/upload-url', express.json(), async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported' });
    }

    console.log(`[API] Downloading image from: ${url}`);

    // Download the image
    const httpModule = parsedUrl.protocol === 'https:' ? https : http;

    const downloadPromise = new Promise((resolve, reject) => {
      const options = {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      };
      const request = httpModule.get(url, options, (response) => {
        // Follow redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          httpModule.get(response.headers.location, options, (redirectResponse) => {
            handleResponse(redirectResponse, resolve, reject);
          }).on('error', reject);
          return;
        }
        handleResponse(response, resolve, reject);
      });

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });

    function handleResponse(response, resolve, reject) {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const contentType = response.headers['content-type'] || '';
      if (!contentType.startsWith('image/')) {
        reject(new Error('URL does not point to an image'));
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
      response.on('error', reject);
    }

    const { buffer, contentType } = await downloadPromise;

    // Determine extension from content type
    const extMap = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg'
    };
    const ext = extMap[contentType] || '.jpg';

    // Generate filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = `url-${uniqueSuffix}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    // Save file
    fs.writeFileSync(filePath, buffer);

    // Optimize if possible
    let optimizeResult = { optimized: false };
    if (imageOptimizer.isAvailable() && !contentType.includes('gif') && !contentType.includes('svg')) {
      optimizeResult = await imageOptimizer.optimizeImage(filePath, {});
    }

    const fileUrl = `/uploads/${filename}`;
    const finalStats = fs.statSync(filePath);

    console.log(`[API] Saved URL image: ${fileUrl} (${(finalStats.size / 1024).toFixed(1)}KB)`);

    res.json({
      success: true,
      url: fileUrl,
      filename: filename,
      originalUrl: url,
      type: 'image',
      size: finalStats.size,
      optimized: optimizeResult.optimized
    });
  } catch (error) {
    console.error('[API] URL upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// API Routes (state and health need state passed in)
// ============================================================================

/**
 * Create state-dependent routes
 * @param {object} state - Application state object
 * @returns {express.Router}
 */
function createStateRoutes(state) {
  const stateRouter = express.Router();

  // Health check
  stateRouter.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      connected: state.isConnected,
      videoId: state.videoId,
      queueSize: state.queue.length,
      clients: broadcast.getClientCount()
    });
  });

  // Get current state
  stateRouter.get('/state', (req, res) => {
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

  return stateRouter;
}

// Export uploads directory path for static serving
router.UPLOADS_DIR = UPLOADS_DIR;

module.exports = {
  router,
  createStateRoutes,
  UPLOADS_DIR
};
