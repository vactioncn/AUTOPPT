# 风格详情 · 第 1 套细胶片导航

日期：2026-10-21。范围：将用户选定的最后一组三案中的第 1 案应用到现有风格详情页。

## 对照与证据

- Source visual truth: `/Users/howell/.codex/visualizations/2026/10/21/01a15c34-fac8-7a30-9b6a-fb4d1f18e51a/05-quiet-filmstrip.png`
- Implementation: `http://127.0.0.1:4332/#styles`，打开“儿童摄影”，01 封面页，讲稿收起，客户身份。
- 实现截图：`.local/verification/style-filmstrip-20261021/screenshots/reference-cover.png`
- 全幅并排对照：`.local/verification/style-filmstrip-20261021/screenshots/comparison-full.png`
- 标题、使用入口、讲稿控件与缩略图的局部并排对照：`.local/verification/style-filmstrip-20261021/screenshots/comparison-details.png`
- 手机截图：`.local/verification/style-filmstrip-20261021/screenshots/mobile-cover.png` 与 `mobile-gallery.png`。
- 应用内浏览器实际操作截图：`.local/verification/style-filmstrip-20261021/screenshots/cua-final.png`。

源图与参考实现截图均为 1487 × 1058 像素；浏览器 CSS viewport 为 1487 × 1058，deviceScaleFactor 为 1，不需要密度缩放。并排图为 2974 × 1058，局部对照保持原像素尺寸。另外验证了 1440 × 1000、390 × 844；应用内浏览器为 1272 × 716。

已知内容差异：源图中的人物与页面是设计示意；实现沿用仓库现有的 32 张正式样例，未改图片或讲稿。源图的示意账号、导航数量与面包屑使用现有产品实现；自动化测试账号包含一个测试项目与一个测试风格。这些差异不作为布局问题。

## 发现与修正历史

1. 首次并排比较：`before-comparison-full.png`、`before-comparison-details.png`。
   - P2：右侧标题与主要按钮偏小，标题层级弱于选定方案。标题由 30 调为 36 px，按钮由 15 调为 18 px、高度由 52 调为 58 px；手机保留 24 px 标题。
   - P2：浏览器默认讲稿三角标记与目标中的整行展开入口不一致。替换为左右对齐文本及 Phosphor 下箭头，展开后旋转。
   - P2：桌面内容起点比目标偏低。详情页顶部内距从通用 38 调为 16 px；窄屏独立设为 28 px。
2. 修正后在相同视口、身份、封面与讲稿收起状态重新捕获，进行全幅和局部并排比较，证据见上。无剩余可执行的 P0/P1/P2 视觉问题。

## 五项视觉核对

- 字体与排印：沿用现有 Noto Sans SC / 产品字体回退，风格标题、说明、按钮和页码层级清楚；完整风格名与短标题区分展示，无截断。
- 间距与布局：左侧完整 16:9 大图、右侧说明、下方单排小图；大图不裁切、不受原弹窗高度限制。110 px 桌面小图、88 px 手机小图是为用户提出的“下面应该是小图”所作的有意收敛。手机改为大图、胶片导航、说明的纵向顺序，无页面横向溢出。
- 颜色：沿用产品暖灰底、深色正文与陶红操作色；仅当前小图使用陶红边框、下划线和文字，减少竞争。
- 图片质量：沿用正式 WebP 大图与小图资源，按原比例完整显示；未以 CSS、SVG 或占位图替代样例。封面与第三页均验证图片解码。
- 文案：使用真实风格说明、固定八页页型与讲稿；小图用短页型，辅助名称保留完整页型与标题，无原型说明文字混入用户界面。

## 交互与验证

- 点击小图、前后按钮、左右方向键，以及 01/08 循环切换通过。
- 8 张小图始终单排；窄屏切换至第 8 页时，选中小图自动进入可见范围。
- 讲稿可展开，切换页后收起；从列表小图进入时定位到对应页。
- 返回列表恢复滚动位置和触发按钮焦点；使用风格打开新建演讲；管理员高级设置与发布权限原有回归通过。
- 应用内浏览器实际核对下一页与直接点选；控制台错误为空。
- 独立副本生产构建通过；当前共享工作区 TypeScript 检查通过。
- `BROWSER_TEST=1 node --test tests/style-access.test.mjs tests/style-library.test.mjs tests/style-sample-suite.test.mjs`：7 项通过，0 失败。测试使用独立数据与合成发布样例，未调用模型。

## 交付检查

- [x] 所选方案已实现并完成两轮视觉对照。
- [x] 桌面与手机交互通过，使用说明同步。
- [x] 本地可操作预览保留。

范围限制：没有替换 `/Applications/AutoPPT.app` 或重启用户的正式服务；本次验证的是独立本地预览与代码改动。生成模型与生产发布不在本次验证范围。

final result: passed
