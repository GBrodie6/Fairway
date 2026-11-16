// ?debug overlay: frame time, draw calls, triangles, texture memory, active tier, exposure.
const fmtBytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB');

export function createDebugOverlay(root, { engine, loop, getExtra }) {
  const el = document.createElement('pre');
  el.id = 'fw-debug';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:absolute;left:8px;top:8px;margin:0;padding:8px 10px;z-index:40;pointer-events:none;' +
    'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#d8f5d0;background:rgba(6,14,10,0.72);' +
    'border-radius:8px;white-space:pre;max-width:92vw;overflow:hidden';
  root.appendChild(el);
  let acc = 0;
  return {
    el,
    update(dt) {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      const s = engine.stats, ls = loop.stats, mem = engine.memoryEstimate();
      const sys = Object.entries(ls.perSystem).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`).join('  ');
      const extra = getExtra ? getExtra() : '';
      el.textContent =
        `tier ${engine.tier.id}  ${engine.width}x${engine.height} @${engine.pixelRatio.toFixed(2)}  ${engine.orientation}\n` +
        `frame ${(ls.dt * 1000).toFixed(1)} ms  ${ls.fps.toFixed(0)} fps  cpu ${ls.cpuAvg.toFixed(1)} ms\n` +
        `draws ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k  geo ${s.geometries}  tex ${s.textures}  prog ${s.programs}\n` +
        `texture mem ${fmtBytes(mem.textures)}  targets ${fmtBytes(mem.renderTargets)}\n` +
        `exposure ${engine.exposure.value.toFixed(3)}  luma ${engine.post.state.measured.luma.toFixed(0)} / ${engine.exposure.target}\n` +
        `budget draws ${engine.tier.budget.drawCalls}  tris ${(engine.tier.budget.triangles / 1000).toFixed(0)}k\n` +
        (sys ? `ms: ${sys}\n` : '') + (extra || '');
    },
    dispose() { el.remove(); },
  };
}
