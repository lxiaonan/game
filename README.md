# 熊二的世界 · 狗熊岭森林探索

一个用第一人称扮演 **熊二** 的网页森林探索游戏。所有美术素材(天空、地面、树木、木屋、12 位邻居角色、第一人称熊掌、金松果)都是用 AI 生图模型现场生成的,再经过抠图去底、无缝化处理后在游戏里实时渲染。

## 怎么玩

双击 **`启动游戏.bat`**(或运行 `python start_game.py`),浏览器会自动打开游戏。

> 游戏使用 ES Module,必须通过 http 服务打开,不能直接双击 `index.html`。

## 操作

| 按键 | 作用 |
| --- | --- |
| `W A S D` | 前后左右走 |
| `方向键 ← →` | 转身(不用鼠标也能玩) |
| `鼠标` | 转头(点击画面锁定鼠标) |
| `Shift` | 奔跑 |
| `Space` | 跳跃 |
| `E` | 和邻居说话 / 继续对话 |
| `F` / 鼠标左键 | 用熊掌拍人 |
| `Esc` | 暂停(再按 `E` 继续) |

手机 / 平板:左下角虚拟摇杆走路,拖动画面转头,右下角按钮说话、跳跃和拍人。

## 玩法目标

1. 走进营地找 **熊大** 接新手任务。
2. 沿小路向东,踩着 **独木桥** 过河。桥很窄,掉下去会被水冲回岸上。
3. 河对岸 **光头强** 正在砍树。按 F(或鼠标左键)用熊掌拍他,在大树被砍倒前把他赶走。
4. 回去向熊大报喜,再和邻居聊天,找回 **7 颗会发光的金松果**(靠近就会自动捡起)。
5. 集齐后交给熊大,任务完成。

左下角小地图会显示邻居(白点)、金松果(金点)和自己的位置与朝向。

## 目录结构

```
index.html            游戏外壳、HUD、开始/暂停/结局界面与全部样式
src/main.js           主循环、输入、任务逻辑、测试钩子
src/assets.js         贴图加载与程序化生成的阴影/光晕/花粉贴图
src/world.js          天空、地面、小径、森林、木屋、营火、道具、可拾取物
src/player.js         第一人称控制器(移动、碰撞、跳跃、头部晃动、熊掌)
src/npcs.js           12 位邻居的站位、闲聊与游荡行为、名字牌
src/quest.js           新手任务阶段与目标光柱
src/boss.js            光头强砍树与挨打
src/ui.js             HUD、小地图、对话框、任务卡
src/audio.js          程序化合成的风声、鸟叫、脚步、拾取音效(无音频文件)
assets/raw/           AI 生成的原始图
assets/tex/           处理后的游戏贴图(去底 / 无缝)
tools/gen_assets.py   批量生图脚本
tools/postprocess.py  贴图后处理(白底抠图、无缝化、缩放)
vendor/three.module.js three.js r160
```

## 部署

这是**纯静态**项目:服务器只发文件,不做任何计算(没有后端、没有数据库、没有构建步骤)。
实测用 Python 自带 `http.server` 托管整个游戏,服务端占用 **10MB 内存、1 个线程、全程 5.69 秒 CPU** —— 2 核 2G 的机器属于严重过剩,1 核 256M 都够。

```bash
node tools/pack.mjs          # 只打包运行时需要的文件 -> dist/(38 个文件,28.1MB)
```

`dist/` 里只有 `index.html`、`src/`、`vendor/`、`assets/tex/`。开发用的东西(不含在包里)是:
AI 生图原稿 `assets/raw` 53MB、`tools/` 65.8MB(Python 生图脚本 + 测试工具)、`node_modules` 17.7MB(Playwright),这些浏览器一个都不会请求。

托管方式任选:

- **nginx**(推荐):`deploy/nginx.conf` 已写好,含文本 gzip、贴图长缓存、`sendfile` 零拷贝
- **临时/内网**:`python start_game.py 0.0.0.0 8000`(会监听所有网卡,且不尝试打开浏览器)
- **完全不租服务器**:因为是纯静态,直接丢到 GitHub Pages / Cloudflare Pages / Netlify 就能跑

需要留意的不是服务端,而是这两点:

| 约束 | 实测 | 说明 |
| --- | --- | --- |
| 首屏传输 | 37 个请求,28.48MB(其中 27.14MB 是 PNG) | 100Mbps 机器约 2.5 秒;5Mbps 约 45 秒 |
| 客户端显卡 | 需 WebGL2 | 真正的负载在客户端。核显机器上可加 `?aa=0` 关抗锯齿 |

### 部署到 GitHub Pages

可以,而且不用改任何代码 —— 已按 Pages 的项目站点形式(`/<仓库名>/` 子路径)实测通过。
因为是纯静态,Pages 自带的 CDN 和 HTTPS 直接可用,那台 2核2G 的服务器可以不买了。

**方式 A:直接发布仓库根目录(最省事)**

仓库根目录本身就是可发布内容(`index.html`、`src/`、`vendor/`、`assets/tex/` 的相对位置都对):

1. 推到 GitHub(`node_modules/`、`dist/` 已在 `.gitignore` 里,不会提交)
2. Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`,分支 `main`、目录 `/(root)`
3. 访问 `https://<用户名>.github.io/<仓库名>/`

**方式 B:只发布运行时文件(推荐,仓库可以保留 AI 生图原稿和测试工具)**

仓库里已带好 `.github/workflows/pages.yml`,它只上传 `tools/pack.mjs` 挑出来的 28MB:

1. Settings → Pages → Source 选 `GitHub Actions`
2. 推送到 `main` 即自动发布

**随时的复检命令**(纯 HTTP,不开浏览器):

```bash
node tools/deploycheck.mjs https://<用户名>.github.io/<仓库名>/
```

它会逐个请求页面上所有引用,检查 404、Linux 下才会暴露的文件名大小写不符、跳出子路径的绝对路径、
以及 `.js` 是否被返回成浏览器拒绝执行的 MIME 类型。

| 检查项 | 结果 |
| --- | --- |
| 子路径 `/<仓库名>/` | 36 个引用全部相对路径 ✅ |
| 文件名大小写 | 与源文件完全一致(Windows 不区分,Pages 的 Linux 区分)✅ |
| ES module MIME | `.js` 返回正确的 JS 类型 ✅ |
| 体积上限 | 单文件最大 2.42MB(Pages 上限 100MB),站点 28MB(上限 1GB)✅ |

## 重新生成素材

```bash
python tools/gen_assets.py            # 生成全部 19 张素材(已存在的会跳过)
python tools/gen_assets.py tree_oak   # 只重生成某一张
python tools/postprocess.py           # 全部重新处理
python tools/repost.py tree_oak       # 只重新处理某一张
```

## 开发者调试参数

在网址后面加参数即可快速跳到某个状态(只在测试时使用):

- `?autostart=1` 跳过开始界面直接进入游戏
- `?pose=x,z,朝向角度` 指定出生点,例如 `?autostart=1&pose=-3,-2.5,180`
- `?dev=1&cones=7` 直接预置已收集的松果数量,用来测试结局
- `?dev=1&stage=fight` 跳到打光头强(可配合 pose)
- `?aa=0` 关掉抗锯齿(机器吃力时更流畅)
- `?scale=0.75` 固定内部渲染分辨率倍率(默认按实测帧时间自动调节)

`window.render_game_to_text()` 会返回当前游戏状态的 JSON,`window.advanceTime(ms)` 可以按固定步长推进游戏,方便自动化测试。

性能与回归测试脚本:

```bash
node tools/perf.mjs 标签 3     # 固定机位测帧耗时 / draw call / 吞吐
node tools/mem.mjs             # 测纹理显存/绘制缓冲/JS 堆的构成
node tools/smoke.mjs           # 20 项操作流回归测试
python tools/imgdiff.py 旧图目录 新图目录 机位...   # 截图结构对比
```
