# huashu-motion 对讲好 / PPT 的价值实测

日期：2026-10-18。结论：适合作为**动态讲解页和视频交付的实验引擎**，值得借鉴其动画工程协议与可定位修改方式。此次没有接入正式工作台，也没有验证任意讲稿自动生成。

## 先看 demo

《一页 PPT，怎样让人看懂？》：40 秒、5 个场景、1920 × 1080、30 fps，配本机合成音乐与 14 个音效，无口播。内容为虚构季度订单汇报，所有数据明确标为演示用途。

- 本次本机入口：[连续播放 / 逐步讲](http://127.0.0.1:4337/?studio=4850)。本机服务运行时可用；不是公网地址。
- 本次编辑入口：[huashu-motion 原生 Studio](http://127.0.0.1:4850/)。右侧可改标题、数据、颜色，支持撤回。
- 本机成品：`.local/huashu-motion-eval-20261018/web/demo.mp4`。
- 可编辑工程：`.local/huashu-motion-eval-20261018/web/source.zip`。
- 原生分享页：本机入口下的 `native.html`。
- 视觉源码与制作计划：`site/huashu-motion-lab/`。

「连续播放」播放完整样片；「逐步讲」在 10 个讲述节点停住，可推进与退回。逐步模式默认静音。「全屏」为占满浏览器内容区域的演讲视图，内置浏览器也可使用；Escape 退出。手机控制区可用，但画面仍保持 16:9，建议横屏观看图表；没有声称为手机重新编排画面。

## 它是什么

核查的上游：[alchaincyf/huashu-motion](https://github.com/alchaincyf/huashu-motion)，版本 `0.1.0`，提交 `3e927801e78b587878fb7dbb65d616326df00c21`。

它提供导演规则、Agent skill、动画运行时、命令行工具、浏览器编辑器和导出管线。Agent 编写 HTML / GSAP / SVG 等代码，Chrome 渲染画面，FFmpeg 输出视频。它不提供新的通用 AI 模型，不依赖视频生成模型。本次实际使用了上游的 `new`、`doctor`、`learn`、`check`、`still`、`sound`、`studio`、`render`、`qa`、`export html`；不是只阅读 README 后另做一个无关动画。

本次未安装全局 skill，使用 `/tmp/huashu-motion-eval-20261018` 中的隔离检出。渲染和配乐没有调用收费模型 API；这不表示编写代码的 Agent 推理没有成本。

## 对 PPT 的价值

| 用途 | 判断 | 本次证据 / 限制 |
|---|---|---|
| 关键观点、数据和关系分步出现 | 高 | 同一数据页可先呈现坐标、再出柱形图、最后给结论；论证链逐节点出现 |
| 演讲开场、章节过场、产品讲解短片 | 高 | 可控制完整时间线、统一品牌字形配色，并输出带声音的 MP4 |
| 局部修改与版本恢复 | 高 | Studio 中 Q4 从 60 改为 45，图表、算式、结论同步改为 +50%；撤回后恢复 60 与 +100% |
| 网页播放、视频交付复用同一画面 | 高 | 同一工程经原生工具导出网页与 H.264/AAC 视频 |
| 现场讲述控制 | 中，需要适配 | 原生时间线偏连续影片；本次额外写了 10 步演讲播放器，支持停住与退回 |
| 让用户自行调整所有文字和图表 | 中，需要作者提前设计 | 声明为 composition variables 的字段可直接改；任意排版、长文案、图表结构仍需改代码并复核 |
| 上传任意文件后自动生成整套 PPT | 本次不能证明 | 样片由 Agent 明确编写分镜、布局和时间线，没有通用文档转换链路 |
| 可编辑 PPTX / PowerPoint 原生动画 | 不覆盖 | 上游输出重心是 HTML 与视频。放进 PPT 的 MP4 仍是视频，不会成为可单独编辑的文字、图形和动画对象 |

最值得引入的是三件事：**内容对象有稳定标识、动画是时间的确定函数、画面与编辑参数/声音共享时间线**。这让局部修改、回看某一帧、生成关键帧与视频更容易验证。单纯增加一批入场动效的收益较小。

## 实测结果

| 检查 | 结果 |
|---|---|
| 环境 | macOS，Node 22.22.3，Chrome 155.0.8059.80，FFmpeg / ffprobe 均通过 `om doctor` |
| 上游完整测试 | 135 项：125 通过、9 跳过、1 失败。失败是混响性能门槛：1623 ms 超过 1500 ms |
| 失败项单独重跑 | 通过，混响 237 ms；说明存在并发负载下的计时波动，没有把首轮说成全绿 |
| 样片静态与浏览器检查 | `om check` 24 个采样帧、4 次不同路径定位比较；0 错误、11 个低对比警告，无历史依赖警告 |
| 画面检查 | 查看了 5 个主要定格帧与转场帧；修正了延迟入场前可能闪现、首帧空白两项问题 |
| 原生编辑 | Q4 数值修改、衍生结论计算、撤回恢复、预览保持时间点均实际操作验证 |
| 配乐 | 原创 ABC 乐谱 185 音符；本机合成 40 秒音轨，14 个音效；-14.0 LUFS，峰值 -1.6 dBFS |
| 视频输出 | 40.000 秒，1920 × 1080，30 fps，H.264 + AAC 双声道 / 48 kHz；最后一次含配乐的导出约 21.1 秒，仅代表本机此次记录 |
| 视频 QA | 未检出单帧闪跳；检出 24 / 32 秒两个硬切及多段阅读停留。阅读停留是本片的演讲设计，不表示自动 QA 全绿 |
| 网页交互 | 完整播放至 40 秒、播放/暂停、章节定位、逐步停住、退回、声音开关、浏览区域全屏已实测 |
| 手机包装页 | 390 × 844 检查，页面没有横向溢出，主要控制按钮高度 44 px；画面依然按 16:9 缩放 |
| 源码交付 | 原生 `source.zip` 完整性检查通过，字体与 GSAP 许可随工程携带 |
| 复现脚本 | 从新目录构建成功；构建后的上游 source check 为 0 错误、0 警告 |

保留的限制与发现：

- `om check` 的 11 项对比度提示包括正在入场的聚合容器、旋转纸页小字和弱化文字，不能简单等同于“整体画面不可读”，也没有全部静默屏蔽。主要定格画面未见标题裁切或图表重叠，仍需使用者看实际投影效果。
- 音轨能量差较小，上游提示整体偏平。已检查音轨时长、频谱、峰值及落点；未做人工听感评分，也未测试真实乐器采样与人声。
- 视频导出出现 Node `MaxListenersExceededWarning`，仍成功产出视频。内置浏览器调试日志也出现过未归属到文件的 `MutationObserver.observe` 异常，完整播放和操作未受阻；未确认其根因，不能宣称所有浏览器零错误。
- 本次没有实测“指着画面留言 → Agent 修改 → 回复评论”的完整闭环；该功能有上游代码和测试，但不可把数值直接编辑测试当作评论闭环已验收。
- 没有验证 Safari、Windows、非开发机、超长演讲、PPTX 导入与原生动画导出。

检查记录、关键帧、音频频谱与渲染日志留在 `.local/huashu-motion-eval-20261018/`，不提交生成素材和用户工作区数据。

## 建议怎么用于讲好

第一步只支持主动选择的一页或一段内容：**选择页面 → 动态讲解试做 → 审看 → 保存独立版本 → 网页播放 / 导出视频**。原页面及已有 PPTX 保留。优先验证数据比较、步骤流程、结论聚焦三种明确场景。

可复用当前 `server/content-planning.mjs`、`server/screen-copy.mjs` 的内容约束与讲稿完整性检查；为新的 HTML 动画保存独立分镜、素材、源码、依赖版本、讲述节点、检查报告和导出版本。现有 `server/motion/` 与 `shared/motion/` 有独立动态演示基础，不能直接将本片固定时间点当作所有文稿的通用协议。

正式接入还要解决：自动分镜质量、长文案适配、可逆讲述状态、生成 HTML 的沙箱、外部资源/网络限制、取消与重试、版本隔离、字幕与配音同步、渲染资源占用。当前实验只证明这一份内容的制作和交付链路可行。

上游自有代码为 MIT；GSAP 和字体分别保留各自许可。此次没有使用作者的“豆子花叔”角色。产品化应保留随附第三方许可清单。

## 复现

在仓库根目录执行。输出必须是新目录，脚本拒绝覆盖已有工程，以保护 Studio 中的修改。

```sh
git clone https://github.com/alchaincyf/huashu-motion.git /tmp/huashu-motion-eval
git -C /tmp/huashu-motion-eval checkout 3e927801e78b587878fb7dbb65d616326df00c21
node scripts/build-huashu-motion-demo.mjs /tmp/huashu-motion-eval .local/huashu-motion-new/demo
node /tmp/huashu-motion-eval/cli/om.js check .local/huashu-motion-new/demo
node /tmp/huashu-motion-eval/cli/om.js render .local/huashu-motion-new/demo --workers 4
node scripts/package-huashu-motion-demo.mjs /tmp/huashu-motion-eval .local/huashu-motion-new/demo .local/huashu-motion-new/web
python3 -m http.server 4337 --bind 127.0.0.1 --directory .local/huashu-motion-new/web
```

另一个终端可运行 `node /tmp/huashu-motion-eval/cli/om.js studio .local/huashu-motion-new/demo --port 4850 --no-open`。若端口被占用，选择未使用端口，不要停止现有业务服务。网页用本机 HTTP 打开；直接双击含 iframe 的 HTML 可能受浏览器同源策略限制。MP4 可直接打开。

复现需要上游的 Node 22+、本机 Chrome/Chromium/Edge、FFmpeg；网页本身无 CDN 或模型依赖。Mac App、业务后端、现有项目及模型配置均未更改。
