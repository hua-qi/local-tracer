import type { Compiler, Compilation } from 'webpack'
import webpack from 'webpack'
import { rmSync } from 'node:fs'
import {
  loadConfig,
  buildMatcherIndex,
  type TraceConfig,
  type MatcherIndex,
} from '../core/config'
import { inject } from '../core/ast-injector'
import { createTracerMiddleware } from '../core/middleware'

export interface HuaqiFEWebpackPluginOptions {
  /** Override the project root used to locate .agent/tracer.config.json (default: process.cwd()). */
  root?: string
}

const JS_EXT_RE = /\.[mc]?[tj]sx?$/

interface WebpackDevServerOptions {
  setupMiddlewares?: (middlewares: any[], devServerCtx: any) => any[]
}

export class HuaqiFEWebpackPlugin {
  private readonly root: string
  private config: TraceConfig
  private index: MatcherIndex
  private logCleared = false
  private middlewareAttached = false
  private hasDevServer = false

  constructor(options: HuaqiFEWebpackPluginOptions = {}) {
    this.root = options.root ?? process.cwd()
    this.config = loadConfig(this.root)
    this.index = buildMatcherIndex(this.config)
  }

  apply(compiler: Compiler): void {
    const pluginName = 'HuaqiFETracerPlugin'

    const self = this
    const tracerMiddleware = createTracerMiddleware({ logDir: this.config.log.dir })

    const devServer = (compiler.options as unknown as { devServer?: WebpackDevServerOptions })
      .devServer
    if (devServer) {
      this.hasDevServer = true
    }

    // Inject the /rt middleware even if the user did not declare setupMiddlewares
    // themselves. webpack-dev-server reads `compiler.options.devServer.setupMiddlewares`
    // at startup, so wrapping here is sufficient.
    if (devServer && typeof devServer.setupMiddlewares === 'function') {
      const original = devServer.setupMiddlewares
      devServer.setupMiddlewares = function (middlewares: any[], ctx: any) {
        if (!self.middlewareAttached) {
          self.middlewareAttached = true
          middlewares.unshift({
            name: 'huaqi-fe-tracer',
            middleware: tracerMiddleware,
          })
        }
        return original.call(this, middlewares, ctx)
      }
    } else if (devServer) {
      const devServerAny = devServer as WebpackDevServerOptions & {
        setupMiddlewares?: (m: any[], ctx: any) => any[]
      }
      devServerAny.setupMiddlewares = function (middlewares: any[], ctx: any) {
        if (!self.middlewareAttached) {
          self.middlewareAttached = true
          middlewares.unshift({
            name: 'huaqi-fe-tracer',
            middleware: tracerMiddleware,
          })
        }
        return middlewares
      }
    }

    compiler.hooks.watchRun.tap(pluginName, () => {
      this.config = loadConfig(this.root)
      this.index = buildMatcherIndex(this.config)
      if (!this.logCleared) {
        this.logCleared = true
        try {
          rmSync(this.config.log.dir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    })

    compiler.hooks.thisCompilation.tap(pluginName, (compilation: Compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: pluginName,
          stage: webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        (assets) => {
          if (!this.hasDevServer || this.index.size === 0) return
          for (const name of Object.keys(assets)) {
            if (!JS_EXT_RE.test(name)) continue
            const source = assets[name].source()
            if (typeof source !== 'string') continue
            const result = inject(source, this.index)
            if (!result.hasInjection) continue
            const { sources } = webpack
            compilation.updateAsset(name, new sources.RawSource(result.code))
          }
        },
      )
    })
  }
}
