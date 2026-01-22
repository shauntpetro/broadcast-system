import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// HTML files to build
const htmlFiles = [
  'index.html',
  'slideshow_4.html',
  'ticker.html',
  'ticker_sports.html',
  'youtube_chat.html',
  'youtube_chat_obs.html'
];

export default defineConfig({
  // Build configuration
  build: {
    outDir: 'dist-frontend',
    emptyOutDir: true,

    // Rollup options for multi-page app
    rollupOptions: {
      input: htmlFiles.reduce((acc, file) => {
        const name = file.replace('.html', '');
        acc[name] = resolve(__dirname, file);
        return acc;
      }, {}),
      output: {
        // Chunk naming
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',

        // Manual chunk splitting for better caching
        manualChunks: {
          // Group GSAP into its own chunk
          gsap: ['gsap']
        }
      }
    },

    // Minification settings
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false, // Keep console for debugging
        drop_debugger: true
      }
    },

    // CSS code splitting
    cssCodeSplit: true,

    // Asset inlining threshold (4KB)
    assetsInlineLimit: 4096,

    // Source maps for production debugging
    sourcemap: false
  },

  // Development server (optional, for local dev)
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8888',
      '/uploads': 'http://localhost:8888',
      '/ws': {
        target: 'ws://localhost:8888',
        ws: true
      }
    }
  },

  // Optimization
  optimizeDeps: {
    include: ['gsap']
  },

  // CSS configuration
  css: {
    postcss: './postcss.config.mjs'
  }
});
