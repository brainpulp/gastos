import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// CAP_BUILD=1 builds for Capacitor (native app loads from file://, needs relative base).
// Default build targets GitHub Pages under /gastos/.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  base: process.env.CAP_BUILD ? './' : '/gastos/',
})
