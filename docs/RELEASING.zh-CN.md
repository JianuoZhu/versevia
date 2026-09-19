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
- `sentence-extension.zip`：解压后可加载的扩展包。
- `sentence-extension.zip.sha256`：SHA-256 校验值。

`dist/`、ZIP、运行时目录、临时日志和 `.env` 文件已被 Git 忽略。不要强制添加这些文件到源码提交。发布 ZIP 仅含扩展本体及许可，不包含 `native/`、开发依赖或浏览器配置。

## 首次上传

1. 在自己的 GitHub 账号下新建空仓库，例如 `BilingualSubtitle`；不要自动创建 README、许可证或 `.gitignore`，本地已有这些文件。
2. 在项目根目录确认待上传内容：

   ```sh
   git status --short
   git diff --cached --stat
   ```

3. 如尚未提交，创建首次提交：

   ```sh
   git add .
   git commit -m "Prepare Sentence 1.5.3 release"
   ```

4. 将下面的占位地址替换成实际仓库地址，再推送：

   ```sh
   git remote add origin https://github.com/YOUR_ACCOUNT/BilingualSubtitle.git
   git push -u origin main
   ```

若已有 `origin`，先用 `git remote -v` 确认，避免覆盖已有远程。不要把密钥、签名媒体链接、浏览器日志或私有字幕贴到 Issue 中。

## 创建 Release

GitHub Actions 会自动验证提交并保留扩展构建产物，**不会自动发布 Release**。首次上传后检查四个 CI 组合通过，再在真实 Chrome/Edge 中执行 [人工验收](VERIFICATION.md)；自动化测试不能代替真实 YouTube 与服务商兼容性测试。

创建 `v1.5.3` 标签和同名 Release，正文使用 [CHANGELOG](../CHANGELOG.md) 中的本版条目，附上 ZIP 和 SHA-256 文件。SABR 音频仍为实验性功能，应在发布说明中保留这一限制。GitHub 自动生成的 Source code 压缩包是源码，不是可直接加载的扩展。

## 后续版本

同步更新 `package.json`、`package-lock.json` 和 `extension/manifest.json` 的版本；更新 CHANGELOG 与验证记录后运行 `npm run release`。构建会拒绝版本不一致，打包会拒绝源文件差异和多余的旧文件。
