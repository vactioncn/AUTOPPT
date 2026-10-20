# 完整 PPTX 字体包

维护者制作完整部署 ZIP 时使用 `npm run package:web -- 输出目录 --font-dir 完整字体包目录`。
打包器只接收五个经过授权与校验的 Jianghao / Noto SC 字面及清单，放在本目录。
Docker 将它们复制到 `/app/font-pack`，账号工作进程只读使用，不接触其他账号的数据。

Git 源码不包含字体二进制；直接从 Git 构建前需由维护者提供同一份字体包。
没有完整字体包时仍可使用文字编辑与 HTML 动效，但可编辑 PPTX 导出会明确报错。
本文件不是字体授权；每个字面的原始 OFL 许可证随 `manifest.json` 保存并写入 PPTX。
