const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const { HuaqiFEWebpackPlugin } = require('huaqi-FE-tracer/webpack')

/** @type {import('webpack').Configuration & { devServer?: any }} */
module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  resolve: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
  module: {
    rules: [
      {
        test: /\.[mc]?[tj]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { browsers: 'last 2 chrome versions' } }],
              '@babel/preset-typescript',
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
    ],
  },
  plugins: [new HtmlWebpackPlugin({ template: './index.html' }), new HuaqiFEWebpackPlugin()],
  devServer: {
    port: 5184,
    hot: true,
    setupMiddlewares(middlewares, ctx) {
      middlewares.push({ path: '/health', middleware: (req, res) => res.end('ok') })
      return middlewares
    },
  },
}
