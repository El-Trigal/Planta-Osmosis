import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command }) => {
  const base = command === 'build' ? '/Planta-Osmosis/' : '/'
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: { enabled: true },
        // Solo precachea los assets del build (JS/CSS/HTML). Sin
        // runtimeCaching: las llamadas a Supabase no deben servirse
        // cacheadas, siempre tienen que ir a la red.
        manifest: {
          name: 'Monitoreo Ósmosis Inversa',
          short_name: 'Ósmosis Inversa',
          description: 'Monitoreo diario de planta de ósmosis inversa',
          theme_color: '#0369a1',
          background_color: '#ffffff',
          start_url: base,
          scope: base,
          display: 'standalone',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    // GitHub Pages sirve este repo en /Planta-Osmosis/, no en la raíz;
    // en desarrollo local se mantiene en / para no romper el preview.
    base,
    build: { outDir: 'dist' },
  }
})
