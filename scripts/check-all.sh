#!/usr/bin/env bash
# 交付前一键：静态校验 + 四份课件的浏览器门禁 + 链接检查
#   ./scripts/check-all.sh            全部
#   ./scripts/check-all.sh --fast     只跑静态（不启浏览器）
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
run() { echo; echo "───── $* ─────"; "$@" || FAIL=1; }

run node scripts/lint-scenes.mjs
run node scripts/check-links.mjs

if [ "${1:-}" != "--fast" ]; then
  for s in about strokes instancing bindgroups photo fourier from-md-demo; do
    case "$s" in
      instancing) DECK="templates/deck.html" ;;
      *)          DECK="templates/deck.html?scenes=./scenes.$s.js" ;;
    esac
    run node scripts/verify.mjs --deck="$DECK"
  done
fi

echo
[ $FAIL -eq 0 ] && echo "✅ 全部通过" || echo "❌ 有失败项"
exit $FAIL
