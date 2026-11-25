/* Motor de dibujo de .drawio · traducción fiel a JavaScript de motor_drawio.py (mismo resultado visual):
   carriles con color por organización, actividades con borde del color de su área, decisiones en ámbar,
   flechas ortogonales redondeadas con saltos en los cruces, leyenda y paso a paso. Escala 1,5 respecto al original. */
'use strict';
const MD = (() => {
  const S = 1.5;
  const PAPER = '#f5f5f5', INK = '#2d3142', MUTED = '#4f5d75', SOFT = '#5a6580';
  const F_SANS = "Figtree, 'Segoe UI', system-ui, sans-serif", F_MONO = F_SANS;
  const SANS = 0.60, MONO = 0.62;
  const PALETTE = [
    ['SUPERVIS', {band: '#f3dedb', lane: '#fcf4f3', lane2: '#f9eeec', ink: '#9a3a32'}],
    ['CLIENTE', {band: '#e9def3', lane: '#f8f4fb', lane2: '#f3edf8', ink: '#6b4c9a'}],
    ['OFICINA', {band: '#dae6f5', lane: '#f3f7fc', lane2: '#ebf1f9', ink: '#2e5aa8'}],
    ['SUBCONTRAT', {band: '#dcebd2', lane: '#f3f9ef', lane2: '#ebf4e5', ink: '#3f7a2c'}],
    ['CONSTRUC', {band: '#f1e4c6', lane: '#fcf7ec', lane2: '#f8f0de', ink: '#8a6210'}],
    ['PRODUC', {band: '#f1e4c6', lane: '#fcf7ec', lane2: '#f8f0de', ink: '#8a6210'}],
    ['CALIDAD', {band: '#d6ecec', lane: '#f1f8f8', lane2: '#e8f3f3', ink: '#2a7373'}],
    ['', {band: '#e4e7ee', lane: '#f6f7f9', lane2: '#eef0f4', ink: '#4f5d75'}],
  ];
  const NOTE_FILL = {'#fff2cc': ['#fff6d6', '#c9a227'], '#dae8fc': ['#e9f0fa', '#6c8ebf']};
  const e1 = v => (Math.round(v * 10) / 10).toFixed(1);          // :.1f
  const g = v => String(+(+v).toFixed(4));                         // :g
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;'}[c]));
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, '').toUpperCase();
  const palette = name => { const n = norm(name); for (const [k, p] of PALETTE) if (n.includes(k)) return p; return PALETTE[PALETTE.length - 1][1]; };
  function sty(st) { const d = {}; for (const part of (st || '').split(';')) { const i = part.indexOf('='); if (i >= 0) d[part.slice(0, i)] = part.slice(i + 1); else if (part) d[part] = '1'; } return d; }
  const _ta = document.createElement('textarea');
  const unesc = v => { _ta.innerHTML = v; return _ta.value; };
  function labelLines(v) {
    v = String(v || '').replace(/<br\s*\/?>|<\/div>|<\/p>|<\/li>|<div[^>]*>|<p[^>]*>|<li[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
    v = unesc(unesc(v)).replace(/ /g, ' ').split(/%3CmxGraphModel|<mxGraphModel/)[0];
    return v.split('\n').filter(l => l.trim()).map(l => l.replace(/\s+/g, ' ').trim());
  }
  function wrap(text, size, width, em = SANS) {
    const out = [];
    for (const para of text) { let cur = '';
      for (const w of para.split(/\s+/).filter(Boolean)) { const t = (cur + ' ' + w).trim(); if (t.length * size * em <= width || !cur) cur = t; else { out.push(cur); cur = w; } }
      if (cur) out.push(cur); }
    return out;
  }
  function fit(lines, w, h, size0, smin = 8.0, lh = 1.18, em = SANS) {
    let size = size0;
    while (true) {
      const wl = wrap(lines, size, Math.max(w, 10), em);
      const widest = Math.max(0, ...wl.map(l => l.length * size * em));
      if ((wl.length * size * lh <= h && widest <= w) || size <= smin) return [wl, size];
      size -= 0.5;
    }
  }
  // ------------------------------------------------------------------ lectura
  function Diagram(model) {
    const cells = new Map(), st = new Map();
    for (const el of model.getElementsByTagName('mxCell')) {
      const p = el.parentElement; const obj = p && (p.localName === 'object' || p.localName === 'UserObject') ? p : null;
      const id = obj ? obj.getAttribute('id') : el.getAttribute('id'); if (id == null) continue;
      const c = {el, id, value: obj ? (obj.getAttribute('label') || '') : el.getAttribute('value'), parent: el.getAttribute('parent'),
        vertex: el.getAttribute('vertex') === '1', edge: el.getAttribute('edge') === '1', source: el.getAttribute('source'), target: el.getAttribute('target'),
        geo: [...el.children].find(x => x.localName === 'mxGeometry') || null};
      cells.set(id, c); st.set(id, sty(el.getAttribute('style')));
    }
    const abs = new Map();
    const D = {cells, st, title: null};
    D.geo = i => { const gg = cells.get(i).geo; if (!gg) return [0, 0, 0, 0]; const f = k => parseFloat(gg.getAttribute(k) || 0) || 0; return [f('x'), f('y'), f('width'), f('height')]; };
    D.origin = i => {
      if (abs.has(i)) return abs.get(i); const c = cells.get(i);
      if (!c || !c.vertex) { abs.set(i, [0, 0]); return [0, 0]; }
      const [x, y] = D.geo(i); const [px, py] = D.origin(c.parent); const r = [px + x, py + y]; abs.set(i, r); return r;
    };
    D.box = i => { const [x, y] = D.origin(i); const [, , w, h] = D.geo(i); return [x, y, w, h]; };
    return D;
  }
  function classify(D, i) {
    const c = D.cells.get(i), s = D.st.get(i); const txt = labelLines(c.value).join(' ');
    if (s.shape === 'image' || ('image' in s && !['', '1'].includes(s.image))) return 'image';
    if ('swimlane' in s) return 'lane';
    if (s.shape === 'ext') return 'band';
    if ('rhombus' in s || s.shape === 'mxgraph.flowchart.decision') return 'gw';
    if (s.shape === 'note') return 'note';
    if (s.shape === 'mxgraph.basic.document' || s.shape === 'document') return 'doc';
    if (s.shape === 'mxgraph.flowchart.database' || (s.shape || '').includes('cylinder')) return 'db';
    if ('ellipse' in s) return 'ellipse';
    if ('text' in s || (s.strokeColor === 'none' && (s.fillColor === undefined || s.fillColor === 'none'))) return 'text';
    if (['INICIO', 'FIN', 'INICIO DEL PROCESO', 'FIN DEL PROCESO'].includes(norm(txt))) return 'term';
    return 'task';
  }
  function build(D) {
    const verts = [...D.cells.values()].filter(c => c.vertex && !(D.cells.get(c.parent) && D.cells.get(c.parent).edge)).map(c => c.id);
    const edgeLabels = new Map();
    for (const c of D.cells.values()) { const p = D.cells.get(c.parent);
      if (c.vertex && p && p.edge) { if (!edgeLabels.has(c.parent)) edgeLabels.set(c.parent, []); edgeLabels.get(c.parent).push(...labelLines(c.value)); } }
    const kinds = new Map(verts.map(i => [i, classify(D, i)]));
    for (const i of verts) if (kinds.get(i) === 'text' && parseFloat(D.st.get(i).fontSize || 11) >= 14) { D.title = labelLines(D.cells.get(i).value).join(' '); kinds.set(i, 'title'); }
    const topLane = i => { let cur = i, top = null; while (D.cells.has(cur) && D.cells.get(cur).vertex) { if (kinds.get(cur) === 'lane') top = cur; cur = D.cells.get(cur).parent; } return top; };
    const laneBoxes = verts.filter(i => kinds.get(i) === 'lane' && !(D.cells.get(D.cells.get(i).parent) && D.cells.get(D.cells.get(i).parent).vertex)).map(i => [i, D.box(i)]);
    const group = new Map();
    for (const i of verts) {
      let gg = topLane(i);
      if (gg === null && !['lane', 'title'].includes(kinds.get(i))) { const [x, y, w, h] = D.box(i); const cx = x + w / 2, cy = y + h / 2;
        for (const [li, [lx, ly, lw, lh]] of laneBoxes) if (lx <= cx && cx <= lx + lw && ly <= cy && cy <= ly + lh) gg = li; }
      group.set(i, gg);
    }
    return [verts, kinds, group, edgeLabels];
  }
  // ------------------------------------------------------------------ rutas
  function sidePoint(b, side, along = null) {
    const [x, y, w, h] = b;
    if (side === 'L') return [x, along !== null ? along : y + h / 2];
    if (side === 'R') return [x + w, along !== null ? along : y + h / 2];
    if (side === 'T') return [along !== null ? along : x + w / 2, y];
    return [along !== null ? along : x + w / 2, y + h];
  }
  function facing(b, p) {
    const [x, y, w, h] = b;
    if (x + 6 <= p[0] && p[0] <= x + w - 6) return [p[1] < y ? 'T' : 'B', Math.min(Math.max(p[0], x + 8), x + w - 8)];
    if (y + 6 <= p[1] && p[1] <= y + h - 6) return [p[0] < x ? 'L' : 'R', Math.min(Math.max(p[1], y + 8), y + h - 8)];
    const cx = x + w / 2, cy = y + h / 2, dx = (p[0] - cx) / Math.max(w, 1), dy = (p[1] - cy) / Math.max(h, 1);
    if (Math.abs(dx) >= Math.abs(dy)) return [dx < 0 ? 'L' : 'R', null];
    return [dy < 0 ? 'T' : 'B', null];
  }
  function constrained(b, s, pre) {
    if ((pre + 'X') in s && (pre + 'Y') in s) {
      const fx = parseFloat(s[pre + 'X']), fy = parseFloat(s[pre + 'Y']); const [x, y, w, h] = b;
      let p = [x + fx * w, y + fy * h];
      let side = fx <= 0.001 ? 'L' : fx >= 0.999 ? 'R' : fy <= 0.001 ? 'T' : fy >= 0.999 ? 'B' : null;
      if (side === null) { side = [['L', fx], ['R', 1 - fx], ['T', fy], ['B', 1 - fy]].reduce((a, c) => c[1] < a[1] ? c : a)[0]; p = sidePoint(b, side, 'LR'.includes(side) ? p[1] : p[0]); }
      return [side, p];
    }
    return [null, null];
  }
  function autoSide(a, b) {
    const [ax, ay, aw, ah] = a, [bx, by, bw, bh] = b;
    const ox = Math.min(ax + aw, bx + bw) - Math.max(ax, bx), oy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    if (ox > 16) return [by > ay ? 'B' : 'T', (Math.max(ax, bx) + Math.min(ax + aw, bx + bw)) / 2];
    if (oy > 16) return [bx > ax ? 'R' : 'L', (Math.max(ay, by) + Math.min(ay + ah, by + bh)) / 2];
    const dx = (bx + bw / 2) - (ax + aw / 2), dy = (by + bh / 2) - (ay + ah / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return [dx > 0 ? 'R' : 'L', null];
    return [dy > 0 ? 'B' : 'T', null];
  }
  function route(sb, tb, wps, s, sp = null, tp = null) {
    let [ss, p0] = sb ? constrained(sb, s, 'exit') : [null, null];
    let [ts, pn] = tb ? constrained(tb, s, 'entry') : [null, null];
    if (!sb) { p0 = sp; ss = null; }
    if (!tb) { pn = tp; ts = null; }
    let along;
    if (sb && p0 === null) {
      const ref = wps.length ? wps[0] : tb ? [tb[0] + tb[2] / 2, tb[1] + tb[3] / 2] : pn;
      if (!wps.length && tb) [ss, along] = autoSide(sb, tb); else [ss, along] = facing(sb, ref);
      p0 = sidePoint(sb, ss, along);
    }
    if (tb && pn === null) {
      const ref = wps.length ? wps[wps.length - 1] : p0;
      if (!wps.length && sb) { [ts, along] = autoSide(tb, sb);
        if (('LR'.includes(ss) && 'LR'.includes(ts)) || ('TB'.includes(ss) && 'TB'.includes(ts))) along = null; }
      else [ts, along] = facing(tb, ref);
      pn = sidePoint(tb, ts, along);
    }
    const pts = [p0, ...wps, pn].map(p => [p[0], p[1]]);
    for (let k = 1; k < pts.length - 1; k++) for (const j of [k - 1, k + 1]) { const a = pts[j], b = pts[k];
      if (Math.abs(a[0] - b[0]) < 4) b[0] = a[0]; if (Math.abs(a[1] - b[1]) < 4) b[1] = a[1]; }
    if (pts.length === 2) { const [a, b] = pts;
      if (Math.abs(a[0] - b[0]) < 4 && (ss === 'T' || ss === 'B' || ss === null)) pts[1] = [a[0], b[1]];
      else if (Math.abs(a[1] - b[1]) < 4 && (ss === 'L' || ss === 'R' || ss === null)) pts[1] = [b[0], a[1]]; }
    const out = [pts[0]]; let ori = (ss === 'L' || ss === 'R') ? 'h' : 'v';
    for (let k = 1; k < pts.length; k++) {
      const prev = out[out.length - 1], q = pts[k];
      if (prev[0] === q[0] || prev[1] === q[1]) { out.push(q); ori = prev[0] === q[0] ? 'v' : 'h'; continue; }
      const last = k === pts.length - 1;
      if (last && ts) { const need = (ts === 'L' || ts === 'R') ? 'h' : 'v';
        if (need === 'h' && ori === 'h') { const mx = (prev[0] + q[0]) / 2; out.push([mx, prev[1]], [mx, q[1]], q); }
        else if (need === 'v' && ori === 'v') { const my = (prev[1] + q[1]) / 2; out.push([prev[0], my], [q[0], my], q); }
        else out.push(need === 'v' ? [q[0], prev[1]] : [prev[0], q[1]], q);
        ori = need; }
      else if (ori === 'h') { out.push([q[0], prev[1]], q); ori = 'v'; } else { out.push([prev[0], q[1]], q); ori = 'h'; }
    }
    const clean = [out[0]];
    for (const p of out.slice(1)) { const l = clean[clean.length - 1]; if (Math.abs(p[0] - l[0]) < 0.01 && Math.abs(p[1] - l[1]) < 0.01) continue; clean.push(p); }
    let k = 1;
    while (k < clean.length - 1) { const a = clean[k - 1], b = clean[k], c = clean[k + 1];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) {
        if ((a[0] === b[0] && b[0] === c[0] && (b[1] - a[1]) * (c[1] - b[1]) >= 0) || (a[1] === b[1] && b[1] === c[1] && (b[0] - a[0]) * (c[0] - b[0]) >= 0)) { clean.splice(k, 1); continue; } }
      k++; }
    return clean;
  }
  function pathD(pts, hops, r = 7, hr = 4.5) {
    let d = 'M' + e1(pts[0][0]) + ' ' + e1(pts[0][1]);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (hops[k - 1]) { const sgn = b[0] > a[0] ? 1 : -1;
        for (const hx of hops[k - 1]) d += ' H' + e1(hx - sgn * hr) + ' A' + hr + ' ' + hr + ' 0 0 ' + (sgn > 0 ? 1 : 0) + ' ' + e1(hx + sgn * hr) + ' ' + e1(a[1]); }
      if (k === pts.length - 1) { d += ' L' + e1(b[0]) + ' ' + e1(b[1]); break; }
      const c = pts[k + 1];
      const l1 = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), l2 = Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      if (rr < 0.5 || l1 === 0 || l2 === 0) { d += ' L' + e1(b[0]) + ' ' + e1(b[1]); continue; }
      const ux = (b[0] - a[0]) / l1, uy = (b[1] - a[1]) / l1, vx = (c[0] - b[0]) / l2, vy = (c[1] - b[1]) / l2;
      d += ' L' + e1(b[0] - ux * rr) + ' ' + e1(b[1] - uy * rr) + ' A' + e1(rr) + ' ' + e1(rr) + ' 0 0 ' + (ux * vy - uy * vx > 0 ? 1 : 0) + ' ' + e1(b[0] + vx * rr) + ' ' + e1(b[1] + vy * rr);
    }
    return d;
  }
  function imagenHref(ref) {
    ref = (ref || '').trim(); if (!ref.startsWith('data:')) return null;
    let [head, ...rest] = ref.split(','); if (!head.includes(';base64') && !head.startsWith('data:image/svg+xml')) head += ';base64';
    return head + ',' + rest.join(',');
  }
  const cmpYX = B => (a, b) => B.get(a)[1] - B.get(b)[1] || B.get(a)[0] - B.get(b)[0];
  // ------------------------------------------------------------------ render
  function render(model, slug, nombre) {
    const D = Diagram(model);
    const [verts, kinds, group, elabels] = build(D);
    const B = new Map(); for (const i of verts) { const [x, y, w, h] = D.box(i); B.set(i, [x * S, y * S, w * S, h * S]); }
    const content = verts.filter(i => kinds.get(i) !== 'title');
    const xs = [...content.map(i => B.get(i)[0]), ...content.map(i => B.get(i)[0] + B.get(i)[2])];
    const ys = [...content.map(i => B.get(i)[1]), ...content.map(i => B.get(i)[1] + B.get(i)[3])];
    const E = [];
    for (const c of D.cells.values()) {
      if (!c.edge) continue; const i = c.id, s = D.st.get(i);
      let src = c.source, tgt = c.target;
      const [ox, oy] = D.origin(c.parent); const gg = c.geo;
      let wps = [], sp = null, tp = null;
      if (gg) { const arr = [...gg.children].find(x => x.localName === 'Array');
        if (arr) wps = [...arr.children].filter(p => p.localName === 'mxPoint').map(p => [((parseFloat(p.getAttribute('x')) || 0) + ox) * S, ((parseFloat(p.getAttribute('y')) || 0) + oy) * S]);
        for (const p of [...gg.children].filter(p => p.localName === 'mxPoint')) { const pt = [((parseFloat(p.getAttribute('x')) || 0) + ox) * S, ((parseFloat(p.getAttribute('y')) || 0) + oy) * S];
          if (p.getAttribute('as') === 'sourcePoint') sp = pt; if (p.getAttribute('as') === 'targetPoint') tp = pt; } }
      const sb = B.has(src) ? B.get(src) : null, tb = B.has(tgt) ? B.get(tgt) : null;
      if ((!sb && !sp) || (!tb && !tp)) continue;
      const pts = route(sb, tb, wps, s, sp, tp);
      const lab = [...labelLines(c.value), ...(elabels.get(i) || [])];
      E.push({id: i, s: sb ? src : null, t: tb ? tgt : null, pts, dash: s.dashed === '1', arrow: (s.endArrow || 'classic') !== 'none',
        startArrow: !['none', ''].includes(s.startArrow || 'none'), label: lab.join(' '), lx: gg ? (parseFloat(gg.getAttribute('x')) || 0) : 0});
      for (const p of pts) { xs.push(p[0]); ys.push(p[1]); }
    }
    if (!xs.length) { xs.push(0, 200); ys.push(0, 100); }
    const minx = Math.min(...xs) - 40, miny = Math.min(...ys) - 40, dx = -minx, dy = -miny;
    for (const [i, [x, y, w, h]] of B) B.set(i, [x + dx, y + dy, w, h]);
    for (const e of E) e.pts = e.pts.map(p => [Math.round((p[0] + dx) * 10) / 10, Math.round((p[1] + dy) * 10) / 10]);
    const VW = Math.ceil((Math.max(...xs) + dx + 40) / 4) * 4;
    const LEG_Y = Math.max(...ys) + dy + 36;
    let VH = Math.ceil((LEG_Y + 50) / 4) * 4;
    // saltos en cruces
    const vert = []; E.forEach((e, k) => { for (let j = 1; j < e.pts.length; j++) { const a = e.pts[j - 1], b = e.pts[j]; if (a[0] === b[0]) vert.push([k, a[0], Math.min(a[1], b[1]), Math.max(a[1], b[1])]); } });
    E.forEach((e, k) => { e.hops = {};
      for (let j = 0; j < e.pts.length - 1; j++) { const a = e.pts[j], b = e.pts[j + 1]; if (a[1] !== b[1]) continue;
        const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
        const hs = [...new Set(vert.filter(([m, x, y1, y2]) => m !== k && lo + 9 < x && x < hi - 9 && y1 + 4 < a[1] && a[1] < y2 - 4).map(v => Math.round(v[1] * 10) / 10))].sort((p, q) => p - q);
        if (hs.length) e.hops[j] = b[0] > a[0] ? hs : hs.reverse(); } });
    // pasos
    const nodes = content.filter(i => ['task', 'term', 'gw', 'doc', 'db', 'ellipse'].includes(kinds.get(i)));
    const flow = E.filter(e => e.arrow && B.has(e.s) && B.has(e.t));
    const out = new Map(), indeg = new Map();
    for (const e of flow) { if (!out.has(e.s)) out.set(e.s, []); out.get(e.s).push(e.t); indeg.set(e.t, (indeg.get(e.t) || 0) + 1); }
    let starts = nodes.filter(i => norm(labelLines(D.cells.get(i).value).join(' ')).startsWith('INICIO'));
    if (!starts.length) { starts = nodes.filter(i => !(indeg.get(i) || 0) && (out.get(i) || []).length); if (!starts.length) starts = nodes.slice(0, 1); }
    const level = new Map(), q = [];
    for (const s0 of [...starts].sort(cmpYX(B))) { level.set(s0, 0); q.push(s0); }
    while (q.length) { const u = q.shift(); for (const v of [...(out.get(u) || [])].sort(cmpYX(B))) if (!level.has(v)) { level.set(v, level.get(u) + 1); q.push(v); } }
    let mx = Math.max(0, ...level.values());
    for (const i of nodes.filter(i => !level.has(i)).sort((a, b) => B.get(a)[0] - B.get(b)[0] || B.get(a)[1] - B.get(b)[1])) { mx += 1; level.set(i, mx); }
    const attached = new Map();
    for (const e of E) for (const [x_, y_] of [[e.s, e.t], [e.t, e.s]])
      if (B.has(x_) && level.has(y_) && !level.has(x_) && ['note', 'doc', 'db', 'task', 'gw', 'band', 'text'].includes(kinds.get(x_))) { if (!attached.has(y_)) attached.set(y_, []); attached.get(y_).push(x_); }
    const stepOf = new Map(); let step = 0;
    for (const lv of [...new Set(level.values())].sort((a, b) => a - b)) {
      const members = [...level.keys()].filter(i => level.get(i) === lv).sort(cmpYX(B)); let budget = 0; step += 1;
      for (const i of members) {
        const cost = 1 + (attached.get(i) || []).length + E.filter(e => (e.t === i && (stepOf.has(e.s) || !level.has(e.s))) || (e.s === i && (stepOf.has(e.t) || !level.has(e.t)))).length;
        if (budget && budget + cost > 12) { step += 1; budget = 0; }
        stepOf.set(i, step); budget += cost;
        for (const a of (attached.get(i) || [])) if (!stepOf.has(a)) stepOf.set(a, step);
      }
    }
    for (const e of E) { const m = Math.max(stepOf.get(e.s) || 0, stepOf.get(e.t) || 0); e.step = m || null; }
    const STEPS = Math.max(1, ...stepOf.values());
    // SVG
    const title = D.title || nombre;
    const o = [];
    o.push('<title id="' + slug + '-title">' + esc(title.slice(0, 90)) + '</title>');
    o.push('<desc id="' + slug + '-desc">Flujograma convertido desde draw.io (' + esc(nombre) + '): carriles por responsable, actividades, decisiones y conexiones del proceso.</desc>');
    o.push('<defs><marker id="' + slug + '-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="' + MUTED + '"/></marker>' +
      '<marker id="' + slug + '-arrow-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto"><polygon points="8 0, 0 3, 8 6" fill="' + MUTED + '"/></marker></defs>');
    o.push('');   // fondo (se completa al final)
    const textos = [];
    const lanes = content.filter(i => kinds.get(i) === 'lane');
    const depth = i => kinds.get(D.cells.get(i).parent) !== 'lane' ? 0 : 1 + depth(D.cells.get(i).parent);
    const laneCount = new Map();
    for (const i of [...lanes].sort((a, b) => depth(a) - depth(b) || B.get(a)[1] - B.get(b)[1] || B.get(a)[0] - B.get(b)[0])) {
      const [x, y, w, h] = B.get(i), s = D.st.get(i); const top = group.get(i) || i;
      const pal = palette(labelLines(D.cells.get(top).value).join(' ')); const par = D.cells.get(i).parent;
      laneCount.set(par, (laneCount.get(par) || 0) + 1); const fill = laneCount.get(par) % 2 ? pal.lane : pal.lane2;
      const ss = parseFloat(s.startSize || 23) * S, horiz = (s.horizontal || '1') !== '0', d0 = depth(i) === 0;
      o.push('<rect x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(w) + '" height="' + e1(h) + '" fill="' + fill + '" stroke="' + pal.ink + '" stroke-opacity="' + (d0 ? 0.45 : 0.18) + '"/>');
      const t = labelLines(D.cells.get(i).value).join(' '); if (t) textos.push(t);
      if (horiz) {
        o.push('<rect x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(w) + '" height="' + e1(ss) + '" fill="' + pal.band + '" fill-opacity="' + (d0 ? 1 : 0.6) + '" stroke="' + pal.ink + '" stroke-opacity="0.25"/>');
        const [lines, fs] = fit([t], w - 12, ss - 4, 9, 7, 1.18, MONO); let ty = y + ss / 2 + fs * 0.35 - (lines.length - 1) * fs * 0.6;
        for (const ln of lines) { o.push('<text x="' + e1(x + w / 2) + '" y="' + e1(ty) + '" text-anchor="middle" font-family="' + F_MONO + '" font-size="' + g(fs) + '" font-weight="' + (d0 ? 600 : 500) + '" fill="' + (d0 ? pal.ink : MUTED) + '" letter-spacing="0.04em">' + esc(ln) + '</text>'); ty += fs * 1.2; }
      } else {
        o.push('<rect x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(ss) + '" height="' + e1(h) + '" fill="' + pal.band + '" fill-opacity="' + (d0 ? 1 : 0.6) + '" stroke="' + pal.ink + '" stroke-opacity="0.25"/>');
        const [lines, fs] = fit([t], h - 12, ss - 4, 9, 7, 1.18, MONO); const cx = x + ss / 2, cy = y + h / 2, off = -(lines.length - 1) * fs * 0.6;
        lines.forEach((ln, k) => { const xx = cx + fs * 0.35 + off + k * fs * 1.2;
          o.push('<text x="' + e1(xx) + '" y="' + e1(cy) + '" transform="rotate(-90 ' + e1(xx) + ' ' + e1(cy) + ')" text-anchor="middle" font-family="' + F_MONO + '" font-size="' + g(fs) + '" font-weight="' + (d0 ? 600 : 500) + '" fill="' + (d0 ? pal.ink : MUTED) + '" letter-spacing="0.04em">' + esc(ln) + '</text>'); });
      }
    }
    for (const i of content) {
      if (kinds.get(i) !== 'band') continue; const [x, y, w, h] = B.get(i);
      o.push('<rect x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(w) + '" height="' + e1(h) + '" rx="4" fill="#fdf5dc" stroke="#d6b656"/>');
      const t = labelLines(D.cells.get(i).value); textos.push(...t);
      if (h > w * 1.6) { const [lines, fs] = fit(t, h - 16, w - 8, 10, 7, 1.18, MONO); const cx = x + w / 2, cy = y + h / 2, off = -(lines.length - 1) * fs * 0.6;
        lines.forEach((ln, k) => { const xx = cx + fs * 0.35 + off + k * fs * 1.2;
          o.push('<text x="' + e1(xx) + '" y="' + e1(cy) + '" transform="rotate(-90 ' + e1(xx) + ' ' + e1(cy) + ')" text-anchor="middle" font-family="' + F_MONO + '" font-size="' + g(fs) + '" fill="#7a5c0a" letter-spacing="0.06em">' + esc(ln) + '</text>'); }); }
      else { const [lines, fs] = fit(t, w - 12, h - 6, 10, 7, 1.18, MONO); let ty = y + h / 2 + fs * 0.35 - (lines.length - 1) * fs * 0.6;
        for (const ln of lines) { o.push('<text x="' + e1(x + w / 2) + '" y="' + e1(ty) + '" text-anchor="middle" font-family="' + F_MONO + '" font-size="' + g(fs) + '" fill="#7a5c0a">' + esc(ln) + '</text>'); ty += fs * 1.2; } }
    }
    const item = st => st ? ' data-motion-item data-step="' + st + '"' : '';
    const nm = i => i && D.cells.has(i) ? labelLines(D.cells.get(i).value).join(' ').slice(0, 60) : 'punto';
    for (const e of E) {
      const lab = e.label ? ' (' + e.label + ')' : '';
      o.push('<g' + item(e.step) + ' aria-label="' + esc(e.s ? nm(e.s) : 'inicio') + ' → ' + esc(e.t ? nm(e.t) : 'fin') + esc(lab) + '">');
      const col = e.dash && !e.arrow ? '#7ea6e0' : MUTED;
      const mk = (e.arrow ? ' marker-end="url(#' + slug + '-arrow)"' : '') + (e.startArrow ? ' marker-start="url(#' + slug + '-arrow-start)"' : '');
      o.push('<path d="' + pathD(e.pts, e.hops) + '" fill="none" stroke="' + col + '" stroke-width="1.2"' + (e.dash ? ' stroke-dasharray="5,4"' : '') + mk + '/>');
      if (e.label) {
        textos.push(e.label);
        const pts = e.pts, segl = []; for (let j = 1; j < pts.length; j++) segl.push(Math.abs(pts[j][0] - pts[j - 1][0]) + Math.abs(pts[j][1] - pts[j - 1][1]));
        const tot = segl.reduce((a, b) => a + b, 0) || 1; let t = (Math.min(Math.max(e.lx, -1), 1) + 1) / 2 * tot; let a, b, Lg;
        for (let j = 0; j < segl.length; j++) { a = pts[j]; b = pts[j + 1]; Lg = segl[j]; if (t <= Lg || j === segl.length - 1) break; t -= Lg; }
        const f_ = Lg ? t / Lg : 0; const px = a[0] + (b[0] - a[0]) * f_, py = a[1] + (b[1] - a[1]) * f_;
        const txt = e.label, w = txt.length * 8 * MONO + 10, h = 12;
        let rx, ry; if (a[1] === b[1]) { rx = px - w / 2; ry = py - 8 - h; } else { rx = px + 8; ry = py - h / 2; }
        o.push('<rect x="' + e1(rx) + '" y="' + e1(ry) + '" width="' + e1(w) + '" height="' + h + '" rx="2" fill="' + PAPER + '"/><text x="' + e1(rx + w / 2) + '" y="' + e1(ry + 9) + '" text-anchor="middle" font-family="' + F_MONO + '" font-size="8" fill="' + SOFT + '" letter-spacing="0.04em">' + esc(txt.toUpperCase()) + '</text>');
      }
      o.push('</g>');
    }
    for (const i of [...content].sort(cmpYX(B))) {
      const k = kinds.get(i); if (k === 'lane' || k === 'band') continue;
      const [x, y, w, h] = B.get(i), s = D.st.get(i), cx = x + w / 2, cy = y + h / 2;
      const lines = labelLines(D.cells.get(i).value); textos.push(...lines);
      const pal = group.get(i) ? palette(labelLines(D.cells.get(group.get(i)).value).join(' ')) : null;
      const stp = stepOf.get(i); const gq = [];
      if (k === 'text') {
        const long_ = lines.reduce((a, l) => a + l.length, 0) > 40; const em = long_ ? SANS : MONO;
        const [wl, fs] = fit(lines, Math.max(w - 4, 20), Math.max(h, 12), long_ ? 10 : 8.5, 7, 1.18, em);
        const left = s.align === 'left';
        let ty = (left || (long_ && s.verticalAlign === 'top')) ? y + fs + 2 : cy + fs * 0.35 - (wl.length - 1) * fs * 0.6;
        for (const ln of wl) { const t_ = long_ ? ln : ln.toUpperCase(), fam = long_ ? F_SANS : F_MONO;
          if (left) gq.push('<text x="' + e1(x + 2) + '" y="' + e1(ty) + '" font-family="' + fam + '" font-size="' + g(fs) + '" fill="' + (long_ ? INK : SOFT) + '">' + esc(t_) + '</text>');
          else gq.push('<text x="' + e1(cx) + '" y="' + e1(ty) + '" text-anchor="middle" font-family="' + fam + '" font-size="' + g(fs) + '" fill="' + (long_ ? INK : SOFT) + '">' + esc(t_) + '</text>');
          ty += fs * 1.2; }
        o.push(gq.join('')); continue;
      }
      if (k === 'image') {
        const href = imagenHref(s.image);
        if (href) gq.push('<image x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(w) + '" height="' + e1(h) + '" href="' + esc(href) + '" preserveAspectRatio="xMidYMid meet"/>');
        else { gq.push('<rect x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(w) + '" height="' + e1(h) + '" fill="#eef0f4" stroke="' + MUTED + '" stroke-dasharray="4,3"/>');
          gq.push('<text x="' + e1(cx) + '" y="' + e1(cy + 3) + '" text-anchor="middle" font-family="' + F_MONO + '" font-size="8" fill="' + MUTED + '">IMAGEN NO DISPONIBLE</text>'); }
        let ty = y + h + 12; for (const ln of lines) { gq.push('<text x="' + e1(cx) + '" y="' + e1(ty) + '" text-anchor="middle" font-family="' + F_SANS + '" font-size="10" fill="' + INK + '">' + esc(ln) + '</text>'); ty += 12; }
        o.push('<g' + item(stp) + ' aria-label="' + esc(lines.join(' ') || 'imagen') + '">' + gq.join('') + '</g>'); continue;
      }
      if (k === 'term') {
        const end = norm(lines.join(' ')).startsWith('FIN'), r = Math.min(h / 2, 18);
        gq.push('<rect class="nb" x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(w) + '" height="' + e1(h) + '" rx="' + e1(r) + '" fill="' + (end ? INK : '#e3f1dc') + '" stroke="' + (end ? INK : '#3f7a2c') + '" stroke-width="1.2"/>');
        const [wl, fs] = fit(lines, w - 8, h - 2, 11, 7);
        gq.push('<text x="' + e1(cx) + '" y="' + e1(cy + fs * 0.35) + '" text-anchor="middle" font-family="' + F_SANS + '" font-size="' + g(fs) + '" font-weight="600" fill="' + (end ? PAPER : INK) + '">' + esc(wl.join(' ')) + '</text>');
      } else if (k === 'gw') {
        gq.push('<polygon class="nb" points="' + e1(cx) + ',' + e1(y) + ' ' + e1(x + w) + ',' + e1(cy) + ' ' + e1(cx) + ',' + e1(y + h) + ' ' + e1(x) + ',' + e1(cy) + '" fill="#fcefc7" stroke="' + INK + '" stroke-width="1.2"/>');
        const [wl, fs] = fit(lines, w * 0.62, h * 0.62, 9.5, 7); let ty = cy + fs * 0.35 - (wl.length - 1) * fs * 0.6;
        for (const ln of wl) { gq.push('<text x="' + e1(cx) + '" y="' + e1(ty) + '" text-anchor="middle" font-family="' + F_SANS + '" font-size="' + g(fs) + '" font-weight="500" fill="' + INK + '">' + esc(ln) + '</text>'); ty += fs * 1.2; }
      } else if (k === 'note' || k === 'doc' || k === 'db') {
        const fill0 = (s.fillColor || '#dae8fc').toLowerCase(); const [fill, stroke] = NOTE_FILL[fill0] || ['#e9f0fa', '#6c8ebf'];
        let e_ = 0;
        if (k === 'note') { const f = 10;
          gq.push('<path class="nb" d="M' + e1(x) + ' ' + e1(y) + ' H' + e1(x + w - f) + ' L' + e1(x + w) + ' ' + e1(y + f) + ' V' + e1(y + h) + ' H' + e1(x) + ' Z" fill="' + fill + '" stroke="' + stroke + '"/><path d="M' + e1(x + w - f) + ' ' + e1(y) + ' V' + e1(y + f) + ' H' + e1(x + w) + '" fill="none" stroke="' + stroke + '"/>'); }
        else if (k === 'doc') gq.push('<path class="nb" d="M' + e1(x) + ' ' + e1(y) + ' H' + e1(x + w) + ' V' + e1(y + h - 6) + ' Q' + e1(x + w * 0.75) + ' ' + e1(y + h - 14) + ' ' + e1(cx) + ' ' + e1(y + h - 6) + ' T' + e1(x) + ' ' + e1(y + h - 6) + ' Z" fill="' + fill + '" stroke="' + stroke + '"/>');
        else { e_ = Math.min(10, h / 6);
          gq.push('<path class="nb" d="M' + e1(x) + ' ' + e1(y + e_) + ' A' + e1(w / 2) + ' ' + e1(e_) + ' 0 0 1 ' + e1(x + w) + ' ' + e1(y + e_) + ' V' + e1(y + h - e_) + ' A' + e1(w / 2) + ' ' + e1(e_) + ' 0 0 1 ' + e1(x) + ' ' + e1(y + h - e_) + ' Z" fill="' + fill + '" stroke="' + stroke + '"/><path d="M' + e1(x) + ' ' + e1(y + e_) + ' A' + e1(w / 2) + ' ' + e1(e_) + ' 0 0 0 ' + e1(x + w) + ' ' + e1(y + e_) + '" fill="none" stroke="' + stroke + '"/>'); }
        const topPad = k === 'db' ? 2 * e_ + 4 : 6;
        const [wl, fs] = fit(lines, w - 14, h - topPad - (k === 'doc' ? 12 : 6), 8.5, 6.5, 1.2, MONO);
        const alignLeft = s.align === 'left' || k === 'doc' || wl.length > 2;
        let ty = alignLeft ? y + topPad + fs : cy + fs * 0.35 - (wl.length - 1) * fs * 0.6;
        for (const ln of wl) { const bold = (ln === ln.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(ln) && ln.length > 3 && alignLeft) ? ' font-weight="600"' : '';
          if (alignLeft) gq.push('<text x="' + e1(x + 7) + '" y="' + e1(ty) + '" font-family="' + F_MONO + '" font-size="' + g(fs) + '"' + bold + ' fill="' + INK + '">' + esc(ln) + '</text>');
          else gq.push('<text x="' + e1(cx) + '" y="' + e1(ty) + '" text-anchor="middle" font-family="' + F_MONO + '" font-size="' + g(fs) + '"' + bold + ' fill="' + INK + '">' + esc(ln) + '</text>');
          ty += fs * 1.2; }
      } else {
        const fill0 = (s.fillColor || 'none').toLowerCase(); let ink, fill, sw, tcol, dash;
        if (pal) { ink = pal.ink; fill = '#ffffff'; sw = 1.1; tcol = INK; dash = ''; }
        else { const st0 = (s.strokeColor || 'default').toLowerCase(); ink = ['default', 'none', '#000000'].includes(st0) ? INK : st0;
          fill = ['none', 'default'].includes(fill0) ? '#ffffff' : fill0; sw = Math.min(Math.max(parseFloat(s.strokeWidth || 1) || 1, 1), 3);
          tcol = s.fontColor || INK;
          if (!['none', 'default'].includes(fill0) && /^#[0-9a-f]{6}$/.test(fill0) && parseInt(fill0.slice(1, 3), 16) + parseInt(fill0.slice(3, 5), 16) + parseInt(fill0.slice(5, 7), 16) < 200) tcol = '#ffffff';
          dash = s.dashed === '1' ? ' stroke-dasharray="5,4"' : ''; if (s.strokeColor === 'none') ink = 'none'; }
        if (k === 'ellipse') gq.push('<ellipse class="nb" cx="' + e1(cx) + '" cy="' + e1(cy) + '" rx="' + e1(w / 2) + '" ry="' + e1(h / 2) + '" fill="' + fill + '" stroke="' + ink + '" stroke-width="' + g(sw) + '"' + dash + '/>');
        else gq.push('<rect class="nb" x="' + e1(x) + '" y="' + e1(y) + '" width="' + e1(w) + '" height="' + e1(h) + '" rx="' + (s.rounded === '1' || pal ? 6 : 0) + '" fill="' + fill + '" stroke="' + ink + '" stroke-width="' + g(sw) + '"' + dash + '/>');
        const left = s.align === 'left'; const [wl, fs] = fit(lines, w - 14, h - 6, 11.5, 7);
        let ty = (left && (s.verticalAlign || 'middle') === 'top') ? y + 8 + fs : cy + fs * 0.35 - (wl.length - 1) * fs * 0.6;
        for (const ln of wl) {
          if (left) gq.push('<text x="' + e1(x + 8) + '" y="' + e1(ty) + '" font-family="' + F_SANS + '" font-size="' + g(fs) + '" font-weight="500" fill="' + tcol + '">' + esc(ln) + '</text>');
          else gq.push('<text x="' + e1(cx) + '" y="' + e1(ty) + '" text-anchor="middle" font-family="' + F_SANS + '" font-size="' + g(fs) + '" font-weight="600" fill="' + tcol + '">' + esc(ln) + '</text>');
          ty += fs * 1.2; }
      }
      o.push('<g' + item(stp) + ' aria-label="' + esc(lines.join(' ').slice(0, 80) || k) + '">' + gq.join('') + '</g>');
    }
    // leyenda
    let lx = 40, ly = LEG_Y;
    o.push('<line x1="40" y1="' + e1(ly - 16) + '" x2="' + (VW - 40) + '" y2="' + e1(ly - 16) + '" stroke="' + INK + '" stroke-opacity="0.10"/>');
    o.push('<text x="40" y="' + e1(ly + 3) + '" font-family="' + F_MONO + '" font-size="8" fill="' + MUTED + '" letter-spacing="0.14em">LEYENDA</text>');
    const present = new Set(content.map(i => kinds.get(i)));
    const items = [['task', 'Actividad'], ['term', 'Inicio / fin'], ['gw', 'Decisión'], ['note', 'Nota'], ['doc', 'Documento'], ['db', 'Base de datos'], ['flow', 'Flujo'], ['assoc', 'Asociación'], ['hop', 'Cruce sin conexión']];
    const hasAssoc = E.some(e => !e.arrow), hasHop = E.some(e => Object.keys(e.hops).length);
    lx = 110;
    for (const [k, t] of items) {
      if (['task', 'term', 'gw', 'note', 'doc', 'db'].includes(k) && !present.has(k)) continue;
      if ((k === 'assoc' && !hasAssoc) || (k === 'hop' && !hasHop)) continue;
      if (lx + 40 + t.length * 8 * MONO > VW - 40) { lx = 110; ly += 18; }
      if (k === 'task') o.push('<rect x="' + lx + '" y="' + e1(ly - 6) + '" width="20" height="12" rx="3" fill="#fff" stroke="' + INK + '"/>');
      else if (k === 'term') o.push('<rect x="' + lx + '" y="' + e1(ly - 6) + '" width="20" height="12" rx="6" fill="#e3f1dc" stroke="#3f7a2c"/>');
      else if (k === 'gw') o.push('<polygon points="' + (lx + 10) + ',' + e1(ly - 7) + ' ' + (lx + 18) + ',' + e1(ly) + ' ' + (lx + 10) + ',' + e1(ly + 7) + ' ' + (lx + 2) + ',' + e1(ly) + '" fill="#fcefc7" stroke="' + INK + '"/>');
      else if (['note', 'doc', 'db'].includes(k)) o.push('<rect x="' + lx + '" y="' + e1(ly - 6) + '" width="20" height="12" fill="#e9f0fa" stroke="#6c8ebf"/>');
      else if (k === 'flow') o.push('<path d="M' + lx + ' ' + e1(ly) + ' H' + (lx + 18) + '" stroke="' + MUTED + '" stroke-width="1.2" marker-end="url(#' + slug + '-arrow)"/>');
      else if (k === 'assoc') o.push('<path d="M' + lx + ' ' + e1(ly) + ' H' + (lx + 20) + '" stroke="#7ea6e0" stroke-width="1.2" stroke-dasharray="5,4"/>');
      else if (k === 'hop') o.push('<path d="M' + lx + ' ' + e1(ly + 2) + ' H' + (lx + 6) + ' A4 4 0 0 1 ' + (lx + 14) + ' ' + e1(ly + 2) + ' H' + (lx + 20) + '" fill="none" stroke="' + MUTED + '" stroke-width="1.2"/><path d="M' + (lx + 10) + ' ' + e1(ly - 6) + ' V' + e1(ly + 8) + '" stroke="' + MUTED + '" stroke-width="1.2"/>');
      o.push('<text x="' + (lx + 28) + '" y="' + e1(ly + 3) + '" font-family="' + F_MONO + '" font-size="8" fill="' + MUTED + '">' + esc(t.toUpperCase()) + '</text>');
      lx += 40 + Math.trunc(t.length * 8 * MONO) + 24;
    }
    VH = Math.max(VH, Math.ceil((ly + 30) / 4) * 4);
    o[3] = '<rect width="' + VW + '" height="' + VH + '" fill="' + PAPER + '"/>';
    const svg = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="' + slug + '-title ' + slug + '-desc">\n' + o.join('\n') + '\n</svg>';
    return {svg, w: VW, h: VH, pasos: STEPS, texto: textos.join(' ')};
  }
  return {render};
})();
