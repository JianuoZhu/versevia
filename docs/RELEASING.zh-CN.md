# GitHub 发布说明

当前版本：**1.5.3**。本项目采用 [MIT](../LICENSE) 许可。

## 本地验证与打包

需要 Node.js 20.11+、npm，以及 Python 3.10+（仅打包及打包测试使用，无第三方 Python 依赖）。

```sh
npm ci
npm run release
```

PowerShell 若阻止执行 `npm.ps1`，使用 `npm.cmd`。发布命令会依次构建、检查语法、运行 JavaScript 测试、运行 Python 打包测试并生成：

- `dist/`：可加载的扩展目录。
- `versevia-extension.zip`：解压后可加载的扩展包。
- `versevia-extension.zip.sha256`：SHA-256 校验值。

`dist/`、ZIP、运行时目录、临时日志和 `.env` 文件已被 Git 忽略。不要强制添加这些文件到源码提交。发布 ZIP 仅含扩展本体及许可，不包含 `native/`、开发依赖或浏览器配置。

## 上传源码

官方仓库：[JianuoZhu/versevia](https://github.com/JianuoZhu/versevia)。在本地确认提交内容后推送：

```sh
git status --short
git remote -v
git push origin main
```

首次配置远程时使用 `git remote add origin https://github.com/JianuoZhu/versevia.git`。若已有 `origin`，先确认地址，避免覆盖其他远程。不要提交密钥、签名媒体链接、浏览器日志或私有字幕。

## 创建 Release

GitHub Actions 会自动验证提交并保留扩展构建产物，**不会自动发布 Release**。发布前检查四个 CI 组合通过，并按照 [人工验收](VERIFICATION.md)记录实际完成的兼容性检查；未验证的场景应在发布说明中明确披露。自动化测试不能代替真实 YouTube 与服务商兼容性测试。

创建 `v1.5.3` 标签和同名 Release，正文使用 [CHANGELOG](../CHANGELOG.md) 中的本版条目，附上 ZIP 和 SHA-256 文件。SABR 音频仍为实验性功能，应在发布说明中保留这一限制。GitHub 自动生成的 Source code 压缩包是源码，不是可直接加载的扩展。

## 后续版本

同步更新 `package.json`、`package-lock.json` 和 `extension/manifest.json` 的版本；更新 CHANGELOG 与验证记录后运行 `npm run release`。构建会拒绝版本不一致，打包会拒绝源文件差异和多余的旧文件。
