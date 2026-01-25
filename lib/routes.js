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
 * Search Google Images with advanced filters
 * - Date: Past week (tbs=qdr:w)
 * - Size: Large (tbs=isz:l)
 * - Aspect ratio: Wide (tbs=iar:w)
 * @param {string} query - Search query
 * @returns {Promise<Array>} - Array of image results
 */
async function searchGoogleImages(query) {
  return new Promise((resolve) => {
    console.log(`[Google] Search query: "${query}"`);

    const encodedQuery = encodeURIComponent(query);
    // Google Images advanced search parameters:
    // tbs=qdr:w = past week
    // tbs=isz:l = large size
    // tbs=iar:w = wide aspect ratio
    // Combine with commas: tbs=qdr:w,isz:l,iar:w
    const googleUrl = `https://www.google.com/search?q=${encodedQuery}&tbm=isch&tbs=qdr:w,isz:l,iar:w`;

    const options = {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache'
      }
    };

    https.get(googleUrl, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location.startsWith('http')
          ? response.headers.location
          : `https://www.google.com${response.headers.location}`;
        https.get(redirectUrl, options, (redirectRes) => {
          handleGoogleResponse(redirectRes, query, resolve);
        }).on('error', () => resolve([]));
        return;
      }

      handleGoogleResponse(response, query, resolve);
    }).on('error', (e) => {
      console.error('[Google] Request error:', e.message);
      resolve([]);
    });
  });
}

function handleGoogleResponse(response, query, resolve) {
  if (response.statusCode !== 200) {
    console.log(`[Google] Search returned status ${response.statusCode}`);
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
        console.log('[Google] Response too short, likely blocked');
        resolve([]);
        return;
      }

      // Low quality domains to skip
      const lowQualityDomains = [
        'pinterest', 'pinimg', 'facebook', 'fbcdn', 'instagram', 'twitter', 'twimg',
        'tiktok', 'reddit', 'imgur', 'giphy', 'tenor', 'shopify', 'ebay', 'amazon',
        'aliexpress', 'alibaba', 'ytimg', 'youtube', 'placeholder', 'avatar', 'icon'
      ];

      const isLowQuality = (url) => {
        const lowerUrl = url.toLowerCase();
        return lowQualityDomains.some(domain => lowerUrl.includes(domain));
      };

      // Google embeds image URLs in various formats in the HTML
      // Method 1: Look for data-src or src attributes with image URLs
      const imgUrlRegex = /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)",\s*\d+,\s*\d+\]/gi;
      let match;
      const seenUrls = new Set();

      while ((match = imgUrlRegex.exec(html)) !== null) {
        let url = match[1];
        // Decode unicode escapes
        url = url.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');

        if (url && url.startsWith('http') && !seenUrls.has(url) && !isLowQuality(url)) {
          seenUrls.add(url);
          images.push({
            url: url,
            source: 'google',
            query: query
          });
          if (images.length >= 10) break;
        }
      }

      // Method 2: Look for ou: (original URL) in JSON-like structures
      if (images.length < 5) {
        const ouRegex = /"ou":"(https?:\/\/[^"]+)"/g;
        while ((match = ouRegex.exec(html)) !== null && images.length < 10) {
          let url = match[1];
          url = url.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');

          if (url && url.startsWith('http') && !seenUrls.has(url) && !isLowQuality(url)) {
            seenUrls.add(url);
            images.push({
              url: url,
              source: 'google',
              query: query
            });
          }
        }
      }

      // Method 3: Look for imgurl= in URLs
      if (images.length < 5) {
        const imgurlRegex = /imgurl=(https?[^&"]+)/g;
        while ((match = imgurlRegex.exec(html)) !== null && images.length < 10) {
          let url = decodeURIComponent(match[1]);
          url = url.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\/g, '');

          if (url && url.startsWith('http') && !seenUrls.has(url) && !isLowQuality(url)) {
            seenUrls.add(url);
            images.push({
              url: url,
              source: 'google',
              query: query
            });
          }
        }
      }

      console.log(`[Google] Found ${images.length} images for: ${query}`);
      resolve(images);
    } catch (e) {
      console.error('[Google] Parse error:', e.message);
      resolve([]);
    }
  });
}

/**
 * Search Bing Images for recent photos
 * Bing is more accessible than Getty and provides good sports images
 * @param {string} query - Search query
 * @returns {Promise<Array>} - Array of image results
 */
async function searchBingImages(query) {
  return new Promise((resolve) => {
    // Ensure query includes year for recent images (current year is 2026)
    let searchQuery = query;
    if (!query.includes('2026')) {
      searchQuery = query + ' 2026';
    }

    // Log the actual query being used
    console.log(`[Bing] Search query: "${searchQuery}"`);

    searchQuery = encodeURIComponent(searchQuery);
    // Use photo filter and recent time filter for newer images
    const bingUrl = `https://www.bing.com/images/search?q=${searchQuery}&qft=+filterui:photo-photo+filterui:imagesize-large&first=1`;

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
        'placeholder', 'blank', 'default',
        'ytimg', 'youtube',              // YouTube thumbnails - often low quality
        'bing.net/th',                   // Bing thumbnails
        '150x150', '100x100', '200x200', // Size indicators in URLs
        'small', 'tiny', 'mini'          // Size words in URLs
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
// Returns 3 image options per slide for user selection
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

    // Step 2: Search for images - return up to 3 options per slide
    const slides = [];

    for (let i = 0; i < suggestions.length; i++) {
      const suggestion = suggestions[i];
      console.log(`[API] Searching images for: ${suggestion.query}`);

      // Collect images from multiple sources - target 6 options per slide
      const allImages = [];

      // Try Google Images first (with past week, large, wide filters)
      const googleResults = await searchGoogleImages(suggestion.query);
      if (googleResults.length > 0) {
        allImages.push(...googleResults.slice(0, 6).map(img => ({ ...img, source: 'google' })));
        console.log(`[API] Found ${googleResults.length} Google images for: ${suggestion.query}`);
      }

      // Also try Bing for more options if needed
      if (allImages.length < 6) {
        const bingResults = await searchBingImages(suggestion.query);
        if (bingResults.length > 0) {
          const bingToAdd = bingResults.slice(0, 6 - allImages.length);
          allImages.push(...bingToAdd.map(img => ({ ...img, source: 'bing' })));
          console.log(`[API] Found ${bingResults.length} Bing images for: ${suggestion.query}`);
        }
      }

      // If still no images, try fallbacks
      if (allImages.length === 0) {
        const seed = suggestion.query.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + i;
        allImages.push({
          url: `https://picsum.photos/seed/${seed}/1280/720`,
          source: 'picsum',
          query: suggestion.query
        });
        console.log(`[API] Using Picsum fallback for: ${suggestion.query}`);
      }

      // Take up to 6 unique images
      const imageOptions = allImages.slice(0, 6);

      slides.push({
        query: suggestion.query,
        context: suggestion.context,
        // Primary image (first option)
        imageUrl: imageOptions[0].url,
        source: imageOptions[0].source,
        // All options for selection
        imageOptions: imageOptions.map((img, idx) => ({
          url: img.url,
          source: img.source,
          index: idx
        })),
        selectedIndex: 0, // Default to first option
        searchLinks: {
          google: `https://www.google.com/search?tbm=isch&tbs=qdr:w,isz:l,iar:w&q=${encodeURIComponent(suggestion.query)}`,
          bing: `https://www.bing.com/images/search?q=${encodeURIComponent(suggestion.query)}`
        }
      });
    }

    res.json({
      success: true,
      slides,
      message: `Generated ${slides.length} slides with ${slides.reduce((sum, s) => sum + s.imageOptions.length, 0)} total image options`
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
      slideshow: state.slideshow,
      nametags: state.nametags,
      socialAccounts: state.socialAccounts,
      socialRotationSpeed: state.socialRotationSpeed,
      showSocials: state.showSocials,
      lowerThird: state.lowerThird,
      agendaItems: state.agendaItems,
      agendaTitle: state.agendaTitle,
      showAgenda: state.showAgenda,
      topicCard: state.topicCard
    });
  });

  // ============================================================================
  // Nametag Routes
  // ============================================================================

  // Get all nametags
  stateRouter.get('/nametags', (req, res) => {
    res.json({ nametags: state.nametags });
  });

  // Update a single nametag slot
  stateRouter.post('/nametags/:slot', express.json(), (req, res) => {
    const slot = parseInt(req.params.slot);
    if (slot < 1 || slot > 5) {
      return res.status(400).json({ error: 'Slot must be 1-5' });
    }

    const { name, channelName, logoPosition, visible, showLogo, logoUrl } = req.body;

    state.nametags[slot] = {
      name: name !== undefined ? name : state.nametags[slot].name,
      channelName: channelName !== undefined ? channelName : state.nametags[slot].channelName,
      logoPosition: logoPosition !== undefined ? logoPosition : state.nametags[slot].logoPosition,
      visible: visible !== undefined ? visible : state.nametags[slot].visible,
      showLogo: showLogo !== undefined ? showLogo : state.nametags[slot].showLogo,
      logoUrl: logoUrl !== undefined ? logoUrl : state.nametags[slot].logoUrl
    };

    broadcast.broadcastNametagUpdate(state.nametags);
    console.log(`[API] Nametag ${slot} updated:`, state.nametags[slot]);
    res.json({ success: true, nametag: state.nametags[slot] });
  });

  // Show/hide a nametag
  stateRouter.post('/nametags/:slot/toggle', (req, res) => {
    const slot = parseInt(req.params.slot);
    if (slot < 1 || slot > 5) {
      return res.status(400).json({ error: 'Slot must be 1-5' });
    }

    state.nametags[slot].visible = !state.nametags[slot].visible;
    broadcast.broadcastNametagUpdate(state.nametags);
    console.log(`[API] Nametag ${slot} toggled to:`, state.nametags[slot].visible);
    res.json({ success: true, visible: state.nametags[slot].visible });
  });

  // Hide all nametags
  stateRouter.post('/nametags/hide-all', (req, res) => {
    for (let i = 1; i <= 5; i++) {
      state.nametags[i].visible = false;
    }
    broadcast.broadcastNametagUpdate(state.nametags);
    console.log('[API] All nametags hidden');
    res.json({ success: true });
  });

  // ============================================================================
  // Social Media Routes
  // ============================================================================

  // Get social accounts
  stateRouter.get('/socials', (req, res) => {
    res.json({
      socialAccounts: state.socialAccounts,
      socialRotationSpeed: state.socialRotationSpeed,
      showSocials: state.showSocials
    });
  });

  // Update social accounts
  stateRouter.post('/socials', express.json(), (req, res) => {
    const { socialAccounts, socialRotationSpeed, showSocials } = req.body;

    if (socialAccounts !== undefined) {
      state.socialAccounts = socialAccounts;
    }
    if (socialRotationSpeed !== undefined) {
      state.socialRotationSpeed = socialRotationSpeed;
    }
    if (showSocials !== undefined) {
      state.showSocials = showSocials;
    }

    broadcast.broadcastSocialUpdate({
      socialAccounts: state.socialAccounts,
      socialRotationSpeed: state.socialRotationSpeed,
      showSocials: state.showSocials
    });

    console.log(`[API] Socials updated: ${state.socialAccounts.length} accounts, show: ${state.showSocials}`);
    res.json({ success: true });
  });

  // Toggle social visibility
  stateRouter.post('/socials/toggle', (req, res) => {
    state.showSocials = !state.showSocials;
    broadcast.broadcastSocialUpdate({
      socialAccounts: state.socialAccounts,
      socialRotationSpeed: state.socialRotationSpeed,
      showSocials: state.showSocials
    });
    console.log(`[API] Socials toggled to: ${state.showSocials}`);
    res.json({ success: true, showSocials: state.showSocials });
  });

  // ============================================================================
  // Lower Third Routes
  // ============================================================================

  // Get lower third
  stateRouter.get('/lower-third', (req, res) => {
    res.json({ lowerThird: state.lowerThird });
  });

  // Update lower third
  stateRouter.post('/lower-third', express.json(), (req, res) => {
    const { visible, headline, description } = req.body;

    if (visible !== undefined) {
      state.lowerThird.visible = visible;
    }
    if (headline !== undefined) {
      state.lowerThird.headline = headline;
    }
    if (description !== undefined) {
      state.lowerThird.description = description;
    }

    broadcast.broadcastLowerThirdUpdate(state.lowerThird);
    console.log(`[API] Lower third updated: "${state.lowerThird.headline}", visible: ${state.lowerThird.visible}`);
    res.json({ success: true, lowerThird: state.lowerThird });
  });

  // Show lower third with content
  stateRouter.post('/lower-third/show', express.json(), (req, res) => {
    const { headline, description } = req.body;

    state.lowerThird.visible = true;
    if (headline !== undefined) {
      state.lowerThird.headline = headline;
    }
    if (description !== undefined) {
      state.lowerThird.description = description;
    }

    broadcast.broadcastLowerThirdUpdate(state.lowerThird);
    console.log(`[API] Lower third shown: "${state.lowerThird.headline}"`);
    res.json({ success: true, lowerThird: state.lowerThird });
  });

  // Hide lower third
  stateRouter.post('/lower-third/hide', (req, res) => {
    state.lowerThird.visible = false;
    broadcast.broadcastLowerThirdUpdate(state.lowerThird);
    console.log('[API] Lower third hidden');
    res.json({ success: true });
  });

  // ============================================================================
  // Agenda Routes
  // ============================================================================

  // Get agenda
  stateRouter.get('/agenda', (req, res) => {
    res.json({
      agendaItems: state.agendaItems,
      agendaTitle: state.agendaTitle,
      showAgenda: state.showAgenda
    });
  });

  // Update agenda
  stateRouter.post('/agenda', express.json(), (req, res) => {
    const { agendaItems, agendaTitle, showAgenda } = req.body;

    if (agendaItems !== undefined) {
      state.agendaItems = agendaItems;
    }
    if (agendaTitle !== undefined) {
      state.agendaTitle = agendaTitle;
    }
    if (showAgenda !== undefined) {
      state.showAgenda = showAgenda;
    }

    broadcast.broadcastAgendaUpdate({
      agendaItems: state.agendaItems,
      agendaTitle: state.agendaTitle,
      showAgenda: state.showAgenda
    });

    console.log(`[API] Agenda updated: ${state.agendaItems.length} items, show: ${state.showAgenda}`);
    res.json({ success: true });
  });

  // Toggle agenda visibility
  stateRouter.post('/agenda/toggle', (req, res) => {
    state.showAgenda = !state.showAgenda;
    broadcast.broadcastAgendaUpdate({
      agendaItems: state.agendaItems,
      agendaTitle: state.agendaTitle,
      showAgenda: state.showAgenda
    });
    console.log(`[API] Agenda toggled to: ${state.showAgenda}`);
    res.json({ success: true, showAgenda: state.showAgenda });
  });

  // Set current agenda item
  stateRouter.post('/agenda/set-current/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (index < 0 || index >= state.agendaItems.length) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    // Update item states
    state.agendaItems = state.agendaItems.map((item, i) => ({
      ...item,
      current: i === index,
      completed: i < index ? true : item.completed
    }));

    broadcast.broadcastAgendaUpdate({
      agendaItems: state.agendaItems,
      agendaTitle: state.agendaTitle,
      showAgenda: state.showAgenda
    });

    console.log(`[API] Agenda current set to index: ${index}`);
    res.json({ success: true, agendaItems: state.agendaItems });
  });

  // Complete agenda item
  stateRouter.post('/agenda/complete/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (index < 0 || index >= state.agendaItems.length) {
      return res.status(400).json({ error: 'Invalid index' });
    }

    state.agendaItems[index].completed = true;
    state.agendaItems[index].current = false;

    // Set next item as current if exists
    if (index + 1 < state.agendaItems.length) {
      state.agendaItems[index + 1].current = true;
    }

    broadcast.broadcastAgendaUpdate({
      agendaItems: state.agendaItems,
      agendaTitle: state.agendaTitle,
      showAgenda: state.showAgenda
    });

    console.log(`[API] Agenda item ${index} completed`);
    res.json({ success: true, agendaItems: state.agendaItems });
  });

  // ============================================================================
  // Topic Card Routes
  // ============================================================================

  // Get topic card
  stateRouter.get('/topic-card', (req, res) => {
    res.json({ topicCard: state.topicCard });
  });

  // Update topic card
  stateRouter.post('/topic-card', express.json(), (req, res) => {
    const { visible, title, subtitle } = req.body;

    if (visible !== undefined) {
      state.topicCard.visible = visible;
    }
    if (title !== undefined) {
      state.topicCard.title = title;
    }
    if (subtitle !== undefined) {
      state.topicCard.subtitle = subtitle;
    }

    broadcast.broadcastTopicCardUpdate(state.topicCard);
    console.log(`[API] Topic card updated: "${state.topicCard.title}", visible: ${state.topicCard.visible}`);
    res.json({ success: true, topicCard: state.topicCard });
  });

  // Show topic card with content
  stateRouter.post('/topic-card/show', express.json(), (req, res) => {
    const { title, subtitle } = req.body;

    state.topicCard.visible = true;
    if (title !== undefined) {
      state.topicCard.title = title;
    }
    if (subtitle !== undefined) {
      state.topicCard.subtitle = subtitle;
    }

    broadcast.broadcastTopicCardUpdate(state.topicCard);
    console.log(`[API] Topic card shown: "${state.topicCard.title}"`);
    res.json({ success: true, topicCard: state.topicCard });
  });

  // Hide topic card
  stateRouter.post('/topic-card/hide', (req, res) => {
    state.topicCard.visible = false;
    broadcast.broadcastTopicCardUpdate(state.topicCard);
    console.log('[API] Topic card hidden');
    res.json({ success: true });
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
