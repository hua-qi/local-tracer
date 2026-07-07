import type { Plugin, ViteDevServer } from 'vite'
import { rmSync } from 'node:fs'
import { loadConfig, buildMatcherIndex, type TraceConfig } from '../core/config'
import { inject } from '../core/ast-injector'
import { createTracerMiddleware } from '../core/middleware'

export interface HuaqiFEVitePluginOptions {
  /** Override the project root used to locate .agent/tracer.config.json (default: process.cwd()). */
  root?: string
}

const JS_EXT_RE = /\.[mc]?[tj]sx?$/

export function huaqiFEVitePlugin(options: HuaqiFEVitePluginOptions = {}): Plugin {
  const root = options.root ?? process.cwd()
  let config: TraceConfig = loadConfig(root)
  let logCleared = false

  function reloadConfig() {
    config = loadConfig(root)
  }

  function clearLogsOnce() {
    if (logCleared) return
    logCleared = true
    try {
      rmSync(config.log.dir, { recursive: true, force: true })
    } catch {
      // ignore — directory may not exist
    }
  }

  return {
    name: '@toft/local-tracer',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const cfg = loadConfig(root)
        createTracerMiddleware({ logDir: cfg.log.dir })(req, res, next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const cfg = loadConfig(root)
        createTracerMiddleware({ logDir: cfg.log.dir })(req, res, next)
      })
    },
    buildStart() {
      reloadConfig()
      clearLogsOnce()
    },
    transform(code, id) {
      if (id.includes('/node_modules/') || id.includes('\\node_modules\\')) return null
      if (!JS_EXT_RE.test(id)) return null
      const index = buildMatcherIndex(config)
      if (index.size === 0) return null
      const result = inject(code, index)
      if (!result.hasInjection) return null
      return { code: result.code, map: null }
    },
  }
}
