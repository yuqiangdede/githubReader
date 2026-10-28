# 听仓 · GitHub Listen

手机独立运行的安卓应用，同时保留 PWA 网页版本。连接 GitHub 仓库、浏览分支及目录、读取 Markdown / UTF-8 文本，支持分段朗读、语速和声音选择、进度保存和离线文件。

## 安卓 APK：无需电脑或服务器

安装 `artifacts/tingcang-debug.apk`（Android 8.0+，个人测试签名）。允许当前下载来源安装应用后打开“听仓”。

1. 公开仓库可直接输入地址连接；私有仓库点击“GitHub 登录”。
2. Client ID 已预置为 `Ov23liooFpbThbrzwAY1`，点击“获取授权码”。
3. 记住授权码，点击“打开 GitHub 授权网页”，在手机浏览器中输入授权码并核对应用和权限。
4. 回到听仓，自动完成登录，选择仓库及文件并播放。
5. 允许通知权限后，可在通知栏/锁屏使用上一段、暂停、下一段控制。
6. 在“安卓 TTS 引擎”中选择已安装引擎；“系统语音设置”可管理系统 TTS。离线朗读请先安装引擎的中文离线语音包，并选择标注“离线”的声音。

APK 内置全部界面，使用原生 HTTP 直接访问 GitHub，不依赖 Node 服务、PC、网站域名或 Client Secret。使用 GitHub Device Flow，OAuth App 必须勾选 **Enable Device Flow**。可在登录弹窗修改 Client ID；它是公开应用标识，不是密钥。访问令牌及刷新令牌使用 Android Keystore AES-GCM 加密保存，支持返回 `expires_in` / `refresh_token` 时自动刷新；令牌不会传入网页 JS。退出清除本机凭据，撤销授权需在 GitHub 设置操作。

原生 `TextToSpeech` 在独立安卓前台服务管理完整朗读队列，使用 AudioFocus、部分唤醒锁及 MediaSession，并按段落保存进度；切后台或锁屏无需依赖网页 JS 继续调度。通话或其他应用夺取音频焦点时暂停，需手动继续；暂停后从当前段开头继续。系统强制停止、进程被终止或部分厂商省电策略仍可能中断朗读，重开应用可恢复段落进度。为长时间听读，可在手机设置允许听仓后台运行。

文件和进度保存在应用 WebView 的 IndexedDB，重新打开无需联网；原生服务另外保存最新段落进度。登录、读取仓库目录和新文件需要联网。卸载或清除应用数据会移除缓存和凭据，退出登录不会清除文件，可用书架的“清除”操作。

## 构建安卓应用

开发环境需要 Node.js 22+、JDK 21、Android SDK（platforms;android-35、build-tools;35.0.0、platform-tools），Gradle Wrapper 使用 8.11.1。设置 `JAVA_HOME` 和 `ANDROID_HOME`。

```powershell
npm ci
npm run android:build
```

此命令先将 public 界面打包到 dist，再同步 Capacitor 安卓工程，运行 `assembleDebug testDebugUnitTest` 并复制 APK 到 `artifacts/tingcang-debug.apk`。本次准备的 `.tooling/java`、`.tooling/android-sdk`、`.tooling/gradle` 可由脚本自动检测，均不提交 Git。调试版可安装使用；公开发布需自行配置正式签名并妥善备份密钥。

原生实现位于 `android/app/src/main/java/com/tingcang/reader/`；`GitHubPlugin` 管理 GitHub HTTP/Device Flow/刷新，`TokenVault` 加密凭据，`ReaderTtsPlugin` 是桥接入口，`ReaderService` 管理后台播放。应用不申请外部存储权限，不启用云备份，不加载远程界面。

## 可选：PWA 本地运行

```powershell
Copy-Item .env.example .env
npm start
```

打开 http://localhost:3000 。默认测试仓库为 https://github.com/yuqiangdede/The-Last-Watch ，点击连接箭头，然后选择文件。公开仓库无需登录，GitHub 匿名额度通常为每 IP 每小时 60 次。

## PWA GitHub 网页登录

1. 在 GitHub Settings → Developer settings → OAuth Apps → New OAuth App 创建应用。
2. Homepage URL 填写 `http://localhost:3000`，Authorization callback URL 填写 `http://localhost:3000/auth/callback`。
3. 将 Client ID、Client secret 写入 `.env` 的 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`，重启服务。
4. 点击“GitHub 登录”，在 GitHub 官方网页完成授权。

使用 OAuth 的 `repo read:user` 权限以读取私有仓库；`repo` 是 GitHub OAuth 的较广权限，请按需授权。应用仅实现读取 API。Token 仅保存在服务端内存，不返回前端，不写本地存储；登录有效期 24 小时，服务重启会注销。登录 state 一次性校验，Cookie 为 HttpOnly / SameSite=Lax，HTTPS 时启用 Secure。退出只清除服务端会话；彻底撤销授权请在 GitHub 设置操作。离线文件存在当前浏览器设备，退出登录不会删除，可在“最近听过 → 清除”删除。

## 可选：PWA 安装和上线

部署整个 Node 项目到支持常驻 Node 的服务器，通过反向代理提供 **HTTPS**。环境变量 `APP_URL` 设置为最终公网地址，例如 `https://listen.example.com`，OAuth App 回调同步修改为 `https://listen.example.com/auth/callback`。反向代理需传递 Cookie。不能只上传 public 文件夹，否则 GitHub API 代理和登录不可用。

安卓 Chrome 打开 HTTPS 地址，通过浏览器菜单“添加到主屏幕 / 安装应用”，或页面出现的“安装应用”。桌面 localhost 支持 Service Worker；手机访问电脑的普通 HTTP 局域网 IP 不满足 PWA 安装条件，手机测试请使用可信 HTTPS 域名或 HTTPS 隧道。

## PWA TTS 与离线范围

- 使用 `speechSynthesis`，声音来自浏览器暴露的系统声音，无法指定任意 Android TTS 引擎；请在实际安卓设备检查声音列表。
- 离线朗读需要设备已装离线语音包且当前声音支持离线；声音列表显示“本机/网络”是浏览器报告，不保证离线成功。
- 已打开文件及进度保存在 IndexedDB；应用外壳由 Service Worker 缓存，离线可从“最近听过”打开。仓库目录、登录、新文件仍需网络。
- 暂停会停止当前段，继续从当前段开头播放，以兼容安卓浏览器。
- 浏览器可能在锁屏、切后台、页面关闭或系统回收时停止朗读，PWA 不保证后台连续播放。
- 当前支持小于 1 MB 的 UTF-8 文本，Markdown 正文会略过围栏代码、图片和标记；原文可切换查看。仓库列表取最近更新的前 100 个，分支列表使用 GitHub 默认分页。
- 单实例服务；生产多实例需共享会话存储。没有托管密钥或预配置 OAuth 凭据。

## 验证

`npm test` 运行正文处理、分段、仓库地址校验和网页服务测试。`npm run android:build` 同时编译 APK 并运行安卓单元测试（GitHub API 读取路径与路径穿越限制）。没有连接安卓实机时，无法验证真实 TTS 发声、浏览器授权返回和厂商后台策略，需安装后实机验证。
