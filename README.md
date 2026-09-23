# 熊二的世界 · 狗熊岭开放世界

一个用第一人称扮演 **熊二** 的网页开放世界游戏。整片狗熊岭(460×460 米的高度场地形,七个区域)从第一秒起就全部开放:五个关卡各自立在一块发光的石碑前,想先做哪个都行。所有美术素材(天空、地面、树木、木屋、15 位邻居角色、第一人称双熊掌、三类收集品、沼泽与高地的道具)都是用 AI 生图模型现场生成的,再经过抠图去底、无缝化处理后在游戏里实时渲染。

## 怎么玩

双击 **`启动游戏.bat`**(或运行 `python start_game.py`),浏览器会自动打开游戏。

> 游戏使用 ES Module,必须通过 http 服务打开,不能直接双击 `index.html`。

## 操作

| 按键 | 作用 |
| --- | --- |
| `W A S D` | 前后左右走 |
| `方向键 ← →` | 转身(不用鼠标也能玩) |
| `鼠标` | 转头(点击画面锁定鼠标) |
| `Shift` | 奔跑(消耗体力) |
| `C` | 蹲下潜行(视角压低、移动变慢) |
| `Space` | 跳跃 |
| `Q` | 翻滚闪避(消耗体力,翻滚中无敌) |
| `F` / 鼠标左键 | 熊掌攻击(三段连击,第三下是重击,伤害更高、范围更大) |
| `R` | 扔石头(远程,能打断对手) |
| `E` | 和邻居说话 / 点亮晶石 / 查看关卡石碑 |
| `M` | 打开狗熊岭全图 |
| `Tab` | 打开关卡面板 |
| `Esc` | 暂停 / 关闭已打开的界面(再按 `E` 继续) |

手机 / 平板:左下角虚拟摇杆走路,拖动画面转头,右下角按钮说话、跳跃、拍人、翻滚、扔石头。

## 玩法目标

整个山谷随便走,营地里的 **熊大** 会先给你指路。之后五块发光石碑就是五个关卡:

| 关卡 | 地点 | 目标 |
| --- | --- | --- |
| 1 · 抢树之战 | 河湾伐木场 | 过独木桥,用熊掌把砍树的 **光头强** 赶走,别让大树倒下 |
| 2 · 金松果大搜索 | 整片狗熊岭 | 捡回 **7 颗** 会发光的金松果(靠近自动拾取) |
| 3 · 迷雾沼泽 | 西南沼泽 | 捞 **6 罐** 野蜂蜜。水没过脚踝走不快,蜂巢边上会被蜜蜂追着叮 |
| 4 · 夜色高地 | 东北石台 | 天一黑,高地上的 **4 块** 晶石就熄了,走到每块前面按 E 点亮 |
| 5 · 巨石阵试炼 | 西边石圈 | 站进石圈,打赢 **3 波** 对手 |

每通关一关都会永久强化熊二(攻击力 / 体力上限 / 移速 / 生命上限),进度自动存在浏览器里,下次打开接着玩
(开始界面点 **再玩一次** 会清空存档)。按 `M` 看全图,按 `Tab` 或走到石碑前按 `E` 随时换关卡。

左下角小地图显示自己、关卡石碑、收集品和邻居;`M` 打开的大地图还会列出五个关卡的完成情况。

## 目录结构

```
index.html            游戏外壳、HUD、大地图、关卡面板、全部样式
src/main.js           主循环、输入、交互、关卡串联、存档、测试钩子
src/terrain.js        狗熊岭的地形:高度场、七个区域、河道峡谷
src/world.js          地形网格与五路贴图混合、河/沼泽水面、小径、森林、营地、道具
src/props.js          收集品、关卡石碑、晶石、蜂巢、竞技场石圈
src/levels.js         五个关卡的定义、目标追踪、解锁与通关奖励
src/enemies.js        巨石阵的波次对手(AI、受击、三波推进)
src/player.js         第一人称控制器(走跑蹲跳、翻滚、三段连击、投掷、体力、生命、双熊掌)
src/npcs.js           15 位邻居的站位、闲聊与游荡行为、名字牌
src/boss.js           光头强砍树与挨打
src/save.js           进度存档(localStorage,只存进度不存位置)
src/assets.js         贴图加载与程序化生成的阴影/光晕/花粉贴图
src/ui.js             HUD、小地图、大地图、关卡面板、对话框、生命/体力条
src/audio.js          程序化合成的风声、鸟叫、脚步、拾取音效(无音频文件)
assets/raw/           AI 生成的原始图
assets/tex/           处理后的游戏贴图(去底 / 无缝)
tools/gen_assets.py   第一批生图脚本(19 张:环境 / 邻居 / 熊掌)
tools/gen_assets2.py  第二批生图脚本(15 张:双熊掌、沼泽、高地、石碑、新邻居)
tools/postprocess.py  贴图后处理(白底抠图、双臂拆分、无缝化、缩放)
vendor/three.module.js three.js r160
```

## 部署

这是**纯静态**项目:服务器只发文件,不做任何计算(没有后端、没有数据库、没有构建步骤)。
实测用 Python 自带 `http.server` 托管整个游戏,服务端占用 **10MB 内存、1 个线程、全程 5.69 秒 CPU** —— 2 核 2G 的机器属于严重过剩,1 核 256M 都够。

```bash
node tools/pack.mjs          # 只打包运行时需要的文件 -> dist/(57 个文件,26.2MB)
```

`dist/` 里只有 `index.html`、`src/`、`vendor/`、`assets/tex/`。开发用的东西(不含在包里)是:
AI 生图原稿 `assets/raw` 80.6MB、`tools/`(Python 生图脚本 + 测试工具)、`node_modules`(Playwright),
这些浏览器一个都不会请求。

托管方式任选:

- **nginx**(推荐):`deploy/nginx.conf` 已写好,含文本 gzip、贴图长缓存、`sendfile` 零拷贝
- **临时/内网**:`python start_game.py 0.0.0.0 8000`(会监听所有网卡,且不尝试打开浏览器)
- **完全不租服务器**:因为是纯静态,直接丢到 GitHub Pages / Cloudflare Pages / Netlify 就能跑

需要留意的不是服务端,而是这两点:

| 约束 | 实测 | 说明 |
| --- | --- | --- |
| 首屏传输 | 54 个引用,26.0MB(基本都是 PNG) | 100Mbps 机器约 2.5 秒;5Mbps 约 42 秒 |
| 客户端显卡 | 需 WebGL2 | 真正的负载在客户端。核显机器上可加 `?aa=0` 关抗锯齿 |

> 六张平铺贴图(草/土/水/树皮/崖壁/沼泽)和两张天空全景在 `tools/postprocess.py` 里就存成
> 运行时真正上传的尺寸(512² / 1024 宽)。以前存的是 1024² 原图、由 `src/assets.js` 在加载时缩到 512 ——
> 那些像素没有任何人看到,却要占 13.9MB 下载。现在文件、上传、眼睛三者一致,`assets/tex` 从 38MB 降到 24.8MB,
> 比加 15 张新素材之前的 27MB 还小。1024 的原稿仍然留在 `assets/raw`。

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
| 子路径 `/<仓库名>/` | 54 个引用全部相对路径 ✅ |
| 文件名大小写 | 与源文件完全一致(Windows 不区分,Pages 的 Linux 区分)✅ |
| ES module MIME | `.js` 返回正确的 JS 类型 ✅ |
| 体积上限 | 单文件最大 1.9MB(Pages 上限 100MB),站点 26.2MB(上限 1GB)✅ |

## 重新生成素材

```bash
python tools/gen_assets.py            # 第一批 19 张(已存在的会跳过)
python tools/gen_assets2.py           # 第二批 15 张(双熊掌 / 沼泽 / 高地 / 石碑 / 新邻居)
python tools/gen_assets2.py hands_pair  # 只重生成某一张
python tools/postprocess.py           # 全部重新处理(含把 hands_pair 拆成左右两只熊掌)
python tools/repost.py tree_oak       # 只重新处理某一张
```

> `hands_pair` 是一张"第一人称看自己两只前爪"的图,`postprocess.py` 里的 `split_arms()`
> 会把两个前爪的连通域分别抠出来,输出 `hand_left.png` / `hand_right.png`。
> 老版本用 `cutout()` 只保留最大连通域,所以一对熊掌被砍成了一只,再被两个精灵各画一次 —— 看上去像四只手。

## 开发者调试参数

在网址后面加参数即可快速跳到某个状态(只在测试时使用):

- `?autostart=1` 跳过开始界面直接进入游戏
- `?pose=x,z,朝向角度` 指定出生点,例如 `?autostart=1&pose=-3,-2.5,180`
- `?fresh=1` 忽略本地存档,以全新进度开始
- `?dev=1` 开发模式(自动忽略存档):`&level=lv3` 直接开始某一关,`&give=honey:6` 预置收集品,
  `&lit=4` 预置已点亮的晶石,`&intro=1` 跳过找熊大的开场
- `?aa=0` 关掉抗锯齿(机器吃力时更流畅)
- `?scale=0.75` 固定内部渲染分辨率倍率(默认按实测帧时间自动调节)

`window.render_game_to_text()` 会返回当前游戏状态的 JSON,`window.advanceTime(ms)` 可以按固定步长推进游戏。
`window.__dshDebug` 是自动化测试专用的钩子(`place(x,z,yaw)` 传送、`startLevel(id)`、`give(kind,n)`、
`resetProgress()`、`enemies()` 等),让回归测试能在**一个页面里**跑完全部场景,而不是反复刷新。

性能与回归测试脚本:

```bash
node tools/perf.mjs 标签 3     # 固定机位测帧耗时 / draw call / 吞吐
node tools/mem.mjs             # 测纹理显存/绘制缓冲/JS 堆的构成
node tools/smoke.mjs           # 50+ 项操作流回归测试(默认无头运行,不弹窗口)
SMOKE_HEADFUL=1 node tools/smoke.mjs   # 想亲眼看它跑时才加这个
python tools/imgdiff.py 旧图目录 新图目录 机位...   # 截图结构对比
```
