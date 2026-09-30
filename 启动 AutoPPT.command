#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
node scripts/start.mjs
if [ $? -ne 0 ]; then
  read -k 1 "?按任意键关闭…"
fi
