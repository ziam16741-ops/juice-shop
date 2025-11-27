// app.js
/*
 * Hardened startup for Juice Shop style app
 * - safer error handling (no raw throw)
 * - graceful shutdown handlers
 * - optional runtime npm-audit enforcement via ENV: ENFORCE_AUDIT=true
 * - small startup timeout to avoid hanging forever
 */

import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Optional: run `npm audit --json` at startup when ENFORCE_AUDIT=true.
 * Useful for CI-like enforcement on developer machines, but avoid enabling by default in production.
 */
function runOptionalAuditCheck () {
  try {
    if (process.env.ENFORCE_AUDIT !== 'true') return { ok: true, message: 'audit skipped' }

    // run audit synchronously so startup fails fast when vulnerabilities exist
    const res = spawnSync('npm', ['audit', '--json', '--production'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })

    if (res.error) {
      // Failed to run npm — return a clear reason but don't leak internals
      return { ok: false, message: 'Failed to execute npm audit', details: res.error.message }
    }

    if (!res.stdout) {
      return { ok: true, message: 'no audit output' }
    }

    const audit = JSON.parse(res.stdout)
    const totalVulns = (audit.metadata && (audit.metadata.vulnerabilities && Object.values(audit.metadata.vulnerabilities).reduce((a, b) => a + b, 0))) || 0

    if (totalVulns > 0) {
      return { ok: false, message: `npm audit found ${totalVulns} vulnerabilities` }
    }

    return { ok: true, message: 'npm audit passed' }
  } catch (err) {
    return { ok: false, message: 'audit check failed', details: String(err) }
  }
}

function niceErrorLog (err) {
  // Print useful debugging info but avoid leaking secrets; full stack printed only when DEBUG=true
  console.error('[STARTUP ERROR]', err && err.message ? err.message : String(err))
  if (process.env.DEBUG === 'true') {
    console.error(err && err.stack ? err.stack : '')
  } else {
    console.error('Set DEBUG=true to see stack trace.')
  }
}

let serverInstance = null
let shuttingDown = false

async function startServerWithTimeout (serverModule, timeoutMs = 30000) {
  const startPromise = serverModule.start()
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Server start timed out')), timeoutMs)
  })
  return Promise.race([startPromise, timeoutPromise])
}

async function app () {
  // run optional npm audit enforcement (controlled by ENV)
  const auditResult = runOptionalAuditCheck()
  if (!auditResult.ok) {
    throw new Error(`Startup blocked: ${auditResult.message}`)
  }

  // basic dependency validation (keeps original behavior)
  const validatePath = path.join(__dirname, 'lib', 'startup', 'validateDependenciesBasic.js')
  const validateModule = await import(validatePath).catch(err => {
    throw new Error('Failed to load dependency validator')
  })
  const validateDependencies = validateModule.default || validateModule.validateDependencies || validateModule

  await validateDependencies()

  // import server module
  const server = await import('./server.js').catch(() => {
    throw new Error('Failed to load server module')
  })

  // start server with a timeout to prevent indefinite hang
  await startServerWithTimeout(server, Number(process.env.STARTUP_TIMEOUT_MS) || 30000)
  serverInstance = server
  console.log('[SERVER] started')
}

// Global uncaught handlers to avoid silent crashes
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason && reason.toString ? reason.toString() : reason)
  // Prefer graceful shutdown rather than crashing with unhandled rejection (configurable)
  if (process.env.CRASH_ON_UNHANDLED_REJECTION === 'true') {
    process.exit(1)
  }
})

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err && err.message ? err.message : String(err))
  if (process.env.CRASH_ON_UNCAUGHT_EXCEPTION === 'true') {
    // if configured, exit to let process supervisor restart
    process.exit(1)
  }
  // otherwise continue (not recommended unless you know what you're doing)
})

// Graceful shutdown helpers
async function shutdown (signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[SHUTDOWN] Received ${signal}, shutting down gracefully...`)
  try {
    if (serverInstance && typeof serverInstance.stop === 'function') {
      await serverInstance.stop()
      console.log('[SHUTDOWN] server.stop() completed')
    }
  } catch (err) {
    console.error('[SHUTDOWN ERROR]', err && err.message ? err.message : String(err))
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// Start app with controlled error handling
app()
  .catch(err => {
    niceErrorLog(err)
    // fail fast — non-zero exit so CI/containers know startup failed
    process.exit(1)
  })
