// Minimal vitest runner that exits when done — avoids the CLI's watch hang.
import { startVitest } from 'vitest/node'

const files = process.argv.slice(2)
const ctx = await startVitest('test', files.length ? files : undefined, {
  run: true,
  reporters: ['default'],
  pool: 'forks',
  poolOptions: { forks: { singleFork: true, isolate: false } },
  coverage: { enabled: false },
})

// Count failures across all projects/files
let failed = 0
const state = ctx.state
for (const file of state.getFiles()) {
  for (const task of file.tasks) {
    if (task.mode === 'skip' || task.mode === 'todo') continue
    if (task.result?.state === 'fail') failed++
  }
  if (file.result?.state === 'fail') failed++
}
await ctx.close()
process.exit(failed > 0 ? 1 : 0)
