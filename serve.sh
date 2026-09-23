#!/usr/bin/env bash
# 本地预览：讲解动画需要 ES module + CDN，file:// 起不来
#   ./serve.sh            默认 8099
#   PORT=9000 ./serve.sh
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8099}"

cat <<EOF

  动画讲解课 · 本地预览
  ────────────────────────────────────────
  介绍页      http://127.0.0.1:${PORT}/intro.html          ← 背景/优势/场景/人群，一页看完
  元课件      http://127.0.0.1:${PORT}/templates/deck.html?scenes=./scenes.about.js
  按笔画案例  http://127.0.0.1:${PORT}/templates/deck.html?scenes=./scenes.strokes.js
  参考课件    http://127.0.0.1:${PORT}/templates/deck.html
  自动播放    http://127.0.0.1:${PORT}/templates/deck.html?autoplay=1
  开旁白      http://127.0.0.1:${PORT}/templates/deck.html?narrate=1
  强制 2D     http://127.0.0.1:${PORT}/templates/deck.html?three=off
  录制模式    http://127.0.0.1:${PORT}/templates/deck.html?capture=1

  快捷键：空格 播放/暂停 · ←/→ 换幕 · J/K ±5s · 1-9 跳幕 · Q 出题

  Ctrl-C 退出
EOF

exec python3 -m http.server "$PORT" --bind 127.0.0.1
