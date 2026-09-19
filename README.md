# Sentence · YouTube 双语字幕

<img src="extension/icons/sentence.svg" width="72" alt="Sentence 图标">

**按句阅读 YouTube，在原文与译文之间理解内容。**

Sentence 是适用于桌面 Chrome / Edge 的 Manifest V3 扩展，提供双语字幕、整句跳转、可选 AI 语义断句，以及浏览器内语音字幕生成。字幕来源与翻译服务独立选择，使用你自己的服务商配置。

[详细使用指南（English）](docs/USER_GUIDE.en.md) · [语音字幕](docs/SPEECH.zh-CN.md) · [语义断句](docs/SEMANTIC.zh-CN.md) · [更新日志](CHANGELOG.md)

## 功能

- **双语阅读**：原文、译文或双语显示；尚未获得译文时保留原文。
- **整句导航**：左右方向键跳到上一句 / 下一句，保留播放或暂停状态；可关闭快捷键。
- **字幕来源**：作者字幕、YouTube 自动字幕，或用户明确启动的语音识别字幕。
- **多种翻译服务**：MyMemory、Google Cloud Translation、DeepL、Microsoft Translator、LibreTranslate、DeepSeek、Gemini、OpenRouter 及自定义兼容端点。
- **AI 语义处理**：可选完整语句划分、带上下文的批量翻译、长句双语分句对齐；支持附近预取与整段视频处理。
- **外观设置**：两种主题、字体、颜色、透明度、双语字号比例，以及鼠标移动和缩放字幕。
- **本地缓存**：复用已完成的处理结果；切换视频、定位和取消任务时校验状态，减少重复请求。

扩展不附带 API 密钥，也不包含离线翻译模型。初始翻译引擎为关闭状态；仅阅读原字幕不需要配置翻译服务。

## 安装

支持 **Chrome 116+** 及具备对应 Chromium API 的桌面 Edge。

**使用扩展发布包：** 下载项目 Release 中的 `sentence-extension.zip` 并解压。在 `chrome://extensions` 或 `edge://extensions` 开启「开发者模式」，选择「加载已解压的扩展程序」，选中含 `manifest.json` 的解压目录。

**从源码安装：**

```sh
npm ci
npm run build
```

然后加载项目生成的 `dist/` 目录。GitHub 的 Source code 压缩包不含构建产物，不能直接作为扩展加载。构建需要 Node.js 20.11+；安装已构建的扩展不需要 Node.js、Python 或本地辅助程序。

安装或更新后，重新加载扩展并刷新已打开的 YouTube 页面。

## 开始使用

1. 打开普通 YouTube 视频观看页，点击播放器底部控制栏中的 Sentence 字幕图标。
2. 选择字幕来源和语言；`Match video` 会从可用字幕轨道中匹配。
3. 打开 `Providers`，选择服务商，填写对应端点、密钥及模型，点击 `Save, connect & use` 并授予端点权限。
4. 选择目标语言，例如中文 `zh`（初始目标为西班牙语 `es`），使用双语模式阅读。左右方向键用于整句跳转。

没有合适字幕时，可单独配置 Speech recognition，并在扩展工具栏弹窗中明确同意音频处理后启动。先使用 `Test browser audio · no speech API` 可检查音频获取和解码；该诊断不会调用语音识别 API。详见[语音字幕说明](docs/SPEECH.zh-CN.md)。

**费用与数据：** 翻译、AI 断句、双语对齐和语音识别可能产生服务商费用。选择 AI 服务且启用语义断句时，「仅原文」模式也可能发出断句请求；关闭语义断句可使用规则分段。停止任务会取消后续处理，但服务商已接受的请求仍可能计费。

## 服务商配置

| 类型 | 可选服务 | 所需配置 |
| --- | --- | --- |
| 普通翻译 | MyMemory、Google、DeepL、Microsoft、LibreTranslate | 服务对应的端点及凭据；MyMemory 公共接口可不填密钥 |
| AI 翻译与断句 | DeepSeek、Gemini、OpenRouter、Custom AI | Chat Completions 兼容端点、可用模型 ID 和所需密钥 |
| 语音识别 | 可配置的转写服务 | 支持 `verbose_json` 和分段时间戳的端点及模型 |

配置是按服务商分别保存的。语音识别和翻译使用独立配置；保存语音配置不会自动录音。端点支持 HTTPS，以及 `localhost` / `127.0.0.1` 上的 HTTP。请求格式和各适配器说明见[完整指南](docs/USER_GUIDE.en.md#connect-a-translation-provider)。

## 支持范围与已知限制

- 支持桌面 `https://www.youtube.com/watch` 普通视频。Shorts、直播、嵌入播放器、移动端、画中画及无痕会话不属于本版支持范围。
- YouTube 内部字幕接口与 SABR 音频协议可能变化。**SABR 音频生成为实验性功能**，可用性取决于当前播放器会话、音轨、格式和授权。
- AI 语义质量取决于所选模型；源字幕时间戳不准确时，显示和导航也可能偏移。词内或字幕片段内切分使用插值，不做音频强制对齐。
- 语音生成支持最多四小时的录播视频；无 SABR 元数据时的整段音频下载限制为 15 分钟 / 20 MB。手动录音回退需保持连续 1× 播放。
- 自动化测试使用模拟浏览器和服务商响应，不代表所有真实视频、API 或模型都已验证。具体证据与人工验收项见[验证记录](docs/VERIFICATION.md)。

字幕未出现时，先刷新视频页面、启用 YouTube 原生 CC 并选择正确语言，再点击 `Refresh tracks`。翻译失败时检查服务商权限、模型、配额，处理后点击重试。

## 隐私

密钥和偏好仅保存在当前浏览器配置文件，不通过 Chrome 同步。翻译及 AI 处理会向所选端点发送字幕和必要上下文；音频仅在明确启动语音任务后发送到语音服务。扩展没有开发者遥测服务。

缓存可从设置页清除；删除密钥与撤销浏览器端点权限是独立操作。MyMemory 使用 GET，字幕及可选密钥会出现在请求 URL 中。详见[隐私与权限](docs/PRIVACY.zh-CN.md)。

## 开发与验证

```sh
npm ci
npm run verify       # 构建、JavaScript 语法检查和测试
npm run lab          # 本地浏览器演示
```

本地演示地址为 `http://127.0.0.1:4173/watch?v=abcdefghijk`。演示使用生产内容脚本，但字幕、扩展通信及默认服务商响应均为明确标记的模拟数据。

发布打包额外需要 Python 3.10+，不需要安装 Python 第三方库：

```sh
npm run release      # 完整验证、打包测试、ZIP 和 SHA-256
```

PowerShell 若阻止 `npm.ps1`，使用 `npm.cmd`。测试默认不调用付费服务。GitHub CI 配置覆盖 Windows / Linux 与 Node.js 22 / 24。

```text
extension/   扩展运行时代码、界面及图标
src/         SABR 协议源代码（构建时打包）
tests/       自动化回归测试
scripts/     构建、检查、打包和诊断工具
lab/         带模拟数据的浏览器演示
docs/        使用说明、架构、验证记录及发布流程
native/      1.3.x 历史辅助程序；当前扩展不使用
dist/        自动生成的可加载扩展，不提交到 Git
```

构建会生成 `extension/sabr-page.js`，该文件不手工维护，也不提交到 Git。架构与扩展方式见[开发架构](docs/ARCHITECTURE.md)；首次上传与 Release 操作见[发布指南](docs/RELEASING.zh-CN.md)。

## 许可

[MIT License](LICENSE)。随包提供的第三方代码保留各自许可，见[第三方声明](THIRD_PARTY_NOTICES.md)。本项目与 YouTube 及所列服务商无隶属关系。
