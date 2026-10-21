#!/usr/bin/env bash
# Invoked by deploy-server.sh over SSH; no local Node.js/Docker required.
set -euo pipefail
umask 077
MODE=${1:?mode}; ROOT=${2:?root}; PROJECT=${3:?project}; RELEASE=${4:?release}
PUBLIC_URL=${5:?url}; BUILD_SHA=${6:?sha}; BUILD_TIME=${7:?time}
STATE="$ROOT/.deploy/releases/$RELEASE"
LOCK="$ROOT/.deploy/lock"
die() { echo "服务器发布失败：$*" >&2; exit 1; }
assert_owner() { [ "$(cat "$LOCK/owner" 2>/dev/null)" = "$RELEASE" ] || die "发布锁不属于本次操作"; }
unlock() { if [ "$(cat "$LOCK/owner" 2>/dev/null)" = "$RELEASE" ]; then rm -rf "$LOCK"; fi; }
if [ "$MODE" = cleanup ]; then unlock; exit 0; fi
[ -d "$ROOT" ] && [ ! -L "$ROOT" ] || die "项目目录不存在或是符号链接：$ROOT"
for tool in docker rsync curl; do command -v "$tool" >/dev/null || die "缺少 $tool"; done
docker compose version >/dev/null

discover() {
  local ids
  ids=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter 'label=com.docker.compose.service=app')
  [ -n "$ids" ] && [ "$(printf '%s\n' "$ids" | wc -l | tr -d ' ')" = 1 ] || die "需要且只能有一个运行中的 $PROJECT/app 容器"
  OLD_CONTAINER=$ids
  OLD_IMAGE=$(docker inspect -f '{{.Image}}' "$OLD_CONTAINER")
  WORKDIR=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$OLD_CONTAINER")
  local files
  files=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$OLD_CONTAINER")
  [ -n "$files" ] && [ "$files" != '<no value>' ] || die "无法读取现有 Compose 配置文件"
  IFS=',' read -r -a CONFIG_FILES <<< "$files"
  [ -d "$WORKDIR" ] || die "原 Compose working_dir 不存在"
  case "$WORKDIR/" in "$ROOT/"*) ;; *) die "Compose working_dir 不在目标项目目录内" ;; esac
  for file in "${CONFIG_FILES[@]}"; do
    case "$file" in "$ROOT/"*) ;; *) die "Compose 文件不在目标项目内：$file" ;; esac
    [ -f "$file" ] || die "原 Compose 文件不存在：$file"
  done
  ENV_FILE="$ROOT/deploy/.env"
  [ -f "$ENV_FILE" ] || die "服务器 deploy/.env 不存在"
  DATA_VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$OLD_CONTAINER")
  [ -n "$DATA_VOLUME" ] || die "应用 /data 不是命名数据卷，需先确认备份方式"
  local actual_url
  actual_url=$(docker exec "$OLD_CONTAINER" node -p 'process.env.AUTOPPT_PUBLIC_URL')
  [ "${actual_url%/}" = "$PUBLIC_URL" ] || die "容器正式地址与 $PUBLIC_URL 不一致，停止发布"
  echo "识别现有项目：${PROJECT}，数据卷：$DATA_VOLUME"
  printf '沿用 Compose：%s\n' "${CONFIG_FILES[@]}"
}

if [ "$MODE" = inspect ] || [ "$MODE" = prepare ]; then
  discover
  if [ "$MODE" = inspect ]; then exit 0; fi
  mkdir -p "$ROOT/.deploy/releases"
  mkdir "$LOCK" 2>/dev/null || die "已有发布锁：${LOCK}，请先确认是否有发布正在执行"
  printf '%s\n' "$RELEASE" > "$LOCK/owner"
  trap 'result=$?; if [ "$result" -ne 0 ]; then unlock; fi' EXIT
  mkdir -p "$STATE/config-before"
  printf '%s\n' "$WORKDIR" > "$STATE/workdir"
  printf '%s\n' "${CONFIG_FILES[@]}" > "$STATE/compose-files"
  printf '%s\n' "$OLD_CONTAINER" > "$STATE/old-container"
  printf '%s\n' "$OLD_IMAGE" > "$STATE/old-image"
  printf '%s\n' "$DATA_VOLUME" > "$STATE/data-volume"
  # Keep config snapshots private, separate from the synchronized source tree.
  for file in "${CONFIG_FILES[@]}" "$ENV_FILE"; do
    relative=${file#"$ROOT/"}
    mkdir -p "$STATE/config-before/$(dirname "$relative")"
    cp -p "$file" "$STATE/config-before/$relative"
  done
  printf '%s' "${8:?rsync exclusions}" | base64 -d > "$STATE/rsync.exclude"
  # Snapshot the previous source with hard links; ordinary rsync updates use
  # rename rather than --inplace, so the snapshot keeps the old file contents.
  # Avoid --backup + --delete: macOS openrsync skips deletions with that pairing.
  rsync -rtl --safe-links --link-dest="$ROOT" --exclude-from="$STATE/rsync.exclude" \
    "$ROOT/" "$STATE/source-before/"
  docker image tag "$OLD_IMAGE" "$PROJECT:before-$RELEASE"
  echo "已建立发布锁；旧镜像保留为 $PROJECT:before-$RELEASE"
  exit 0
fi

assert_owner
WORKDIR=$(cat "$STATE/workdir")
ENV_FILE="$ROOT/deploy/.env"
OLD_CONTAINER=$(cat "$STATE/old-container")
OLD_IMAGE=$(cat "$STATE/old-image")
DATA_VOLUME=$(cat "$STATE/data-volume")
CONFIG_FILES=()
while IFS= read -r file; do CONFIG_FILES+=("$file"); done < "$STATE/compose-files"
COMPOSE=(docker compose -p "$PROJECT" --project-directory "$WORKDIR" --env-file "$ENV_FILE")
for file in "${CONFIG_FILES[@]}"; do COMPOSE+=(-f "$file"); done
# Override only release metadata; server .env, model Keys and runtime options stay intact.
export AUTOPPT_BUILD_GIT_SHA="$BUILD_SHA" AUTOPPT_BUILD_TIME="$BUILD_TIME"
NEW_CONTAINER=''
STOPPED=0
on_exit() {
  local result=$?
  trap - EXIT
  if [ "$result" -ne 0 ]; then
    echo "发布失败；保留旧镜像 $PROJECT:before-$RELEASE 和 $STATE 下的备份。" >&2
    # Backup errors happen before Compose replaces the old container.
    if [ "$STOPPED" = 1 ] && docker inspect "$OLD_CONTAINER" >/dev/null 2>&1; then
      docker start "$OLD_CONTAINER" >/dev/null || true
    fi
    unlock
  fi
  exit "$result"
}
trap on_exit EXIT

validate_json='const [kind,sha,time,payload]=process.argv.slice(1);
const d=JSON.parse(Buffer.from(payload,"base64").toString());
if(kind==="health"){if(d.ok!==true||d.app!=="AutoPPT"||d.hosted!==true)throw Error("健康检查内容错误");}
else if(d.gitSha!==sha||d.buildTime!==time||d.runtimeMode!=="hosted")throw Error("公网版本不是本次发布");'

if [ "$MODE" = verify-public ]; then
  NEW_CONTAINER=$("${COMPOSE[@]}" ps -q app)
  docker exec "$NEW_CONTAINER" node -e "$validate_json" health "$BUILD_SHA" "$BUILD_TIME" "${8:?health}"
  docker exec "$NEW_CONTAINER" node -e "$validate_json" build "$BUILD_SHA" "$BUILD_TIME" "${9:?manifest}"
  printf '%s\n' "$RELEASE $BUILD_SHA $BUILD_TIME $PUBLIC_URL" > "$STATE/success"
  cp "$STATE/success" "$ROOT/.deploy/last-success"
  unlock
  exit 0
fi
[ "$MODE" = release ] || die "未知执行模式"
cd "$ROOT"
"${COMPOSE[@]}" config --quiet
# Validate the resolved mounts/address before stopping the old service. Never
# silently switch to a newly named empty volume after a Compose edit.
"${COMPOSE[@]}" config --format json | docker exec -i "$OLD_CONTAINER" node -e '
let text="";process.stdin.on("data",c=>text+=c);process.stdin.on("end",()=>{
 const config=JSON.parse(text),app=config.services.app;
 const mount=(app.volumes||[]).find(v=>v.target==="/data");
 if(!mount||mount.type!=="volume"||config.volumes[mount.source]?.name!==process.argv[1])throw Error("Compose 数据卷发生变化，停止发布");
 if(app.environment.AUTOPPT_PUBLIC_URL.replace(/\/$/,"")!==process.argv[2])throw Error("Compose 正式地址与预期不一致");
});' "$DATA_VOLUME" "$PUBLIC_URL"
# Build while the previous container is still serving traffic.
"${COMPOSE[@]}" build --build-arg "AUTOPPT_BUILD_GIT_SHA=$BUILD_SHA" \
  --build-arg "AUTOPPT_BUILD_TIME=$BUILD_TIME" app

echo "检查是否仍有生成任务（有任务则退出，不强制中断）"
docker exec -i "$OLD_CONTAINER" node --input-type=module <<'NODE'
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
const users=path.join(process.env.AUTOPPT_HOSTED_DATA_DIR||'/data','users');
let active=0;
for(const user of existsSync(users)?readdirSync(users):[]){
  const file=path.join(users,user,'autoppt.sqlite');
  if(!existsSync(file))continue;
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    db.exec('PRAGMA busy_timeout=5000');
    for(const row of db.prepare('SELECT data FROM records').iterate()){
      const item=JSON.parse(row.data);
      if(['queued','running'].includes(item.status)||['queued','running'].includes(item.performanceTask?.status))active++;
    }
  } finally {db.close();}
}
if(active){console.error(`仍有 ${active} 项任务；请等待完成后重新发布。`);process.exit(1);}
NODE

echo "正常停止应用并完整备份数据卷"
"${COMPOSE[@]}" stop app
STOPPED=1
docker run --rm --user root -v "$DATA_VOLUME:/data:ro" -v "$STATE:/backup" \
  "$OLD_IMAGE" node scripts/hosted-backup.mjs backup /data /backup/data.tar.gz
"${COMPOSE[@]}" up -d --no-deps --no-build --force-recreate app
STOPPED=0
NEW_CONTAINER=$("${COMPOSE[@]}" ps -q app)
[ -n "$NEW_CONTAINER" ] || die "更新后找不到应用容器"
NEW_VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$NEW_CONTAINER")
[ "$NEW_VOLUME" = "$DATA_VOLUME" ] || die "更新后的数据卷与原卷不同"

echo "等待容器健康检查（最多 180 秒）"
healthy=0
for ((attempt=0; attempt<60; attempt++)); do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$NEW_CONTAINER")
  case "$status" in healthy) healthy=1; break ;; unhealthy|exited|dead) break ;; esac
  sleep 3
done
if [ "$healthy" != 1 ]; then
  "${COMPOSE[@]}" logs --tail=80 app >&2
  die "应用未通过容器健康检查"
fi
docker exec "$NEW_CONTAINER" node -e '
const fs=require("fs");const [sha,time,url]=process.argv.slice(1);
for(const file of ["build-info.json","dist/build-info.json"]){const d=JSON.parse(fs.readFileSync(file));if(d.gitSha!==sha||d.buildTime!==time||d.runtimeMode!=="hosted")throw Error("镜像版本不匹配");}
if(process.env.AUTOPPT_PUBLIC_URL.replace(/\/$/,"")!==url)throw Error("正式访问地址变更");
' "$BUILD_SHA" "$BUILD_TIME" "$PUBLIC_URL"
# Server-side verification also checks the public LB and its frontend manifest.
for endpoint in health build; do
  if [ "$endpoint" = health ]; then url="$PUBLIC_URL/api/health"; else url="$PUBLIC_URL/build-info.json"; fi
  curl --fail --silent --show-error --connect-timeout 15 --max-time 30 \
    --retry 3 --retry-delay 3 "$url?deploy=$RELEASE" -o "$STATE/$endpoint.json"
  docker exec "$NEW_CONTAINER" node -e "$validate_json" "$endpoint" "$BUILD_SHA" "$BUILD_TIME" \
    "$(base64 < "$STATE/$endpoint.json" | tr -d '\r\n')"
done
echo "容器及服务器侧公网检查通过，等待 Mac 侧公网验收。"
# Keep the lock until verify-public completes or the local cleanup runs.
