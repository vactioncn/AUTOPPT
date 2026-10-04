---
name: oss-web-deploy
description: Publish the AutoPPT product introduction to a named subdirectory on show.turing.art using ossutil. Use when the user asks to deploy or publish this project's static introduction.
---

# AutoPPT 产品介绍页发布

基于技术部提供的 oss-web-deploy 适配。此项目包含 Node.js 后端、数据库、模型密钥与私人素材；只发布独立静态介绍页，不发布完整制作工作台。

## 执行

用户说“将介绍页部署到 autoppt”时，在项目根目录运行：

```sh
npm run deploy:intro -- autoppt --dry-run
npm run deploy:intro -- autoppt
```

也可使用技能目录里的 `deploy.sh autoppt`，脚本会定位项目根目录。

- 使用用户明确给出或已确认的子目录；没有指定时询问目录。`skill-web` 只是同事示例，不是默认目标。
- 目标必须是单个 1–63 位的小写字母、数字、短横线或下划线组成的名称，首位为字母或数字。
- 发布前检查该目录已有内容；如属于其他网站，不覆盖，应换用用户确认的目录。
- 先预演并检查文件清单。正式发布授权沿用用户在当前会话中的指令，不重复询问。
- 发布完成后以脚本的公网验证结果为准；上传成功但验证失败时，明确区分，不声称部署成功。

## 构建与范围

`scripts/deploy-intro.mjs` 从介绍页源码在临时目录构建页面、CSS、JS、指南及明确引用的图片；无需构建整个应用。它适配网站子目录路径，不改变本机 `dist/`、`.local/` 或运行中的服务，不调用模型。

目标固定为 `oss://turing-show/<目录>/`，网址为 `https://show.turing.art/<目录>/`。禁止上传项目根目录、整个 `dist/`、`.local/`、`.env`、密钥、依赖或源码。禁止桶根目录发布或删除。使用 `ossutil sync` 更新同名文件，不使用 `--delete`，保留目标中的其他文件。

## 本机配置

优先使用 `~/.local/bin/ossutil`，否则从 PATH 查找。优先使用 `~/.config/oss-web-deploy/ossutilconfig`，否则使用 `~/.ossutilconfig`。可通过 `OSSUTIL_BIN`、`OSSUTIL_CONFIG_FILE` 显式指定。

配置文件只保存在仓库外，权限为 0600；不得输出或提交密钥，不覆盖已有授权配置。缺少授权时按 README 与 `docs/维护与同步.md` 处理。原始资料与包含密钥的配置不加入仓库。

如果用户要求完整制作工作台在线使用，说明还需单独部署后端、身份认证和数据存储，不把静态介绍页当作完整应用上线。
