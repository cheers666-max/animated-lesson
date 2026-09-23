# out/ · 生成的产物（不是源码）

| 文件 | 内容 |
|---|---|
| `intro-why-stroke-by-stroke.mp4` | **元课件**：用这个模式介绍这个模式（8 幕 / 226 秒 / 1920×1080） |
| `why-stroke-by-stroke.mp4` | **按笔画示例**：de Casteljau / A* / SDF 五个 case（5 幕 / 98 秒 / 1280×720） |

都是确定性时间轴逐帧导出的，无声，字幕已烘焙进画面（G12 量过像素才敢这么说）。

重新生成（帧直接管道进 ffmpeg，不落盘）：

```bash
# 元课件 1080p
node scripts/verify.mjs --deck='templates/deck.html?scenes=./scenes.about.js' \
     --mp4=out/intro-why-stroke-by-stroke.mp4 --fps=24 --size=1920x1080

# 按笔画示例 720p（快很多）
node scripts/verify.mjs --deck='templates/deck.html?scenes=./scenes.strokes.js' \
     --mp4=out/why-stroke-by-stroke.mp4 --fps=24 --size=1280x720
```

用浏览器直接看：<http://127.0.0.1:8099/intro.html>（先 `./serve.sh`）
