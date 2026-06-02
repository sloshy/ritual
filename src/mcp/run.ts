import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { buildMcpServer } from './server'
import { divertConsoleLogToStderr } from './stdout-guard'

/** Run the MCP server over stdio (the default transport for local agent clients). */
export async function runStdioServer(): Promise<void> {
  divertConsoleLogToStderr()
  const server = buildMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

export interface HttpServerOptions {
  port: number
  host: string
  /** When set, requests must carry `Authorization: Bearer <token>`. */
  token?: string
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function rpcError(id: null, code: number, message: string): unknown {
  return { jsonrpc: '2.0', error: { code, message }, id }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Handle one Streamable-HTTP request. A POST carrying an `initialize` message
 * spins up a fresh transport + server and registers it under the generated
 * session ID; subsequent POST/GET/DELETE requests are routed by the
 * `Mcp-Session-Id` header. GET opens the SSE stream; DELETE ends the session.
 */
async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  transports: Map<string, StreamableHTTPServerTransport>,
  token: string | undefined,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname !== '/mcp') {
    writeJson(res, 404, { error: 'Not found. Use the /mcp endpoint.' })
    return
  }
  if (token && headerValue(req.headers.authorization) !== `Bearer ${token}`) {
    writeJson(res, 401, rpcError(null, -32001, 'Unauthorized'))
    return
  }

  const sessionId = headerValue(req.headers['mcp-session-id'])

  if (req.method === 'POST') {
    const raw = await readBody(req)
    const body: unknown = raw.length > 0 ? JSON.parse(raw) : undefined
    const existing = sessionId ? transports.get(sessionId) : undefined
    if (existing) {
      await existing.handleRequest(req, res, body)
      return
    }
    if (!isInitializeRequest(body)) {
      writeJson(
        res,
        400,
        rpcError(null, -32000, 'No valid session ID; send an initialize request first.'),
      )
      return
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id) transports.delete(id)
    }
    const server = buildMcpServer()
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
    // The session ID is assigned while handling the initialize request above.
    const id = transport.sessionId
    if (id) {
      transports.set(id, transport)
    } else {
      console.error('MCP HTTP: no session ID assigned after initialize; dropping transport.')
    }
    return
  }

  if (req.method === 'GET' || req.method === 'DELETE') {
    const transport = sessionId ? transports.get(sessionId) : undefined
    if (!transport) {
      writeJson(res, 400, { error: 'Unknown or missing Mcp-Session-Id.' })
      return
    }
    await transport.handleRequest(req, res)
    return
  }

  writeJson(res, 405, { error: 'Method not allowed.' })
}

/**
 * Run the MCP server over Streamable HTTP at `http://<host>:<port>/mcp`. Binds to
 * localhost by default; set a bearer token (and an exposed host) only when you
 * intend remote clients to connect. Resolves to the listening server so callers
 * (and tests) can read its address and shut it down; the process stays alive on
 * the open server regardless.
 */
export async function runHttpServer(options: HttpServerOptions): Promise<Server> {
  const { port, host, token } = options
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res, transports, token).catch((error: unknown) => {
      console.error('MCP HTTP request failed:', error)
      if (!res.headersSent) {
        writeJson(res, 500, rpcError(null, -32603, 'Internal server error'))
      }
    })
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, resolve)
  })
  const address = httpServer.address()
  const boundPort = typeof address === 'object' && address ? address.port : port
  console.error(`Ritual MCP server (HTTP) listening at http://${host}:${boundPort}/mcp`)
  return httpServer
}
