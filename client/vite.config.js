import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// La versione finisce nel bundle (guida e scheda «Informazioni»): i tre
// package.json sono allineati dal workflow di rilascio, quindi basta leggere
// questo.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Nel bundle che finisce dentro l'app desktop la PWA non serve (il server è
// locale) e il suo service worker faceva vedere la versione precedente al primo
// avvio dopo un aggiornamento: lo escludiamo. Il build web/Docker resta una PWA.
const isDesktop = process.env.ORABRIDGE_TARGET === 'desktop';

const pwaPlugin = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'auto',
  manifest: {
    name: 'Orabridge',
    short_name: 'Orabridge',
    description: 'Client web per database Oracle: fogli SQL, esplorazione schema, DDL guidato.',
    lang: 'it',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#1e1f22',
    theme_color: '#1e1f22',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    // Solo l'app shell (JS/CSS/HTML/icone) viene precaricata: le chiamate a /api
    // vanno sempre in rete, mai servite dalla cache (dati DB live).
    navigateFallbackDenylist: [/^\/api\//],
  },
});

export default defineConfig({
  plugins: [react(), ...(isDesktop ? [] : [pwaPlugin])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      // Host e Origin riscritti su quelli dell'API: il server rifiuta le
      // richieste con un Host che non è il loopback (DNS rebinding) e le
      // scritture cross-site, e senza questo le vedrebbe arrivare da :5173.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        headers: { origin: 'http://localhost:3000' },
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
