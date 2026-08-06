import { startServer } from './index'

startServer().catch(error => {
  console.error('[FORGE UI] Control plane failed to start:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
