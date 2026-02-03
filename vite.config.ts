import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { componentTagger } from 'lovable-tagger';

function devFetchSitemapPlugin(): Plugin {
  return {
    name: 'dev-fetch-sitemap',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/fetch-sitemap')) return next();

        // Basic CORS for parity with the CF function
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          res.end('ok');
          return;
        }

        try {
          const requestUrl = new URL(req.url, 'http://localhost');
          const targetUrl = requestUrl.searchParams.get('url');

          if (!targetUrl) {
            res.statusCode = 400;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: "Missing 'url' parameter" }));
            return;
          }

          // Validate URL
          let parsed: URL;
          try {
            parsed = new URL(targetUrl);
          } catch {
            res.statusCode = 400;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid URL' }));
            return;
          }

          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            res.statusCode = 400;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Only http/https URLs are allowed' }));
            return;
          }

          const controller = new AbortController();
          // Large WordPress sitemaps can take >55s to generate/transfer.
          // Give them more runway in dev/preview.
          const timeoutId = setTimeout(() => controller.abort(), 90000);

          const upstream = await fetch(parsed.toString(), {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ContentOptimizer/1.0)',
              'Accept': 'application/xml, text/xml, text/html, */*',
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          const contentType = upstream.headers.get('content-type') || 'text/plain';
          const text = await upstream.text();

          if (!upstream.ok) {
            res.statusCode = upstream.status;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: `Upstream returned ${upstream.status}: ${upstream.statusText}`,
              })
            );
            return;
          }

          res.statusCode = 200;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=60');
          res.setHeader('Content-Type', contentType);
          res.end(text);
        } catch (e: any) {
          const message = e?.name === 'AbortError' ? 'Request timed out after 55s' : String(e?.message || e);
          res.statusCode = e?.name === 'AbortError' ? 408 : 500;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: '::',
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api/proxy': {
        target: 'https://api.allorigins.win',
        changeOrigin: true,
        rewrite: (p) => {
          const url = new URL(p, 'http://localhost');
          const targetUrl = url.searchParams.get('url');
          return `/raw?url=${targetUrl}`;
        },
      },
    },
  },
  plugins: [
    react(),
    devFetchSitemapPlugin(),
    mode === 'development' && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-ai': ['openai'],
        },
      },
    },
  },
  define: {
    'process.env': {},
  },
  optimizeDeps: {
    exclude: ['@anthropic-ai/sdk'],
  },
}));
