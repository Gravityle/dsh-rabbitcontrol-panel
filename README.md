# RabbitControl 服务器状态（dsh-rabbitcontrol-panel）

在 DeepSeek Harness 里查看 RabbitControl（`rc-server`）部署：服务健康、已注册设备、中继会话；同时给 agent 三个只读工具。

## 安装

让 agent 执行：用 plugin_manager 的 install_bundle 安装 `dsh-rabbitcontrol-panel`（npm 发布后）；
或把 `github:<你>/dsh-rabbitcontrol-panel`、本地目录路径作为 `install_bundle` 的 target。

## 入口与工具

- **右侧栏**：打开任意 Session 的右侧栏，在开始页点 **RabbitControl 服务器状态** 卡片。
- **agent 工具**：`rc_health`（版本/在线设备数/中继引擎/TLS）、`rc_devices`、`rc_sessions`。三者复用面板的登录态。

## 使用

1. `baseUrl` 填你的 rc-server REST 地址（**默认留空**；留空时在面板里填写并写回配置）。
2. 在面板里用 rc-server 账号登录；登录成功后自动轮询健康、设备与会话。
3. 需要时用面板顶部 **修改** 改 `baseUrl`：能写进插件行配置就写，写不进时只在本进程内生效并如实提示。

## 限制

- 面板与工具都是**只读**：不提供删除设备、踢下线、改配置等写操作（管理端在 rc-server 自带控制台）。
- `rc_devices` 会过滤掉被管理端停用（`disabled`）的设备。
