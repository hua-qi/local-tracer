import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { huaqiFEVitePlugin } from 'huaqi-FE-tracer/vite'

// `root` is resolved relative to this file so the plugin finds
// .agent/tracer.config.json no matter where `vite` is invoked from.
const root = import.meta.dirname

export default defineConfig({
  root,
  plugins: [react(), huaqiFEVitePlugin({ root })],
})
