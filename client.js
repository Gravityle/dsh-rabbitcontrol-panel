/**
 * RabbitControl 控制台 —— Client 半边。
 *
 * 在右侧栏注册一个 `rabbitcontrol` 页类型：展示 rc-server 的健康、设备与会话，
 * 并在未登录时提供登录表单。所有数据都来自同源的 `/rabbitcontrol/api`（Host 半边）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-rabbitcontrol-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'rabbitcontrol'
    const ID = 'dsh-rabbitcontrol-panel'
    const KIND = 'rabbitcontrol'
    const ENDPOINT = '/rabbitcontrol/api'
    /** 轮询间隔；页面隐藏时暂停，回到前台立即补一次。 */
    const POLL_MS = 15000
    const FENCE_401 = 'host-fence-401'
    /** Host 错误码 → locale key，避免把中文错误文案直出到英文界面。 */
    const HOST_ERROR_KEYS = {
      invalid_input: 'errInvalidInput',
      login_failed: 'errLoginFailed',
      invalid_base_url: 'errInvalidBaseUrl',
      unknown_op: 'errUnknownOperation',
      invalid_json: 'errBadRequest',
      body_too_large: 'errBadRequest',
      no_connection_service: 'fenceError',
    }

    const ZH = {
      title: 'RabbitControl 服务器状态',
      description: '查看 rc-server 的健康、设备与会话；未登录时在此登录。',
      refresh: '刷新',
      loading: '读取中…',
      signingIn: '登录中…',
      server: '服务器',
      change: '修改地址',
      save: '保存',
      cancel: '取消',
      signIn: '登录',
      signOut: '退出登录',
      email: '邮箱',
      password: '密码',
      passwordHint: '密码只用于换取 token，不会保存',
      signedInAs: '已登录',
      health: '服务健康',
      version: '版本',
      uptime: '已运行',
      relay: '中继引擎',
      tls: 'TLS',
      online: '在线设备',
      registered: '已注册',
      relaySessions: '中继会话',
      devices: '设备',
      noDevices: '还没有已注册设备',
      unauthorized: '未登录到 rc-server',
      unreachable: '连不上 rc-server',
      hostError: '面板接口调用失败',
      fenceError: '面板接口拒绝了这次请求（浏览器身份未通过）。刷新页面后重试。',
      footer: '只读视图',
      updatedAt: '更新于',
      seconds: '秒',
      minutes: '分',
      hours: '小时',
      onlineLabel: '在线',
      offlineLabel: '离线',
      changePassword: '该账号需要先改密码：请先在管理控制台完成首次改密。',
      errInvalidInput: '请填写邮箱与密码',
      errLoginFailed: '登录失败',
      errInvalidBaseUrl: '地址必须是 http(s)://host[:port]',
      errUnknownOperation: '面板请求了未知操作',
      errBadRequest: '请求格式不合法',
      savedInMemory: '已在本次会话内生效（未能写入插件配置）。',
      savedToConfig: '已写入插件配置。',
    }
    const EN = {
      title: 'RabbitControl server status',
      description: 'Inspect rc-server health, devices and sessions; sign in here when needed.',
      refresh: 'Refresh',
      loading: 'Loading…',
      signingIn: 'Signing in…',
      server: 'Server',
      change: 'Change address',
      save: 'Save',
      cancel: 'Cancel',
      signIn: 'Sign in',
      signOut: 'Sign out',
      email: 'Email',
      password: 'Password',
      passwordHint: 'The password only buys a token and is never stored',
      signedInAs: 'Signed in',
      health: 'Server health',
      version: 'Version',
      uptime: 'Uptime',
      relay: 'Relay engine',
      tls: 'TLS',
      online: 'Online devices',
      registered: 'Registered',
      relaySessions: 'Relay sessions',
      devices: 'Devices',
      noDevices: 'No registered devices yet',
      unauthorized: 'Not signed in to rc-server',
      unreachable: 'Cannot reach rc-server',
      hostError: 'The panel endpoint failed',
      fenceError: 'The panel endpoint rejected this request (browser identity). Refresh the page and retry.',
      footer: 'Read-only view',
      updatedAt: 'Updated',
      seconds: 's',
      minutes: 'min',
      hours: 'h',
      onlineLabel: 'online',
      offlineLabel: 'offline',
      changePassword: 'This account must change its password first: finish the first-run change in the admin console.',
      errInvalidInput: 'Fill in both email and password',
      errLoginFailed: 'Sign-in failed',
      errInvalidBaseUrl: 'The address must be http(s)://host[:port]',
      errUnknownOperation: 'The panel asked for an unknown operation',
      errBadRequest: 'The request body was not valid',
      savedInMemory: 'Applied for this session only (the plugin config was not writable).',
      savedToConfig: 'Written to the plugin config.',
    }

    const CSS = [
      '.rcp-root{display:flex;flex-direction:column;gap:10px;padding:12px 12px 16px;font-size:var(--dsw-content-font-size-secondary,13px);color:var(--dsw-alias-label-primary);background:var(--dsw-specific-sidebar-fill);min-height:100%;box-sizing:border-box;overflow-y:auto}',
      '.rcp-bar{display:flex;align-items:center;gap:8px}',
      '.rcp-host{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.rcp-btn{flex:0 0 auto;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:4px;padding:3px 10px;font-size:12px;line-height:18px;cursor:pointer}',
      '.rcp-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}',
      '.rcp-btn:disabled{color:var(--dsw-alias-state-idle-primary);cursor:default}',
      '.rcp-btn:focus-visible,.rcp-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.rcp-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
      '.rcp-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:10px}',
      '.rcp-card-title{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-row{display:flex;align-items:baseline;gap:8px}',
      '.rcp-row-label{flex:0 0 84px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.rcp-row-value{flex:1 1 auto;min-width:0;word-break:break-all}',
      '.rcp-metrics{display:flex;gap:6px}',
      '.rcp-metric{flex:1 1 0;min-width:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);padding:6px 8px}',
      '.rcp-metric-value{font-size:16px;line-height:20px}',
      '.rcp-metric-label{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}',
      '.rcp-list{display:flex;flex-direction:column;gap:4px}',
      '.rcp-device{display:flex;align-items:center;gap:8px}',
      '.rcp-device-id{flex:0 0 auto;font-variant-numeric:tabular-nums}',
      '.rcp-device-meta{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.rcp-device-state{flex:0 0 auto;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-device-state-on{color:var(--dsw-alias-state-success-primary)}',
      '.rcp-form{display:flex;flex-direction:column;gap:8px}',
      '.rcp-field{display:flex;flex-direction:column;gap:4px}',
      '.rcp-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-input{border:1px solid var(--dsw-alias-border-l1);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:5px 8px;font-size:13px;font-family:inherit;width:100%;box-sizing:border-box}',
      '.rcp-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.rcp-actions{display:flex;align-items:center;gap:8px}',
      '.rcp-spacer{flex:1 1 auto}',
      '.rcp-error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--dsw-alias-label-primary);word-break:break-word}',
      '.rcp-notice{border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--dsw-alias-label-primary)}',
      '.rcp-empty{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.rcp-foot{color:var(--dsw-alias-label-secondary);font-size:11px;display:flex;gap:6px;flex-wrap:wrap}',
    ].join('')

    /** 面板内联样式；随组件挂载/卸载。 */
    function Styles() {
      return h('style', null, CSS)
    }

    /**
     * 面板用的图标：与包内 icon.svg 同一造型，供引导页卡片使用。
     * @returns SVG 元素。
     */
    function PanelIcon() {
      return h('svg', { viewBox: '0 0 36 36', width: 36, height: 36, 'aria-hidden': true, focusable: false },
        h('rect', { x: 4.5, y: 7, width: 21, height: 15, rx: 2.5, fill: 'none', stroke: 'currentColor', strokeWidth: 2 }),
        h('path', { d: 'M9 26h12', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
        h('path', { d: 'M15 22.4v3.2', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
        h('path', { d: 'M23.6 19.4l7.6 7.4-3.5.6 1.7 3.5-2 .9-1.7-3.5-2.4 2.4z', fill: 'currentColor' }),
        h('path', { d: 'M30.4 9.2a6.4 6.4 0 0 1 0 7.6', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.5 }))
    }

    /**
     * 调一次 Host 面板接口。
     * @param payload - `{ op, ... }`。
     * @returns Host 返回的 `{ ok, data }` 或 `{ ok:false, error }`。
     * @throws 面板路由本身不可用时抛出带 code 的错误。
     */
    async function callHost(payload) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const error = new Error(`panel endpoint HTTP ${String(response.status)}`)
        error.code = response.status === 401 ? FENCE_401 : 'host-http'
        throw error
      }
      return await response.json()
    }

    /**
     * 把失败翻成当前语言的一句话。
     * @param error - 抛出的错误。
     * @param t - 翻译函数。
     * @returns 展示文本。
     */
    function describeClientError(error, t) {
      if (error !== null && typeof error === 'object' && error.code === FENCE_401) return t('fenceError')
      return error instanceof Error ? error.message : String(error)
    }

    /**
     * Host 返回的错误对象翻成当前语言。
     * @param error - `{ code, message }`。
     * @param t - 翻译函数。
     * @returns 展示文本。
     */
    function localizeHostError(error, t) {
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      const detail = error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : ''
      const key = typeof code === 'string' ? HOST_ERROR_KEYS[code] : undefined
      if (key === undefined) return detail === '' ? t('hostError') : detail
      return detail === '' ? t(key) : `${t(key)}：${detail}`
    }

    /**
     * 把 uptime 秒数写成人话。
     * @param seconds - 秒。
     * @param t - 翻译函数。
     * @returns 展示文本。
     */
    function formatUptime(seconds, t) {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—'
      if (seconds < 120) return `${String(Math.round(seconds))} ${t('seconds')}`
      if (seconds < 7200) return `${String(Math.round(seconds / 60))} ${t('minutes')}`
      return `${String(Math.round(seconds / 3600))} ${t('hours')}`
    }

    /**
     * 把时间戳写成当前时区的时刻。
     * @param stamp - 毫秒时间戳。
     * @returns `HH:MM:SS`，无效时为 —。
     */
    function formatClock(stamp) {
      if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return '—'
      const date = new Date(stamp)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /**
     * 一行「标签 + 值」。
     * @param props - label 与 children。
     * @returns 该行元素。
     */
    function Row(props) {
      return h('div', { className: 'rcp-row' },
        h('span', { className: 'rcp-row-label' }, props.label),
        h('span', { className: 'rcp-row-value' }, props.children))
    }

    /**
     * 一个指标块。
     * @param props - value 与 label。
     * @returns 指标元素。
     */
    function Metric(props) {
      return h('div', { className: 'rcp-metric' },
        h('div', { className: 'rcp-metric-value' }, props.value),
        h('div', { className: 'rcp-metric-label' }, props.label))
    }

    /**
     * 服务器地址：就地编辑与保存。地址本身显示在顶栏，这里只放操作。
     * @param props - address、t、onSaved。
     * @returns 地址操作元素。
     */
    function AddressControl(props) {
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(props.address)
      const [note, setNote] = useState('')
      useEffect(() => { setDraft(props.address) }, [props.address])
      const save = useCallback(async () => {
        try {
          const result = await callHost({ op: 'setBaseUrl', baseUrl: draft })
          if (result.ok !== true) {
            setNote(localizeHostError(result.error, props.t))
            return
          }
          setNote(result.data.saved === true ? props.t('savedToConfig') : props.t('savedInMemory'))
          setEditing(false)
          await props.onSaved()
        } catch (error) {
          setNote(describeClientError(error, props.t))
        }
      }, [draft, props])
      if (!editing) {
        return h('div', { className: 'rcp-actions' },
          h('button', {
            className: 'rcp-btn', type: 'button',
            onClick: () => { setNote(''); setEditing(true) },
          }, props.t('change')),
          note === '' ? null : h('span', { className: 'rcp-hint' }, note))
      }
      return h('div', { className: 'rcp-form' },
        h('label', { className: 'rcp-field' },
          h('span', { className: 'rcp-field-label' }, props.t('server')),
          h('input', {
            className: 'rcp-input',
            value: draft,
            spellCheck: false,
            placeholder: 'https://127.0.0.1:21118',
            onChange: (event) => { setDraft(event.target.value) },
          })),
        h('div', { className: 'rcp-actions' },
          h('button', { className: 'rcp-btn rcp-btn-primary', type: 'button', onClick: () => { void save() } }, props.t('save')),
          h('button', { className: 'rcp-btn', type: 'button', onClick: () => { setEditing(false) } }, props.t('cancel'))),
        note === '' ? null : h('div', { className: 'rcp-hint' }, note))
    }

    /**
     * 未登录时的登录表单。
     * @param props - t、onSignedIn。
     * @returns 表单元素。
     */
    function SignInForm(props) {
      const [email, setEmail] = useState('')
      const [password, setPassword] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const submit = useCallback(async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        setNotice('')
        try {
          const result = await callHost({ op: 'login', email, password })
          if (result.ok !== true) {
            setError(localizeHostError(result.error, props.t))
            return
          }
          if (result.data.mustChangePassword === true) {
            setNotice(props.t('changePassword'))
            return
          }
          setPassword('')
          await props.onSignedIn()
        } catch (cause) {
          setError(describeClientError(cause, props.t))
        } finally {
          setBusy(false)
        }
      }, [email, password, props])
      return h('form', { className: 'rcp-card rcp-form', onSubmit: (event) => { void submit(event) } },
        h('div', { className: 'rcp-card-title' }, props.t('unauthorized')),
        h('label', { className: 'rcp-field' },
          h('span', { className: 'rcp-field-label' }, props.t('email')),
          h('input', {
            className: 'rcp-input', type: 'email', value: email, autoComplete: 'username',
            onChange: (event) => { setEmail(event.target.value) },
          })),
        h('label', { className: 'rcp-field' },
          h('span', { className: 'rcp-field-label' }, props.t('password')),
          h('input', {
            className: 'rcp-input', type: 'password', value: password, autoComplete: 'current-password',
            onChange: (event) => { setPassword(event.target.value) },
          })),
        h('div', { className: 'rcp-hint' }, props.t('passwordHint')),
        h('div', { className: 'rcp-actions' },
          h('button', {
            className: 'rcp-btn rcp-btn-primary', type: 'submit',
            disabled: busy || email === '' || password === '',
          }, busy ? props.t('signingIn') : props.t('signIn'))),
        error === '' ? null : h('div', { className: 'rcp-error' }, error),
        notice === '' ? null : h('div', { className: 'rcp-notice' }, notice))
    }

    /**
     * 设备列表卡片。
     * @param props - devices、total、t。
     * @returns 卡片元素。
     */
    function DevicesCard(props) {
      const { devices, total, t } = props
      return h('div', { className: 'rcp-card' },
        h('div', { className: 'rcp-card-title' }, `${t('devices')} (${String(total ?? devices.length)})`),
        devices.length === 0
          ? h('div', { className: 'rcp-empty' }, t('noDevices'))
          : h('div', { className: 'rcp-list' }, devices.map((device, index) => h('div', {
            className: 'rcp-device',
            key: `${String(device.deviceId)}-${String(index)}`,
          },
          h('span', { className: 'rcp-device-id' }, String(device.deviceId ?? '')),
          h('span', {
            className: 'rcp-device-meta',
            title: [device.alias, device.hostname, device.os].filter((part) => typeof part === 'string' && part !== '').join(' · '),
          }, [device.alias, device.os].filter((part) => typeof part === 'string' && part !== '').join(' · ')),
          h('span', {
            className: device.online === true ? 'rcp-device-state rcp-device-state-on' : 'rcp-device-state',
          }, device.online === true ? t('onlineLabel') : t('offlineLabel'))))))
    }

    /**
     * 面板正文。
     * @param props - 由右侧栏注入；本面板不使用 tab 信息。
     * @returns 面板元素。
     */
    function Panel(props) {
      const t = props.t
      const [data, setData] = useState(undefined)
      const [error, setError] = useState(null)
      const [refreshing, setRefreshing] = useState(false)
      const [loaded, setLoaded] = useState(false)
      const busy = useRef(false)
      const pending = useRef(false)
      const mounted = useRef(true)

      const load = useCallback(async () => {
        if (busy.current) {
          pending.current = true
          return
        }
        busy.current = true
        try {
          const result = await callHost({ op: 'overview' })
          if (!mounted.current) return
          if (result.ok !== true) {
            // 保留上一次的数据，只叠加错误条：一次瞬时失败不该清空面板。
            setError(result.error ?? { code: 'internal_error', message: '' })
            return
          }
          setError(null)
          setData(result.data)
        } catch (cause) {
          if (mounted.current) setError({ code: 'transport', message: describeClientError(cause, t) })
        } finally {
          busy.current = false
          if (mounted.current) {
            setRefreshing(false)
            setLoaded(true)
          }
          if (pending.current) {
            pending.current = false
            void load()
          }
        }
      }, [t])

      useEffect(() => {
        mounted.current = true
        void load()
        const timer = setInterval(() => { if (!document.hidden) void load() }, POLL_MS)
        const onVisible = () => { if (!document.hidden) void load() }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          mounted.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      const refresh = useCallback(() => {
        setRefreshing(true)
        void load()
      }, [load])

      const signOut = useCallback(async () => {
        try {
          await callHost({ op: 'logout' })
        } finally {
          await load()
        }
      }, [load])

      const current = data ?? {}
      const address = typeof current.baseUrl === 'string' ? current.baseUrl : '—'
      const children = [h(Styles, { key: 'styles' })]

      children.push(h('div', { className: 'rcp-bar', key: 'bar' },
        h('span', { className: 'rcp-host', title: address }, address),
        h('button', {
          className: 'rcp-btn', type: 'button', disabled: refreshing,
          onClick: refresh,
        }, refreshing || !loaded ? t('loading') : t('refresh'))))

      children.push(h(AddressControl, {
        key: 'address', address, t, onSaved: async () => { await load() },
      }))

      if (error !== null) {
        children.push(h('div', { className: 'rcp-error', key: 'error' }, `${t('hostError')}：${localizeHostError(error, t)}`))
      }

      if (current.authorized !== true) {
        if (current.reachable === false) {
          children.push(h('div', { className: 'rcp-error', key: 'unreachable' },
            `${t('unreachable')}：${String(current.healthError ?? address)}`))
        }
        if (typeof current.notice === 'string' && current.notice !== '') {
          children.push(h('div', { className: 'rcp-notice', key: 'notice' }, current.notice))
        }
        if (error === null) {
          children.push(h(SignInForm, { key: 'signin', t, onSignedIn: async () => { await load() } }))
        }
      }

      if (current.authorized === true) {
        children.push(h('div', { className: 'rcp-card', key: 'session' },
          h('div', { className: 'rcp-card-title' }, `${t('signedInAs')} ${String(current.email ?? '')}${current.role === undefined ? '' : ` · ${String(current.role)}`}`),
          h('div', { className: 'rcp-actions' },
            h('span', { className: 'rcp-spacer' }),
            h('button', { className: 'rcp-btn', type: 'button', onClick: () => { void signOut() } }, t('signOut')))))

        if (current.health !== undefined) {
          children.push(h('div', { className: 'rcp-card', key: 'health' },
            h('div', { className: 'rcp-card-title' }, t('health')),
            h(Row, { label: t('version') }, String(current.health.version ?? '—')),
            h(Row, { label: t('relay') }, String(current.health.relayEngine ?? '—')),
            h(Row, { label: t('tls') }, current.health.tlsEnabled === true ? 'TLS 1.3' : 'off'),
            h(Row, { label: t('uptime') }, formatUptime(current.health.uptimeSec, t))))
        } else if (current.healthError !== undefined) {
          children.push(h('div', { className: 'rcp-error', key: 'health-error' }, `${t('health')}：${String(current.healthError)}`))
        }

        if (current.stats !== undefined) {
          children.push(h('div', { className: 'rcp-metrics', key: 'metrics' },
            h(Metric, { value: String(current.stats.onlineCount ?? '—'), label: t('online') }),
            h(Metric, { value: String(current.stats.registeredCount ?? '—'), label: t('registered') }),
            h(Metric, { value: String(current.stats.activeRelaySessions ?? '—'), label: t('relaySessions') })))
        } else if (current.statsError !== undefined) {
          children.push(h('div', { className: 'rcp-error', key: 'stats-error' }, `${t('relaySessions')}：${String(current.statsError)}`))
        }
        if (current.sessionsError !== undefined) {
          children.push(h('div', { className: 'rcp-error', key: 'sessions-error' }, `${t('relaySessions')}：${String(current.sessionsError)}`))
        }

        if (Array.isArray(current.devices)) {
          children.push(h(DevicesCard, {
            key: 'devices', devices: current.devices, total: current.devicesTotal, t,
          }))
        } else if (current.devicesError !== undefined) {
          children.push(h('div', { className: 'rcp-error', key: 'devices-error' }, `${t('devices')}：${String(current.devicesError)}`))
        }
      }

      children.push(h('div', { className: 'rcp-foot', key: 'foot' },
        h('span', null, t('footer')),
        h('span', null, '·'),
        h('span', null, `${t('updatedAt')} ${formatClock(current.fetchedAt)}`)))
      return h('div', { className: 'rcp-root' }, children)
    }

    /**
     * 把面板组件绑定到当前语言。
     * @param t - 翻译函数。
     * @returns 组件。
     */
    function makePanel(t) {
      return function BoundPanel(props) {
        return h(Panel, { ...props, t })
      }
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'rabbitcontrol: copy')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: ID,
          kind: KIND,
          title: () => t('title'),
          guide: [{
            id: 'open',
            order: 60,
            title: () => t('title'),
            description: () => t('description'),
            icon: PanelIcon,
          }],
        }), 'rabbitcontrol: tab type')
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: ID, locale: NS, inject: () => ({}) },
          makePanel(t),
        )), 'rabbitcontrol: panel body')
      },
    }
  },
})
