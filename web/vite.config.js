import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages sirve este repo en /Planta-Osmosis/, no en la raíz;
  // en desarrollo local se mantiene en / para no romper el preview.
  base: command === 'build' ? '/Planta-Osmosis/' : '/',
  build: { outDir: 'dist' },
}))
