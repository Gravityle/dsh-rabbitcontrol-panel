/**
 * RabbitControl 控制台 —— Host 半边。
 *
 * 提供两件事：
 *  1. 面板用的同源 HTTP 路由 `POST /rabbitcontrol/api`，由它去调 rc-server 的 REST。
 *  2. 三个只读 agent 工具：`rc_health` / `rc_devices` / `rc_sessions`。
 *
 * 只用 node: 内置模块，不引入任何第三方依赖。rc-server 的 access/refresh token
 * 存在 credentials 记录里，不写进配置，也不进对话。
 */
import z from '@deepseek-ai/schemastery'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export const inject = ['tools', 'webServer']


/** 面板路由：与 Web GUI 同源，浏览器侧直接 fetch，规避 CORS 与自签证书问题。 */
const ROUTE_PATH = '/rabbitcontrol/api'
/** credentials 记录键，形如 `<owner>/<id>`。 */
const CREDENTIAL_KEY = 'dsh-rabbitcontrol/session'
const DEFAULT_BASE_URL = ''   // 留空：面板里填自己的 rc-server 地址
const REQUEST_TIMEOUT_MS = 8000
const MAX_BODY_BYTES = 64 * 1024
/** access token 剩余寿命低于此值时先刷新。 */
const REFRESH_MARGIN_MS = 30_000
const MAX_DEVICE_ROWS = 50

/**
 * 插件行配置：导出 schema 后，插件行里的字段会被校验，并能在设置里按字段编辑。
 * 默认值与下面的常量保持一致。
 */
export const Config = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL).description('rc-server 的 REST 地址'),
  insecureTls: z.boolean().default(true).description('接受自签证书；仅对本机/内网自签部署打开'),
})

/** 当前生效的设置；`setBaseUrl` 可改 baseUrl。 */
let settings = { baseUrl: DEFAULT_BASE_URL, insecureTls: true }
/** 内存会话缓存；`undefined` 表示尚未从 credentials 读过。 */
let session

/** 可控失败：路由把它翻成结构化错误响应。 */
class PanelError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/**
 * 归一化 rc-server 地址。
 * @param value - 用户或配置给的地址。
 * @returns 去掉尾部斜杠的 `http(s)://host[:port]`，或 undefined。
 */
function normalizeBaseUrl(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) return undefined
  try {
    const url = new URL(trimmed)
    return `${url.protocol}//${url.host}`
  } catch {
    return undefined
  }
}

/**
 * 向 rc-server 发一次 JSON 请求。
 * @param path - 以 `/api/v1/...` 开头的路径。
 * @param options - method / token / JSON body / 超时。
 * @returns 状态码、解析后的 JSON（若有）与原始文本。
 */
function rcRequest(path, options = {}) {
  const { method = 'GET', token, body, timeoutMs = REQUEST_TIMEOUT_MS } = options
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(path, `${settings.baseUrl}/`)
    } catch {
      reject(new PanelError('invalid_base_url', `rc-server 地址无效：${settings.baseUrl}`))
      return
    }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
    const secure = url.protocol === 'https:'
    const transport = secure ? httpsRequest : httpRequest
    const headers = { accept: 'application/json' }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(payload.length)
    }
    if (typeof token === 'string' && token !== '') headers.authorization = `Bearer ${token}`
    const req = transport({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port === '' ? undefined : url.port,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      timeout: timeoutMs,
      ...(secure ? { rejectUnauthorized: !settings.insecureTls } : {}),
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => { chunks.push(chunk) })
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json
        try {
          json = text === '' ? undefined : JSON.parse(text)
        } catch {
          json = undefined
        }
        resolve({ status: res.statusCode ?? 0, json, text })
      })
    })
    req.on('timeout', () => { req.destroy(new Error(`请求超时（${timeoutMs}ms）`)) })
    req.on('error', (error) => { reject(error instanceof Error ? error : new Error(String(error))) })
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/**
 * 把一次调用的失败原因压成一句人话。
 * @param res - rcRequest 的结果，或 undefined。
 * @returns 可直接展示的原因。
 */
function describeFailure(res) {
  if (res === undefined) return '没有响应'
  if (typeof res.transportError === 'string' && res.transportError !== '') return res.transportError
  const message = res.json?.message
  if (typeof message === 'string' && message !== '') return message
  const error = res.json?.error
  if (typeof error === 'string' && error !== '') return error
  const text = typeof res.text === 'string' ? res.text.trim() : ''
  if (text !== '') return text.slice(0, 200)
  return `HTTP ${res.status}`
}

/**
 * 同 rcRequest，但把传输层失败折成可判定的结果。
 * @param path - 请求路径。
 * @param options - 同 rcRequest。
 * @returns 结果对象，失败时带 transportError。
 */
async function safeRequest(path, options) {
  try {
    return await rcRequest(path, options)
  } catch (error) {
    return { status: 0, json: undefined, text: '', transportError: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 取得 credentials 服务（可能不存在）。
 * @returns credentials 服务，或 undefined。
 */
function credentialsOf(ctx) {
  try {
    return ctx.get('credentials')
  } catch {
    return undefined
  }
}

/**
 * 读回已保存的 rc-server 会话。
 * @returns 会话对象，或 null。
 */
async function loadSession(ctx) {
  if (session !== undefined) return session
  const credentials = credentialsOf(ctx)
  if (credentials === undefined) {
    session = null
    return session
  }
  try {
    const record = await credentials.readRecord(CREDENTIAL_KEY)
    const payload = record?.kind === 'grant' ? record.payload : undefined
    session = payload !== null && typeof payload === 'object' && typeof payload.accessToken === 'string'
      ? { ...payload }
      : null
  } catch {
    session = null
  }
  return session
}

/**
 * 覆盖或清除保存的会话。
 * @param next - 新会话，或 null 表示登出。
 */
async function saveSession(ctx, next) {
  session = next
  const credentials = credentialsOf(ctx)
  if (credentials === undefined) return
  if (next === null) {
    await credentials.deleteRecord(CREDENTIAL_KEY)
    return
  }
  await credentials.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'grant', payload: { ...next } }))
}

/**
 * 取得可用的 access token，必要时先刷新。
 * @returns 会话对象，或 null（未登录 / 已失效）。
 */
async function activeIdentity(ctx) {
  const current = await loadSession(ctx)
  if (current === null) return null
  if (typeof current.accessToken === 'string' && typeof current.expiresAt === 'number'
    && current.expiresAt - Date.now() > REFRESH_MARGIN_MS) return current
  if (typeof current.refreshToken !== 'string' || current.refreshToken === '') {
    await saveSession(ctx, null)
    return null
  }
  const res = await safeRequest('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: current.refreshToken } })
  if (res.status === 200 && typeof res.json?.access_token === 'string') {
    const next = {
      accessToken: res.json.access_token,
      refreshToken: typeof res.json.refresh_token === 'string' ? res.json.refresh_token : current.refreshToken,
      email: res.json.user?.email ?? current.email,
      role: res.json.user?.role ?? current.role,
      expiresAt: Date.now() + (typeof res.json.expires_in_sec === 'number' ? res.json.expires_in_sec : 900) * 1000,
    }
    await saveSession(ctx, next)
    return next
  }
  await saveSession(ctx, null)
  return null
}

/**
 * 读一次 rc-server 的 GET 接口。
 * @param ctx - Host 上下文。
 * @param path - `/api/v1/...`。
 * @returns 解析后的 JSON。
 * @throws 未登录或 rc-server 报错时抛出可读原因。
 */
async function readForTool(ctx, path) {
  const identity = await activeIdentity(ctx)
  if (identity === null) {
    throw new Error(`尚未登录 rc-server（${settings.baseUrl}）：请打开右侧栏的 RabbitControl 面板并登录`)
  }
  const res = await safeRequest(path, { token: identity.accessToken })
  if (res.status !== 200) throw new Error(`rc-server 返回失败：${describeFailure(res)}`)
  return res.json
}

/** 组装面板要的一份快照：健康、统计、设备、会话。 */
async function buildOverview(ctx) {
  const identity = await activeIdentity(ctx)
  const base = {
    baseUrl: settings.baseUrl,
    insecureTls: settings.insecureTls,
    authorized: identity !== null,
    email: identity?.email,
    role: identity?.role,
    fetchedAt: Date.now(),
  }
  if (identity === null) {
    // 未登录也要探一次公开的 health，否则用户分不清「服务器连不上」与「只是还没登录」。
    const probe = await safeRequest('/api/v1/health')
    const reachable = probe.status === 200
    return {
      ...base,
      reachable,
      version: reachable ? probe.json?.version : undefined,
      healthError: reachable ? undefined : describeFailure(probe),
    }
  }
  const token = identity.accessToken
  const [health, stats, devices, sessions] = await Promise.all([
    safeRequest('/api/v1/health', { token }),
    safeRequest('/api/v1/stats', { token }),
    safeRequest('/api/v1/devices', { token }),
    safeRequest('/api/v1/sessions', { token }),
  ])
  if (health.status === 401 || stats.status === 401) {
    await saveSession(ctx, null)
    return { ...base, authorized: false, notice: '登录已过期，请重新登录' }
  }
  const deviceList = Array.isArray(devices.json?.devices) ? devices.json.devices : undefined
  const sessionList = Array.isArray(sessions.json?.sessions) ? sessions.json.sessions : undefined
  return {
    ...base,
    health: health.status === 200
      ? {
        status: health.json?.status,
        version: health.json?.version,
        tlsEnabled: health.json?.tls_enabled === true,
        relayEngine: health.json?.relay_engine,
        uptimeSec: health.json?.uptime_sec,
        caFingerprint: health.json?.ca_fingerprint_sha256,
      }
      : undefined,
    healthError: health.status === 200 ? undefined : describeFailure(health),
    stats: stats.status === 200
      ? {
        onlineCount: stats.json?.online_count,
        registeredCount: stats.json?.registered_count,
        activeRelaySessions: stats.json?.active_relay_sessions,
        totalRelaySessions: stats.json?.total_relay_sessions,
      }
      : undefined,
    statsError: stats.status === 200 ? undefined : describeFailure(stats),
    devices: deviceList === undefined ? undefined : deviceList.slice(0, MAX_DEVICE_ROWS).map((row) => ({
      deviceId: row?.device_id,
      alias: row?.alias ?? '',
      hostname: row?.hostname ?? '',
      os: row?.os ?? '',
      online: row?.online === true,
      inSession: row?.in_session === true,
      status: row?.status ?? '',
    })),
    devicesTotal: deviceList?.length,
    devicesError: deviceList === undefined ? describeFailure(devices) : undefined,
    sessions: sessions.status === 200
      ? {
        total: typeof sessions.json?.total === 'number' ? sessions.json.total : (sessionList?.length ?? 0),
      }
      : undefined,
    sessionsError: sessions.status === 200 ? undefined : describeFailure(sessions),
  }
}

/**
 * 面板操作分派。
 * @param op - 操作名。
 * @param payload - 操作参数。
 * @returns 操作结果。
 */
async function handleOp(ctx, op, payload) {
  switch (op) {
    case 'overview':
      return buildOverview(ctx)
    case 'login': {
      const email = typeof payload.email === 'string' ? payload.email.trim() : ''
      const password = typeof payload.password === 'string' ? payload.password : ''
      if (email === '' || password === '') throw new PanelError('invalid_input', 'email and password are required')
      const res = await safeRequest('/api/v1/auth/login', { method: 'POST', body: { email, password } })
      if (res.status !== 200 || typeof res.json?.access_token !== 'string') {
        // 只回错误码 + 服务器原话，让 Client 用自己的语言包装。
        throw new PanelError('login_failed', describeFailure(res))
      }
      const next = {
        accessToken: res.json.access_token,
        refreshToken: typeof res.json.refresh_token === 'string' ? res.json.refresh_token : '',
        email: res.json.user?.email ?? email,
        role: res.json.user?.role ?? 'user',
        expiresAt: Date.now() + (typeof res.json.expires_in_sec === 'number' ? res.json.expires_in_sec : 900) * 1000,
      }
      if (res.json.user?.must_change_password === true) {
        // 受限 token 除了改密什么也做不了；保存它只会让面板进入「已登录但处处 403」的状态。
        return {
          authorized: false,
          mustChangePassword: true,
          email: next.email,
          role: next.role,
        }
      }
      await saveSession(ctx, next)
      return {
        authorized: true,
        email: next.email,
        role: next.role,
        mustChangePassword: false,
      }
    }
    case 'logout':
      await saveSession(ctx, null)
      return { authorized: false }
    case 'setBaseUrl': {
      const next = normalizeBaseUrl(payload.baseUrl)
      if (next === undefined) throw new PanelError('invalid_base_url', 'expected http(s)://host[:port]')
      let saved = false
      let note = '已在本进程内生效；没有可写的配置入口，重启后会恢复原值'
      const editor = ctx.get('configEditor')
      const entry = ctx.fiber?.entry
      if (editor !== undefined && entry !== undefined) {
        try {
          await editor.edit(entry, (current) => ({ ...current, baseUrl: next }))
          saved = true
          note = '已写入插件配置'
        } catch (error) {
          note = `未能写入插件配置：${error instanceof Error ? error.message : String(error)}`
        }
      }
      settings = { ...settings, baseUrl: next }
      await saveSession(ctx, null)
      return { baseUrl: next, saved, note }
    }
    default:
      throw new PanelError('unknown_op', `unknown operation: ${String(op)}`)
  }
}

/**
 * 读取请求体，带体积上限。
 * @param req - Node 请求。
 * @param limit - 字节上限。
 * @returns 请求体文本。
 */
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new PanelError('body_too_large', `请求体超过 ${limit} 字节`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/**
 * 写一个 JSON 响应。
 * @param res - Node 响应。
 * @param status - HTTP 状态码。
 * @param value - 响应对象。
 */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length) })
  res.end(body)
}

/**
 * 面板路由处理器：先过框架给「其它 Web 路由」用的宿主/来源 + 浏览器身份围栏，再做操作分派。
 * @param ctx - Host 上下文。
 * @param req - Node 请求。
 * @param res - Node 响应。
 */
async function routeHandler(ctx, req, res) {
  let connection
  try {
    connection = ctx.get('connection')
  } catch {
    connection = undefined
  }
  if (connection === undefined) {
    sendJson(res, 503, { ok: false, error: { code: 'no_connection_service', message: '当前 profile 没有 connection 服务，无法校验请求来源' } })
    return
  }
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) {
    res.writeHead(rejection)
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end('method not allowed')
    return
  }
  try {
    const raw = await readBody(req)
    let parsed
    try {
      parsed = raw === '' ? {} : JSON.parse(raw)
    } catch {
      throw new PanelError('invalid_json', '请求体不是合法 JSON')
    }
    const data = await handleOp(ctx, parsed?.op, parsed ?? {})
    sendJson(res, 200, { ok: true, data })
  } catch (error) {
    const code = error instanceof PanelError ? error.code : 'internal_error'
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 200, { ok: false, error: { code, message } })
  }
}

/** 空参数对象：三个工具都不接参数。 */
const NO_PARAMETERS = { type: 'object', properties: {}, additionalProperties: false }

/**
 * 造一个只读工具：共享取数、校验与渲染骨架。
 * @param spec - 名称、描述、输出 schema、取数与摘要函数。
 * @returns ToolDefinition。
 */
function readOnlyTool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: NO_PARAMETERS,
    output: {
      schema: spec.outputSchema,
      render: (_args, value) => [{ type: 'text', text: spec.summarize(value) }],
    },
    async execute() {
      return spec.read()
    },
  }
}

export function apply(ctx, config = {}) {
  const configuredBaseUrl = normalizeBaseUrl(config.baseUrl)
  settings = {
    baseUrl: configuredBaseUrl ?? DEFAULT_BASE_URL,
    insecureTls: config.insecureTls !== false,
  }
  session = undefined

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: (req, res) => { void routeHandler(ctx, req, res) },
    }),
    'rabbitcontrol: panel route',
  )

  const health = readOnlyTool({
    name: 'rc_health',
    description: '读取 RabbitControl 服务器的健康与运行指标（版本、在线/注册设备数、中继引擎、TLS）。只读。',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string' },
        version: { type: 'string' },
        onlineCount: { type: 'integer' },
        registeredCount: { type: 'integer' },
        relayEngine: { type: 'string' },
        tlsEnabled: { type: 'boolean' },
        uptimeSec: { type: 'integer' },
      },
      required: ['status', 'version', 'onlineCount', 'registeredCount', 'relayEngine', 'tlsEnabled', 'uptimeSec'],
    },
    summarize: (value) => `RabbitControl ${value.version}：${value.status}，在线 ${value.onlineCount} / 已注册 ${value.registeredCount}，中继 ${value.relayEngine}，TLS ${value.tlsEnabled ? '开' : '关'}，已运行 ${value.uptimeSec}s`,
    read: async () => {
      // 设备数在 /stats，不在 /health：两个都取，否则会把 0 当成真实注册数报出去。
      const [health, stats] = await Promise.all([
        readForTool(ctx, '/api/v1/health'),
        readForTool(ctx, '/api/v1/stats'),
      ])
      return {
        status: String(health?.status ?? 'unknown'),
        version: String(health?.version ?? 'unknown'),
        onlineCount: Number(stats?.online_count ?? 0),
        registeredCount: Number(stats?.registered_count ?? 0),
        relayEngine: String(health?.relay_engine ?? 'unknown'),
        tlsEnabled: health?.tls_enabled === true,
        uptimeSec: Number(health?.uptime_sec ?? 0),
      }
    },
  })

  const devices = readOnlyTool({
    name: 'rc_devices',
    description: '列出 RabbitControl 服务器上已注册的设备及其在线状态与设备码。只读。',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        total: { type: 'integer' },
        online: { type: 'integer' },
        devices: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              alias: { type: 'string' },
              os: { type: 'string' },
              status: { type: 'string' },
            },
            required: ['id', 'alias', 'os', 'status'],
          },
        },
      },
      required: ['total', 'online', 'devices'],
    },
    summarize: (value) => (value.devices.length === 0
      ? `没有已注册设备（共 ${value.total}）`
      : `共 ${value.total} 台，在线 ${value.online}：\n${value.devices.map((d) => `- ${d.id}${d.alias === '' ? '' : ` ${d.alias}`}（${d.os === '' ? '未知系统' : d.os}）${d.status}`).join('\n')}`),
    read: async () => {
      const json = await readForTool(ctx, '/api/v1/devices')
      const rows = Array.isArray(json?.devices) ? json.devices : []
      const mapped = rows.slice(0, MAX_DEVICE_ROWS).map((row) => ({
        id: String(row?.device_id ?? ''),
        alias: String(row?.alias ?? ''),
        os: String(row?.os ?? ''),
        status: row?.online === true ? '在线' : '离线',
      }))
      return {
        total: rows.length,
        online: rows.filter((row) => row?.online === true).length,
        devices: mapped,
      }
    },
  })

  const sessions = readOnlyTool({
    name: 'rc_sessions',
    description: '列出 RabbitControl 服务器上正在进行的中继会话数量。只读。',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { total: { type: 'integer' } },
      required: ['total'],
    },
    summarize: (value) => `当前中继会话：${value.total} 个`,
    read: async () => {
      const json = await readForTool(ctx, '/api/v1/sessions')
      const rows = Array.isArray(json?.sessions) ? json.sessions : []
      return { total: typeof json?.total === 'number' ? json.total : rows.length }
    },
  })

  ctx.effect(() => ctx.tools.register(health), 'rabbitcontrol: rc_health')
  ctx.effect(() => ctx.tools.register(devices), 'rabbitcontrol: rc_devices')
  ctx.effect(() => ctx.tools.register(sessions), 'rabbitcontrol: rc_sessions')
}
