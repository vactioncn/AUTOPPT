#!/usr/bin/env bash
# macOS Bash 3.2 / built-in rsync compatible. Run from any working directory.
set -euo pipefail

SOURCE_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
REMOTE_HOST=${AUTOPPT_DEPLOY_HOST:-root@8.154.36.165}
REMOTE_ROOT=${AUTOPPT_DEPLOY_ROOT:-/opt/AutoPPT-Web}
PROJECT=${AUTOPPT_COMPOSE_PROJECT:-autoppt-web}
PUBLIC_URL=${AUTOPPT_DEPLOY_URL:-https://aippt.pinguo.cn}
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      cat <<'HELP'
Usage: bash scripts/deploy-server.sh [--dry-run]
Default: root@8.154.36.165:/opt/AutoPPT-Web, project autoppt-web
--dry-run: read server deployment metadata and preview rsync; no writes/restart.
Optional environment: AUTOPPT_DEPLOY_HOST, AUTOPPT_DEPLOY_ROOT,
AUTOPPT_COMPOSE_PROJECT, AUTOPPT_DEPLOY_URL.
HELP
      exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "发布失败：$*" >&2; exit 1; }
for tool in ssh rsync git curl mktemp base64 tar; do
  command -v "$tool" >/dev/null || die "本机缺少 $tool"
done
[[ "$REMOTE_HOST" =~ ^[a-zA-Z0-9_.@:-]+$ ]] || die "SSH 地址格式无效"
[[ "$REMOTE_ROOT" =~ ^/[a-zA-Z0-9_./-]+$ ]] &&
  [[ "$REMOTE_ROOT" != / && "$REMOTE_ROOT" != *..* ]] || die "远程目录格式无效"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "Compose 项目名格式无效"
[[ "$PUBLIC_URL" == https://* && "$PUBLIC_URL" != *\?* && "$PUBLIC_URL" != *\#* ]] || die "公网地址必须是 HTTPS 根地址"
PUBLIC_URL=${PUBLIC_URL%/}
GIT_ROOT=$(git -C "$SOURCE_ROOT" rev-parse --show-toplevel) || die "需要有效的本地 Git 仓库"
[ "$(cd "$GIT_ROOT" && pwd -P)" = "$SOURCE_ROOT" ] || die "发布脚本必须位于当前 Git 仓库根目录的 scripts 中，不能从旧发行目录发布"
[ -z "$(git -C "$SOURCE_ROOT" status --porcelain --untracked-files=no)" ] || die "请先验证并提交已完成代码，再发布准确的 Git 版本"
BUILD_SHA=$(git -C "$SOURCE_ROOT" rev-parse HEAD) || die "需要有效的本地 Git 提交记录"
[[ "$BUILD_SHA" =~ ^[0-9a-f]{40}$ ]] || die "无法取得完整 Git SHA"
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
RELEASE_ID=$(date -u +%Y%m%dT%H%M%SZ)-${BUILD_SHA:0:8}-$$
SSH_OPTIONS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
RSYNC_SSH='ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3'
REMOTE_HELPER="$SOURCE_ROOT/scripts/deploy-remote.sh"

# Quote each argument for the remote POSIX shell, including literal quotes.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
remote() {
  local command="bash -s --" argument
  for argument in "$@"; do command="$command $(quote "$argument")"; done
  ssh "${SSH_OPTIONS[@]}" "$REMOTE_HOST" "$command" < "$REMOTE_HELPER"
}

echo "目标：$REMOTE_HOST:$REMOTE_ROOT ($PROJECT)"
echo "公网：$PUBLIC_URL"
TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/autoppt-deploy.XXXXXX")
PREPARED=0
STARTED=0
cleanup() {
  local result=$?
  trap - EXIT
  if [ "$PREPARED" = 1 ] && [ "$STARTED" = 0 ]; then
    remote cleanup "$REMOTE_ROOT" "$PROJECT" "$RELEASE_ID" "$PUBLIC_URL" "$BUILD_SHA" "$BUILD_TIME" || true
  fi
  rm -rf "$TEMP_DIR"
  if [ "$result" -ne 0 ]; then
    echo "发布未通过验收（退出码 ${result}），不会报告成功。" >&2
    echo "请检查服务器日志及 $REMOTE_ROOT/.deploy/releases/${RELEASE_ID}；配置和数据卷未删除。" >&2
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "[1/5] 生成已提交代码快照：$BUILD_SHA"
mkdir -p "$TEMP_DIR/source"
git -C "$SOURCE_ROOT" archive "$BUILD_SHA" | tar -xf - -C "$TEMP_DIR/source"
# Use the snapshotted helper for all mutations, so local edits cannot change it mid-release.
REMOTE_HELPER="$TEMP_DIR/source/scripts/deploy-remote.sh"
if [ "$DRY_RUN" = 1 ]; then
  remote inspect "$REMOTE_ROOT" "$PROJECT" "$RELEASE_ID" "$PUBLIC_URL" "$BUILD_SHA" "$BUILD_TIME"
  rsync -rtzln --delete-after --itemize-changes --safe-links \
    --exclude-from="$TEMP_DIR/source/deploy/rsync.exclude" \
    -e "$RSYNC_SSH" "$TEMP_DIR/source/" "$REMOTE_HOST:$REMOTE_ROOT/"
  echo "预演完成；未同步文件、未构建、未重启。"
  exit 0
fi
echo "[2/5] 检查服务器并锁定发布"
remote prepare "$REMOTE_ROOT" "$PROJECT" "$RELEASE_ID" "$PUBLIC_URL" "$BUILD_SHA" "$BUILD_TIME" \
  "$(base64 < "$TEMP_DIR/source/deploy/rsync.exclude" | tr -d '\r\n')"
PREPARED=1
echo "[3/5] rsync 增量同步代码；备份被替换或删除的源码"
rsync -rtzl --delete-after --itemize-changes --safe-links \
  --exclude-from="$TEMP_DIR/source/deploy/rsync.exclude" \
  -e "$RSYNC_SSH" "$TEMP_DIR/source/" "$REMOTE_HOST:$REMOTE_ROOT/"
echo "[4/5] 构建、备份、更新应用并检查容器"
STARTED=1
remote release "$REMOTE_ROOT" "$PROJECT" "$RELEASE_ID" "$PUBLIC_URL" "$BUILD_SHA" "$BUILD_TIME"
STARTED=0
echo "[5/5] 从 Mac 检查公网 HTTPS"
curl --fail --silent --show-error --connect-timeout 15 --max-time 30 \
  --retry 3 --retry-delay 3 "$PUBLIC_URL/api/health?deploy=$RELEASE_ID" \
  -o "$TEMP_DIR/public-health.json"
# Server-side probe already validated JSON and version. Also ensure this Mac
# sees the same public manifest (rather than an old LB backend/cache).
curl --fail --silent --show-error --connect-timeout 15 --max-time 30 \
  --retry 3 --retry-delay 3 "$PUBLIC_URL/build-info.json?deploy=$RELEASE_ID" \
  -o "$TEMP_DIR/public-build.json"
remote verify-public "$REMOTE_ROOT" "$PROJECT" "$RELEASE_ID" "$PUBLIC_URL" "$BUILD_SHA" "$BUILD_TIME" \
  "$(base64 < "$TEMP_DIR/public-health.json" | tr -d '\r\n')" \
  "$(base64 < "$TEMP_DIR/public-build.json" | tr -d '\r\n')"
PREPARED=0
echo "发版成功：$PUBLIC_URL"
echo "发布编号：$RELEASE_ID"
echo "版本：$BUILD_SHA / $BUILD_TIME"
