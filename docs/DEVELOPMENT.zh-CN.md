# 开发与验证

[返回使用首页](../README.md) · [架构](ARCHITECTURE.md) · [验证记录](VERIFICATION.md) · [发布流程](RELEASING.zh-CN.md)

## 从源码安装

需要 Node.js 20.11+ 和 npm。在项目根目录运行：

```sh
npm ci
npm run build
```

在 Chrome / Edge 的扩展管理页开启开发者模式，将生成的 `dist/` 目录作为已解压的扩展加载。安装或更新后，刷新 YouTube 页面。

PowerShell 若阻止执行 `npm.ps1`，使用 `npm.cmd`。

## 验证与演示

```sh
npm run verify       # 构建、JavaScript 语法检查、自动化测试
npm run lab          # 启动本地浏览器演示
```

演示地址为 `http://127.0.0.1:4173/watch?v=abcdefghijk`；添加 `&semantic=1` 可查看日中语义字幕样例。设置页演示为 `/lab/pages.html`。

演示使用生产内容脚本，字幕、扩展通信及默认服务商响应为明确标记的模拟数据。测试默认不调用付费服务。自动化通过不等于真实 YouTube、模型和服务商兼容性已经验证；人工验收项见[验证记录](VERIFICATION.md)。

GitHub CI 配置覆盖 Windows / Linux 与 Node.js 22 / 24。

## 发布打包

额外需要 Python 3.10+，无需第三方 Python 库。

```sh
npm run release      # 完整验证、打包测试、ZIP 和 SHA-256
```

生成 `versevia-extension.zip` 和 `versevia-extension.zip.sha256`。详细操作见[发布指南](RELEASING.zh-CN.md)。

## 项目结构

```text
extension/   扩展运行时代码、界面及图标
src/         SABR 协议源代码
tests/       自动化回归测试
scripts/     构建、检查、打包和诊断工具
lab/         带模拟数据的浏览器演示
docs/        文档及 README 截图
native/      1.3.x 历史辅助程序；当前扩展不使用
dist/        生成的可加载扩展，不提交到 Git
```

构建会生成 `extension/sabr-page.js`，该文件不手工维护，也不提交到 Git。`node_modules/`、`artifacts/`、发布 ZIP、日志和本地环境文件均已被忽略。

## README 截图

[截图说明](images/README.md)记录截图来源和复现步骤。更新截图时保留生产界面，不把预设译文描述成真实模型输出，也不要截入 API 密钥、个人账号或浏览记录。
