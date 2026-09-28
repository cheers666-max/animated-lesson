/**
 * scripts/inference-numbers.mjs — 复算「带宽与 KV Cache」这一课里的每一个数字
 *
 * 纪律：课件里的数字必须**可复核**，不能从文章里抄。
 * 这份脚本是那份课件所有数字的唯一来源 —— 跑一遍就知道课里有没有编数。
 *
 *   node scripts/inference-numbers.mjs
 */
const GB = 1e9, GiB = 1024 ** 3, TB = 1e12;
const fmt = (x, d = 1) => x.toFixed(d);

const rows = [];
const say = (a, b, c = '') => rows.push([a, b, c]);

// ---------------------------------------------------------------- 1. 三段路
// 公开规格，逐个列出出处，方便别人不同意时能直接对着查
const ROADS = [
  ['磁盘 → 显存（货轮）', 'PCIe 4.0 ×16', 32 * GB, 'PCIe 4.0 x16 单向 32 GB/s（规范值）'],
  ['磁盘本身', 'NVMe SSD', 7 * GB, '消费级旗舰 NVMe 顺序读 ~7 GB/s'],
  ['显存 → 计算单元（公路）', 'H100 SXM HBM3', 3.35 * TB, 'H100 SXM 规格 3.35 TB/s'],
  ['', 'A100 80G HBM2e', 2.039 * TB, 'A100 80GB 规格 2039 GB/s'],
  ['', 'RTX 4090 GDDR6X', 1.008 * TB, 'RTX 4090 规格 1008 GB/s'],
];

// ---------------------------------------------------------------- 2. 量化：动的是分子
const WEIGHTS_GB = { 'fp16 (2 B/参数)': 140, 'INT8 (1 B/参数)': 70, 'INT4 (0.5 B/参数)': 35 };
const H100 = 3.35 * TB;
const quant = Object.entries(WEIGHTS_GB).map(([k, gb]) => ({
  k, gb, ms: (gb * GB) / H100 * 1e3,
}));
const q16 = quant[0].ms, q4 = quant[2].ms;

// ---------------------------------------------------------------- 3. KV Cache 公式
// 2 × 层数 × KV头 × head_dim × 精度字节 × 序列长 × batch
const KV = { name: 'Llama-2-70B (GQA)', layers: 80, kvHeads: 8, headDim: 128, bytes: 2 };
const perToken = 2 * KV.layers * KV.kvHeads * KV.headDim * KV.bytes;
const kvGB = (seq, batch) => (perToken * seq * batch) / GB;

// ---------------------------------------------------------------- 4. batch 曲线
const HBM = 80;                    // H100 80GB
const WEIGHTS = 35;                // INT4 后的权重
const SEQ = 4096;
const batchCurve = [1, 8, 16, 24, 36].map((b) => {
  const kv = kvGB(SEQ, b);
  const ms = ((WEIGHTS + kv) * GB) / H100 * 1e3;
  return { b, kv, ms, tps: (b / ms) * 1000 };
});
const maxBatch = Math.floor((HBM - WEIGHTS) / kvGB(SEQ, 1));
const kvAtMax = kvGB(SEQ, maxBatch);

// ---------------------------------------------------------------- 输出
console.log('\n\x1b[1m① 三段路：速度差三个数量级\x1b[0m');
for (const [hop, spec, bw, src] of ROADS) {
  console.log(`   ${(hop || '　').padEnd(26)} ${spec.padEnd(20)} ${fmt(bw / GB, 0).padStart(6)} GB/s   \x1b[2m${src}\x1b[0m`);
}
console.log(`   \x1b[2m芯片内（L2 / SRAM）随架构差异很大，本课不依赖这个数，避免编造\x1b[0m`);

console.log('\n\x1b[1m② 量化动的是分子（H100 3.35 TB/s 不变）\x1b[0m');
for (const q of quant) {
  console.log(`   70B 参数压成 ${String(q.gb).padStart(3)} GB  →  ${fmt(q.ms, 1).padStart(5)} ms / token`);
}
console.log(`   \x1b[32m比值：${fmt(q16 / q4, 1)}×   —— 路的规格一次都没出现变化\x1b[0m`);

console.log('\n\x1b[1m③ KV Cache：公式里六项都是事实\x1b[0m');
console.log(`   ${KV.name}`);
console.log(`   2 × ${KV.layers} 层 × ${KV.kvHeads} KV头 × ${KV.headDim} 维 × ${KV.bytes} B`);
console.log(`   = ${perToken.toLocaleString()} B/token = ${fmt(perToken / 1024 / 1024, 3)} MiB/token`);

console.log('\n\x1b[1m④ batch 为什么不能无限大（INT4 权重 ${WEIGHTS} GB + KV，H100 80 GB）\x1b[0m');
for (const r of batchCurve) {
  console.log(`   batch=${String(r.b).padStart(2)}  KV=${fmt(r.kv, 1).padStart(5)} GB   每 token ${fmt(r.ms, 1).padStart(5)} ms   吞吐 ${fmt(r.tps, 0).padStart(4)} token/s`);
}
console.log(`   \x1b[33m第一条墙（显存）：${SEQ} token 时每条约 ${fmt(kvGB(SEQ, 1), 2)} GB，最多塞 ${maxBatch} 条（KV 占 ${fmt(kvAtMax, 0)} GB）\x1b[0m`);
console.log(`   \x1b[33m延迟并没有"不涨"：batch 1 → ${maxBatch}，每 token 从 ${fmt(batchCurve[0].ms, 1)} ms 涨到 ${fmt(((WEIGHTS + kvAtMax) * GB) / H100 * 1e3, 1)} ms（${fmt(((WEIGHTS + kvAtMax) * GB) / H100 * 1e3 / batchCurve[0].ms, 1)}×），而吞吐涨 ${fmt((maxBatch / (((WEIGHTS + kvAtMax) * GB) / H100 * 1e3)) / (1 / batchCurve[0].ms), 0)}×\x1b[0m`);

console.log('\n\x1b[1m⑤ 同一辆车，两种厨师（decode 由公路决定）\x1b[0m');
const a100 = 2.039 * TB, r4090 = 1.008 * TB;
console.log(`   A100 公路 ${fmt(a100 / TB, 2)} TB/s ÷ 4090 公路 ${fmt(r4090 / TB, 2)} TB/s = ${fmt(a100 / r4090, 2)}×`);
console.log(`   \x1b[2m（消费卡标称 FP16 算力并不低；本课只说"decode 阶段公路决定结果"这个可验证的部分）\x1b[0m`);

console.log('\n\x1b[1m⑥ 一句话公式\x1b[0m');
console.log(`   总耗时 ≈ 要搬运的总字节数 ÷ 带宽`);
console.log(`   分母 3.35 TB/s 是死的 → 一切优化都在动分子\n`);

// 给课件用的紧凑数据
console.log('\x1b[2m── 课件直接引用的值 ──\x1b[0m');
console.log(JSON.stringify({
  roads: { pcie: 32, ssd: 7, h100: 3350, a100: 2039, rtx4090: 1008 },
  quant: { fp16: { gb: 140, ms: +q16.toFixed(1) }, int4: { gb: 35, ms: +q4.toFixed(1) }, ratio: +(q16 / q4).toFixed(1) },
  kv: { ...KV, perTokenB: perToken, perTokenMiB: +(perToken / 1024 / 1024).toFixed(3) },
  batch: { seq: SEQ, weights: WEIGHTS, hbm: HBM, maxBatch, kvPerSeq: +kvGB(SEQ, 1).toFixed(2) },
}, null, 1));
