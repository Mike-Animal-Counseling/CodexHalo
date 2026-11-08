<div align="center">
  <img src="apps/desktop/src-tauri/icons/128x128.png" width="80" height="80" alt="CodexHalo">
  <h1>CodexHalo</h1>
  <p>让 Codex 额度，安静地留在视线里。</p>
  <p>
    <a href="https://github.com/Mike-Animal-Counseling/codex-halo/releases/latest"><strong>下载 Windows 版</strong></a>
    &nbsp;·&nbsp; <a href="#从源码构建">从源码构建</a>
    &nbsp;·&nbsp; <a href="CHANGELOG.md">更新记录</a>
    &nbsp;·&nbsp; <a href="README.md">English</a>
  </p>
  <img src="docs/assets/codexhalo-preview.svg" width="900" alt="CodexHalo 功能演示：额度、历史趋势、重置提醒、Token 价格、边缘隐藏与恢复，使用合成数据">
</div>

[![CI](https://github.com/Mike-Animal-Counseling/codex-halo/actions/workflows/ci.yml/badge.svg)](https://github.com/Mike-Animal-Counseling/codex-halo/actions/workflows/ci.yml)

轻量的 Windows Codex 用量工具。圆形浮窗显示剩余额度；点击查看今日用量，或打开 History
查看趋势与 API 等价成本估算。使用 Tauri 2、React、TypeScript 和 Rust 构建。

## 功能

- **额度一览** —— 展示 Codex 返回的额度窗口与重置时间，常见为 5 小时和每周额度。
- **用量与趋势** —— 今日输入、缓存输入、输出及分模型用量，另有 7 天、30 天和年度图表。
- **重置提醒** —— 自定义提前多少分钟提醒，浮窗隐藏时也能收到通知。
- **成本估算** —— 按模型给出 API 等价美元估算，价格表可独立更新并支持离线回退。
- **桌面控制** —— 屏幕边缘自动隐藏、托盘恢复、**Ctrl + Shift + H**，支持浅色、深色和跟随系统。

支持已安装的官方 Codex CLI 和 VS Code 配置；CodexHalo 不会替你安装 Codex。
桌面版目前支持 **Windows 10/11，x64**。

## 安装与升级

1. 从[最新发布页](https://github.com/Mike-Animal-Counseling/codex-halo/releases/latest)下载安装包。
2. 如果旧版正在运行，先从系统托盘退出。
3. 运行安装包并启动。覆盖安装会保留设置。
4. 开启 **Enable Codex**；若无法连接，先打开或登录 Codex。

安装包未签名，Windows 可能显示 SmartScreen 提示。可用 PowerShell 校验下载文件：

```powershell
Get-FileHash .\CodexHalo_1.1.3_x64-setup.exe -Algorithm SHA256
```

将结果与 [SHA256SUMS.txt](https://github.com/Mike-Animal-Counseling/codex-halo/releases/download/v1.1.3/SHA256SUMS.txt) 比较。
应用没有可执行文件自动更新器，升级通过 GitHub Releases 完成。

## 隐私

Codex 访问默认关闭，开启后才会在本机解析会话文件。CodexHalo 不上传提示词、凭据或用量，
也没有遥测。价格检查只下载公开 JSON。详见[安全与隐私说明](docs/security.md)。

## 从源码构建

Windows，Node.js **20.19+ 或 22.12+**、稳定版 Rust、Microsoft C++ Build Tools 和 WebView2。
完整环境说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

```powershell
git clone https://github.com/Mike-Animal-Counseling/codex-halo.git
cd codex-halo
npm ci
npm run tauri -- dev
```

`npm run dev` 打开使用合成数据的浏览器预览；`npm run release:windows` 构建带隐私检查的安装包。

## 文档

| 文档 | 内容 |
| --- | --- |
| [架构](docs/architecture.md) | 桌面端与前端边界、Codex 集成 |
| [数据模型](docs/data-model.md) | Token 聚合、历史与估算 |
| [价格](docs/pricing.md) | 单价、假设与价格表维护 |
| [发布清单](docs/releasing.md) | 版本、校验与发布步骤 |
| [Changelog](CHANGELOG.md) | 版本记录 |
| [安全政策](SECURITY.md) | 支持版本与私密漏洞报告 |

问题与功能建议请使用 [Issue 模板](https://github.com/Mike-Animal-Counseling/codex-halo/issues/new/choose)；
分享截图和日志前请去除个人信息。

## 许可证

[MIT](LICENSE)，依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
CodexHalo 是独立的社区工具，并非 OpenAI 官方产品。
