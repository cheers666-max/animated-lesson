/**
 * scripts/fourier-numbers.mjs —— 傅立叶课件里每一个数字的来源
 *
 * scenes.fourier.js 里的数字不是抄的、也不是估的，是这个脚本算出来的。
 * 数字进课件前必须能这样复现 —— 否则「量级」这一环就是编的。
 *
 *   node scripts/fourier-numbers.mjs
 */
const S = (x, N) => { let s = 0; for (let k = 1; k <= N; k += 2) s += Math.sin(k * x) / k; return 4 / Math.PI * s; };
const T = (x) => S(x, 20001);
console.log('【1】RMS 误差（排除跳变点 ±0.05 rad 的邻域，跳变处的"真值"本身无定义）');
console.log('    跳变幅度 = 2（从 -1 到 +1），误差按幅度归一化');
for (const N of [1, 3, 5, 9, 21, 49, 99, 499]) {
  let se = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const x = -Math.PI + 2 * Math.PI * i / 4000;
    if (Math.abs(Math.abs(x) - Math.PI) < 0.05 || Math.abs(x) < 0.05) continue;
    const d = S(x, N) - T(x); se += d * d; n++;
  }
  console.log(`  N=${String(N).padStart(3)}  RMS = ${(Math.sqrt(se / n) / 2 * 100).toFixed(3)}%`);
}
console.log('\n【2】吉布斯超调（跳变附近峰值 − 平台值 1），以跳变幅度 2 归一化');
for (const N of [9, 99, 999, 20001]) {
  let mx = 0; for (let i = 1; i < 40000; i++) { const v = S(Math.PI * i / 40000, N); if (v > mx) mx = v; }
  console.log(`  N=${String(N).padStart(5)}  峰值 ${mx.toFixed(6)}  →  超调 ${(mx - 1).toFixed(6)}  = 跳变幅度的 ${((mx - 1) / 2 * 100).toFixed(3)}%  （平台值的 +${((mx - 1) * 100).toFixed(2)}%）`);
}
console.log('\n【3】频谱泄漏：sin(3t) 在长度 T 的窗口上做投影');
console.log('    T = 整周期 → 完全正交；T 略偏离整周期 → 邻频被"看见"');
for (const periods of [1, 1.0, 1.25, 1.5, 2]) {
  const T3 = periods * 2 * Math.PI / 3;
  const K = 20000; const mag = (w) => { let re = 0, im = 0; for (let i = 0; i < K; i++) { const t = T3 * i / K, f = Math.sin(3 * t); re += f * Math.cos(w * t); im -= f * Math.sin(w * t); } return Math.hypot(re, im) / K; };
  const near = mag(3 * 1.5);
  console.log(`  窗口 = ${periods} 个周期   |ω=3|=${mag(3).toFixed(4)}   |ω=4.5|=${near.toFixed(4)}   ← 泄漏`);
}
console.log('\n【4】时频测不准：高斯窗 σ_t · σ_ω（角频率）');
for (const s of [0.25, 0.5, 1, 2]) {
  const g = (t) => Math.exp(-t * t / (2 * s * s));
  const W = 60, K = 200000, dt = 2 * W / K;
  let m0 = 0, m2 = 0;
  for (let i = 0; i < K; i++) { const t = -W + i * dt, v = g(t); m0 += v * dt; m2 += t * t * v * dt; }
  const G = (w) => s * Math.sqrt(2 * Math.PI) * Math.exp(-s * s * w * w / 2);
  const FK = 200000, dW = 40 / FK; let f0 = 0, f2 = 0;
  for (let j = 0; j < FK; j++) { const w = -20 + j * dW, v = G(w); f0 += v * dW; f2 += w * w * v * dW; }
  console.log(`  σ_t=${String(s).padEnd(4)}  σ_ω=${Math.sqrt(f2 / f0).toFixed(4)}   σ_t·σ_ω = ${(Math.sqrt(m2 / m0) * Math.sqrt(f2 / f0)).toFixed(4)}`);
}
