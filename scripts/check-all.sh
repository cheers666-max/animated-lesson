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

  # 负向测试：证明门禁真的会失败。
  # 正向测试全绿只能说明"没坏"；如果哪天重构把某条门禁的判据写空了，
  # 7 份课件**依然会全绿** —— 只有这一步会红。
  run node scripts/gate-selftest.mjs
fi

echo
[ $FAIL -eq 0 ] && echo "✅ 全部通过" || echo "❌ 有失败项"
exit $FAIL
