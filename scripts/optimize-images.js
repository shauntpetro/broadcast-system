/**
 * Batch Image Optimization Script
 * Optimizes all images in the uploads directory
 *
 * Usage: npm run optimize:images
 *        node scripts/optimize-images.js [--quality=85] [--max-width=1920]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load sharp
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.error('Sharp is not installed. Run: npm install sharp');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace('--', '').split('=');
  acc[key] = value || true;
  return acc;
}, {});

const CONFIG = {
  quality: parseInt(args.quality) || 85,
  maxWidth: parseInt(args['max-width']) || 1920,
  maxHeight: parseInt(args['max-height']) || 1080,
  uploadsDir: path.join(__dirname, '..', 'uploads'),
  supportedFormats: ['.jpg', '.jpeg', '.png', '.webp'],
  skipIfSmallerThan: 100 * 1024, // 100KB
};

async function optimizeImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  if (!CONFIG.supportedFormats.includes(ext)) {
    return { skipped: true, reason: 'Unsupported format' };
  }

  try {
    const originalStats = fs.statSync(filePath);
    const originalSize = originalStats.size;

    // Skip small files
    if (originalSize < CONFIG.skipIfSmallerThan) {
      return { skipped: true, reason: 'Already small', originalSize };
    }

    const metadata = await sharp(filePath).metadata();

    // Skip if already within dimensions
    if (metadata.width <= CONFIG.maxWidth && metadata.height <= CONFIG.maxHeight) {
      return { skipped: true, reason: 'Already optimized dimensions', originalSize };
    }

    // Create temp file
    const tempPath = filePath + '.tmp';

    let sharpInstance = sharp(filePath)
      .resize(CONFIG.maxWidth, CONFIG.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });

    // Apply format-specific optimizations
    if (ext === '.jpg' || ext === '.jpeg') {
      sharpInstance = sharpInstance.jpeg({ quality: CONFIG.quality, mozjpeg: true });
    } else if (ext === '.png') {
      sharpInstance = sharpInstance.png({ compressionLevel: 9, adaptiveFiltering: true });
    } else if (ext === '.webp') {
      sharpInstance = sharpInstance.webp({ quality: CONFIG.quality });
    }

    await sharpInstance.toFile(tempPath);

    const newStats = fs.statSync(tempPath);
    const newSize = newStats.size;

    // Only keep if smaller
    if (newSize < originalSize * 0.9) {
      fs.unlinkSync(filePath);
      fs.renameSync(tempPath, filePath);
      const savedBytes = originalSize - newSize;
      const savedPercent = Math.round((savedBytes / originalSize) * 100);
      return {
        optimized: true,
        filename,
        originalSize,
        newSize,
        savedBytes,
        savedPercent
      };
    } else {
      fs.unlinkSync(tempPath);
      return { skipped: true, reason: 'No significant reduction', originalSize };
    }
  } catch (err) {
    return { error: true, filename, message: err.message };
  }
}

async function main() {
  console.log('\n=== SEMEEX Image Optimizer ===\n');
  console.log(`Quality: ${CONFIG.quality}`);
  console.log(`Max dimensions: ${CONFIG.maxWidth}x${CONFIG.maxHeight}`);
  console.log(`Uploads directory: ${CONFIG.uploadsDir}\n`);

  if (!fs.existsSync(CONFIG.uploadsDir)) {
    console.log('Uploads directory does not exist.');
    return;
  }

  const files = fs.readdirSync(CONFIG.uploadsDir);
  const imageFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return CONFIG.supportedFormats.includes(ext);
  });

  if (imageFiles.length === 0) {
    console.log('No images found to optimize.');
    return;
  }

  console.log(`Found ${imageFiles.length} images to process...\n`);

  let totalOriginal = 0;
  let totalNew = 0;
  let optimizedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const file of imageFiles) {
    const filePath = path.join(CONFIG.uploadsDir, file);
    const result = await optimizeImage(filePath);

    if (result.optimized) {
      console.log(`✓ ${file}: ${(result.originalSize / 1024).toFixed(0)}KB → ${(result.newSize / 1024).toFixed(0)}KB (${result.savedPercent}% saved)`);
      totalOriginal += result.originalSize;
      totalNew += result.newSize;
      optimizedCount++;
    } else if (result.skipped) {
      console.log(`- ${file}: Skipped (${result.reason})`);
      skippedCount++;
    } else if (result.error) {
      console.log(`✗ ${file}: Error - ${result.message}`);
      errorCount++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Optimized: ${optimizedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (optimizedCount > 0) {
    const totalSaved = totalOriginal - totalNew;
    console.log(`\nTotal space saved: ${(totalSaved / 1024 / 1024).toFixed(2)}MB`);
    console.log(`Total reduction: ${Math.round((totalSaved / totalOriginal) * 100)}%`);
  }
}

main().catch(console.error);
