/**
 * Image Optimization Module
 * Uses Sharp for server-side image optimization
 */

const fs = require('fs');
const path = require('path');

// Optional: Sharp for image optimization (if installed)
let sharp;
try {
  sharp = require('sharp');
  console.log('[ImageOptimizer] Sharp loaded successfully');
} catch (e) {
  console.log('[ImageOptimizer] Sharp not installed - image optimization disabled');
  console.log('[ImageOptimizer] Run: npm install sharp to enable image optimization');
}

/**
 * Check if Sharp is available
 * @returns {boolean}
 */
function isAvailable() {
  return !!sharp;
}

/**
 * Optimize an image file
 * @param {string} filePath - Path to the image file
 * @param {object} options - Optimization options
 * @returns {Promise<object>} - Optimization result
 */
async function optimizeImage(filePath, options = {}) {
  if (!sharp) return { optimized: false, path: filePath };

  const ext = path.extname(filePath).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

  if (!imageExts.includes(ext)) {
    return { optimized: false, path: filePath };
  }

  const {
    maxWidth = 1920,        // Max width for slideshow images
    maxHeight = 1080,       // Max height for slideshow images
    quality = 85,           // JPEG/WebP quality
    skipOptimization = false
  } = options;

  if (skipOptimization) {
    return { optimized: false, path: filePath };
  }

  try {
    const originalStats = fs.statSync(filePath);
    const originalSize = originalStats.size;

    // Get image metadata
    const metadata = await sharp(filePath).metadata();

    // Skip if already small enough
    if (metadata.width <= maxWidth && metadata.height <= maxHeight && originalSize < 500 * 1024) {
      return { optimized: false, path: filePath, originalSize };
    }

    // Create optimized filename
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, ext);
    const optimizedPath = path.join(dir, `${basename}-opt${ext}`);

    // Process image
    let sharpInstance = sharp(filePath)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

    // Apply format-specific optimizations
    if (ext === '.jpg' || ext === '.jpeg') {
      sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
    } else if (ext === '.png') {
      sharpInstance = sharpInstance.png({ compressionLevel: 9, adaptiveFiltering: true });
    } else if (ext === '.webp') {
      sharpInstance = sharpInstance.webp({ quality });
    }

    await sharpInstance.toFile(optimizedPath);

    // Get new size
    const newStats = fs.statSync(optimizedPath);
    const newSize = newStats.size;

    // Only keep optimized if it's actually smaller
    if (newSize < originalSize * 0.9) { // At least 10% smaller
      fs.unlinkSync(filePath); // Remove original
      fs.renameSync(optimizedPath, filePath); // Replace with optimized
      const savedPercent = Math.round((1 - newSize / originalSize) * 100);
      console.log(`[ImageOptimizer] ${path.basename(filePath)}: ${(originalSize / 1024).toFixed(0)}KB -> ${(newSize / 1024).toFixed(0)}KB (${savedPercent}% saved)`);
      return { optimized: true, path: filePath, originalSize, newSize, savedPercent };
    } else {
      fs.unlinkSync(optimizedPath); // Remove optimized, keep original
      return { optimized: false, path: filePath, originalSize, reason: 'No significant size reduction' };
    }
  } catch (err) {
    console.error(`[ImageOptimizer] Error processing ${filePath}:`, err.message);
    return { optimized: false, path: filePath, error: err.message };
  }
}

/**
 * Batch optimize multiple images
 * @param {string[]} filePaths - Array of file paths
 * @param {object} options - Optimization options
 * @returns {Promise<object[]>} - Array of optimization results
 */
async function optimizeImages(filePaths, options = {}) {
  return Promise.all(filePaths.map(fp => optimizeImage(fp, options)));
}

module.exports = {
  isAvailable,
  optimizeImage,
  optimizeImages,
  sharp // Export sharp instance for direct use if needed
};
