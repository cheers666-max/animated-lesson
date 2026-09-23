/**
 * animated-lesson · engine/three-adapter.js
 *
 * three.js 适配器。**关键约束：three.js 不在就降级，绝不让一页变空白。**
 * 录制/离线/内网场景经常拉不到 CDN —— 那时自动走 2D 等距投影（el.fallback），
 * 并在元素上打 data-fallback="1"，verify.mjs 会检查降级路径也能渲染出内容。
 *
 * 三种可用性来源：
 *   1. 本地：<script type="importmap"> 里映射了 three（推荐内网/离线）
 *   2. CDN：默认 unpkg，可用 window.THREE_URL 覆盖
 *   3. 降级：上面都不行 → 2D isometric fallback
 */

const CDN = 'https://unpkg.com/three@0.180.0/build/three.module.js';

export function createThreeAdapter({ root, palette }) {
  let THREE = null;
  let loadState = 'loading';      // loading | ready | fallback
  const mounted = [];             // { el, node, ctx, update, dispose }
  let loader = null;

  const THREE_URL = (typeof window !== 'undefined' && window.THREE_URL)
    || new URLSearchParams(location.search).get('three')
    || CDN;
  const DISABLED = typeof window !== 'undefined'
    && (window.__NO_THREE__ === true || new URLSearchParams(location.search).get('three') === 'off');

  function ensureThree() {
    if (loader) return loader;
    if (DISABLED) { loadState = 'fallback'; loader = Promise.resolve(null); return loader; }
    loader = import(/* @vite-ignore */ THREE_URL)
      .then((m) => { THREE = m; loadState = 'ready'; return m; })
      .catch(() => { loadState = 'fallback'; return null; });
    return loader;
  }

  function sizeOf(node) {
    const r = node.getBoundingClientRect();
    const k = r.width / Math.max(1, node.offsetWidth || r.width);
    return { w: Math.max(200, Math.round(node.offsetWidth || r.width)), h: Math.max(140, Math.round(node.offsetHeight || r.height)), k };
  }

  function mount(el, node) {
    // 立刻放一个 canvas：three 还没到之前画占位/降级内容，避免闪烁空白
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const ctx = canvas.getContext('2d');
    node.append(canvas);
    const rec = { el, node, canvas, ctx, update: null, dispose: null, three: null };
    mounted.push(rec);

    const resize = () => {
      const { w, h } = sizeOf(node);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (rec.three) {
        rec.three.renderer.setSize(w, h, false);
        rec.three.camera.aspect = w / h;
        rec.three.camera.updateProjectionMatrix();
      }
    };
    rec.resize = resize;
    resize();

    ensureThree().then((mod) => {
      if (!mod) { node.dataset.fallback = '1'; rec.mode = 'fallback'; return; }
      rec.mode = 'three';
      try {
        const { renderer, scene, camera, dispose } = buildThreeScene(mod, el, node, palette());
        rec.three = { renderer, scene, camera };
        rec.dispose = dispose;
        resize();
        const update = el.init(mod, el, { ...paletteCtx(), renderer, scene, camera });
        rec.update = typeof update === 'function' ? update : null;
      } catch (err) {
        console.warn('[animated-lesson] three 场景构建失败，降级 2D:', err);
        node.dataset.fallback = '1';
        rec.mode = 'fallback';
      }
    });
  }

  function paletteCtx() {
    return { palette: palette() };
  }

  /** el.init 只负责"往 scene 里塞东西"，相机/渲染器由适配器给默认值，作者可用 el.camera 覆盖。 */
  function buildThreeScene(THREE, el, node, pal) {
    const { w, h } = sizeOf(node);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    node.querySelector('canvas')?.remove();
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    node.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camSpec = el.camera ?? {};
    const camera = camSpec.ortho
      ? new THREE.OrthographicCamera(-6, 6, 3.6, -3.6, 0.1, 200)
      : new THREE.PerspectiveCamera(camSpec.fov ?? 42, w / h, 0.1, 200);
    camera.position.set(...(camSpec.pos ?? [7, 5.5, 9]));
    camera.lookAt(...(camSpec.look ?? [0, 0.6, 0]));
    if (!camSpec.noLights) {
      scene.add(new THREE.AmbientLight(0xffffff, camSpec.ambient ?? 0.62));
      const d = new THREE.DirectionalLight(0xffffff, camSpec.key ?? 1.25);
      d.position.set(6, 9, 5);
      scene.add(d);
      const d2 = new THREE.DirectionalLight(pal.accent ? new THREE.Color(pal.accent) : 0x88bbff, 0.5);
      d2.position.set(-7, 3, -6);
      scene.add(d2);
    }
    return {
      renderer, scene, camera,
      dispose: () => { renderer.dispose(); renderer.domElement.remove(); },
    };
  }

  /** 2D 等距投影降级：同一份动画语义，只是没有 z-buffer 与抗锯齿光照。 */
  function drawFallback(el, node, t, ctx2d, w, h, pal) {
    const c = ctx2d;
    c.setTransform(Math.min(2, window.devicePixelRatio || 1), 0, 0, Math.min(2, window.devicePixelRatio || 1), 0, 0);
    c.clearRect(0, 0, w, h);
    const fb = el.fallback;
    if (typeof el.fallback2d === 'function') { el.fallback2d(c, t, el, { w, h, palette: pal }); return; }
    if (!fb) {
      c.fillStyle = pal.muted; c.font = '13px ui-monospace, monospace';
      c.fillText('three.js 不可达且未提供 fallback', 14, 24);
      return;
    }
    const boxes = typeof fb.boxes === 'function' ? fb.boxes(t, el) : fb.boxes ?? [];
    const spin = (fb.spin ?? 0.5) * t;
    const cx = w / 2, cy = h * 0.62, s = (fb.scale ?? 34);
    const rot = (x, z) => [x * Math.cos(spin) - z * Math.sin(spin), x * Math.sin(spin) + z * Math.cos(spin)];
    const proj = (x, y, z) => {
      const [rx, rz] = rot(x, z);
      return [cx + (rx - rz * 0.0) * s * 0.86, cy + (rx + rz) * s * 0.34 - y * s];
    };
    for (const b of boxes) {
      const [px0, py0, pz0] = [b.x ?? 0, b.y ?? 0, b.z ?? 0];
      const bs = b.s ?? 1;
      const corners = [
        [px0 - bs / 2, py0, pz0 - bs / 2], [px0 + bs / 2, py0, pz0 - bs / 2],
        [px0 + bs / 2, py0, pz0 + bs / 2], [px0 - bs / 2, py0, pz0 + bs / 2],
      ].map(([x, y, z]) => proj(x, y, z));
      const top = [[px0 - bs / 2, py0 + bs, pz0 - bs / 2], [px0 + bs / 2, py0 + bs, pz0 - bs / 2],
        [px0 + bs / 2, py0 + bs, pz0 + bs / 2], [px0 - bs / 2, py0 + bs, pz0 + bs / 2]].map(([x, y, z]) => proj(x, y, z));
      const a = b.alpha ?? 1;
      c.globalAlpha = a;
      c.fillStyle = b.color ?? pal.accent;
      // 侧面
      c.beginPath();
      c.moveTo(corners[1][0], corners[1][1]); c.lineTo(corners[2][0], corners[2][1]);
      c.lineTo(top[2][0], top[2][1]); c.lineTo(top[1][0], top[1][1]); c.closePath();
      c.globalAlpha = a * 0.62; c.fill();
      c.beginPath();
      c.moveTo(corners[2][0], corners[2][1]); c.lineTo(corners[3][0], corners[3][1]);
      c.lineTo(top[3][0], top[3][1]); c.lineTo(top[2][0], top[2][1]); c.closePath();
      c.globalAlpha = a * 0.45; c.fill();
      // 顶面
      c.beginPath();
      c.moveTo(top[0][0], top[0][1]);
      for (let i = 1; i < 4; i++) c.lineTo(top[i][0], top[i][1]);
      c.closePath();
      c.globalAlpha = a; c.fill();
    }
    c.globalAlpha = 1;
  }

  function update(el, node, t, api) {
    const rec = mounted.find((r) => r.el === el);
    if (!rec) return;
    if (rec.mode === 'three' && rec.update) {
      rec.update(t, el, { ...api, renderer: rec.three.renderer, scene: rec.three.scene, camera: rec.three.camera, THREE });
      rec.three.renderer.render(rec.three.scene, rec.three.camera);
      return;
    }
    const { w, h } = sizeOf(node);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (rec.canvas.width !== Math.round(w * dpr)) rec.resize();
    drawFallback(el, node, t, rec.ctx, w, h, api.palette ?? {});
  }

  return {
    mount, update,
    get mode() { return loadState; },
    dispose() { for (const r of mounted) r.dispose?.(); mounted.length = 0; },
  };
}

export default { createThreeAdapter };
