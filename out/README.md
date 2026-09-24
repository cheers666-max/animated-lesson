# out/ · 生成的产物（不是源码）

| 文件 | 内容 |
|---|---|
| `intro-why-stroke-by-stroke.mp4` | **元课件**：用这个模式介绍这个模式（8 幕 / 226 秒 / 1920×1080） |
| `why-stroke-by-stroke.mp4` | **按笔画示例**：de Casteljau / A* / SDF 五个 case（5 幕 / 98 秒 / 1280×720） |
| `fourier-storyboard.png` | **傅立叶故事板**：16 帧一次看完 160 秒（4×4，带时间码，1895×1071） |
| `fourier.mp4` | **傅立叶变换**：主张→机制→量级→边界→推论 完整走一遍（5 幕 / 160 秒 / 1280×720） |

都是确定性时间轴逐帧导出的，无声，字幕已烘焙进画面（G12 量过像素才敢这么说）。

重新生成（帧直接管道进 ffmpeg，不落盘）：

```bash
# 元课件 1080p
node scripts/verify.mjs --deck='templates/deck.html?scenes=./scenes.about.js' \
     --mp4=out/intro-why-stroke-by-stroke.mp4 --fps=24 --size=1920x1080

# 按笔画示例 720p（快很多）
node scripts/verify.mjs --deck='templates/deck.html?scenes=./scenes.strokes.js' \
     --mp4=out/why-stroke-by-stroke.mp4 --fps=24 --size=1280x720

# 傅立叶 720p
node scripts/verify.mjs --deck='templates/deck.html?scenes=./scenes.fourier.js' \
     --mp4=out/fourier.mp4 --fps=24 --size=1280x720
```

重新生成故事板（挑 16 个「展开中 / 完成态」时刻，烧上时间码）：

```bash
FT=/System/Library/Fonts/Supplemental/Arial.ttf
SEL="eq(n,72)+eq(n,240)+eq(n,384)+eq(n,576)+eq(n,720)+eq(n,912)+eq(n,1200)+eq(n,1392)+eq(n,1680)+eq(n,1920)+eq(n,2400)+eq(n,2496)+eq(n,2784)+eq(n,2976)+eq(n,3288)+eq(n,3648)"
ffmpeg -y -i out/fourier.mp4 -vf "select='$SEL',scale=470:-1,\
  drawtext=fontfile=$FT:text='%{pts\:hms}':x=10:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=5,\
  tile=4x4:padding=5:color=0x0c0c10" -frames:v 1 out/fourier-storyboard.png
```

用浏览器直接看：<http://127.0.0.1:8099/intro.html>（先 `./serve.sh`）
