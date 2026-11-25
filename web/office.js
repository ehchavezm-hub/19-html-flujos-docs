/* Conversores de Word (.docx) y PowerPoint (.pptx) a HTML, en el navegador y sin internet.
   Interpretan el formato interno de Office (OOXML/DrawingML): tema (colores y fuentes), herencia de estilos,
   numeración, tablas, páginas, cuadros de texto y formas posicionadas, imágenes (incl. SVG), formas predefinidas
   y libres, rellenos (sólido, degradado, imagen), patrón → diseño → diapositiva, SmartArt (dibujo de respaldo). */
'use strict';
const OX = (() => {
  // ------------------------------------------------------------------ utilidades XML
  const kids = (el, n) => el ? [...el.children].filter(c => c.localName === n) : [];
  const kid = (el, n) => { if (!el) return null; for (const c of el.children) if (c.localName === n) return c; return null; };
  const path = (el, ...ns) => { for (const n of ns) { el = kid(el, n); if (!el) return null; } return el; };
  const desc = (el, n) => el ? [...el.getElementsByTagName('*')].filter(c => c.localName === n) : [];
  const desc1 = (el, n) => { if (!el) return null; for (const c of el.getElementsByTagName('*')) if (c.localName === n) return c; return null; };
  const A = (el, n) => el ? el.getAttribute(n) : null;
  const num = (v, d = 0) => { const x = parseFloat(v); return isNaN(x) ? d : x; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const f2 = v => +(+v).toFixed(3);
  const MIME_IMG = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp'};
  const mimeDe = n => MIME_IMG[(n.split('.').pop() || '').toLowerCase()] || null;
  function onOff(el, def = true) { if (!el) return null; const v = A(el, 'w:val') ?? A(el, 'val'); if (v === null) return def; return !['0', 'false', 'off'].includes(v); }

  // ------------------------------------------------------------------ colores (DrawingML)
  const PRST = {black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', navy: '000080', cyan: '00FFFF', magenta: 'FF00FF'};
  const hex2rgb = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  function rgb2hsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
  function hsl2rgb([h, s, l]) { if (!s) return [l * 255, l * 255, l * 255]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; }
  const COLS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'];
  // T = {colores, mapa, mayor, menor}; ph = color de reemplazo (phClr)
  function color(el, T, ph) {
    if (!el) return null;
    const c = COLS.includes(el.localName) ? el : [...el.children].find(x => COLS.includes(x.localName));
    if (!c) return null;
    let hex = null;
    if (c.localName === 'srgbClr') hex = A(c, 'val');
    else if (c.localName === 'sysClr') hex = A(c, 'lastClr') || (A(c, 'val') === 'window' ? 'FFFFFF' : '000000');
    else if (c.localName === 'prstClr') hex = PRST[A(c, 'val')] || '000000';
    else if (c.localName === 'scrgbClr') hex = ['r', 'g', 'b'].map(k => Math.round(num(A(c, k)) / 100000 * 255).toString(16).padStart(2, '0')).join('');
    else if (c.localName === 'schemeClr') { const v = A(c, 'val'); if (v === 'phClr') { if (!ph) return null; hex = ph.hex.slice(1); } else hex = T ? T.color(v) : null; }
    if (!hex || !/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
    let rgb = hex2rgb(hex), a = ph && A(c, 'val') === 'phClr' ? ph.a : 1;
    for (const m of c.children) {
      const v = num(A(m, 'val')) / 100000;
      if (m.localName === 'alpha') a = v;
      else if (m.localName === 'lumMod' || m.localName === 'lumOff') { const hsl = rgb2hsl(rgb); hsl[2] = m.localName === 'lumMod' ? hsl[2] * v : Math.min(1, hsl[2] + v); rgb = hsl2rgb(hsl); }
      else if (m.localName === 'tint') rgb = rgb.map(x => x * v + 255 * (1 - v));
      else if (m.localName === 'shade') rgb = rgb.map(x => x * v);
      else if (m.localName === 'satMod') { const hsl = rgb2hsl(rgb); hsl[1] = Math.min(1, hsl[1] * v); rgb = hsl2rgb(hsl); }
    }
    const h = '#' + rgb.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
    return {hex: h, a, css: a < 0.999 ? 'rgba(' + rgb.map(x => Math.round(x)).join(',') + ',' + f2(a) + ')' : h};
  }
  async function tema(z, ruta, mapa) {
    const x = ruta ? await z.xml(ruta) : null; const cols = {}, fn = {mayor: null, menor: null}; let fills = [], lines = [], bgFills = [];
    if (x) {
      const cs = desc1(x, 'clrScheme');
      if (cs) for (const c of cs.children) { const k = [...c.children][0]; if (!k) continue; cols[c.localName] = k.localName === 'sysClr' ? (A(k, 'lastClr') || (A(k, 'val') === 'window' ? 'FFFFFF' : '000000')) : A(k, 'val'); }
      const mj = desc1(x, 'majorFont'), mn = desc1(x, 'minorFont');
      fn.mayor = A(kid(mj, 'latin'), 'typeface'); fn.menor = A(kid(mn, 'latin'), 'typeface');
      fills = [...(desc1(x, 'fillStyleLst') || {children: []}).children]; lines = kids(desc1(x, 'lnStyleLst'), 'ln'); bgFills = [...(desc1(x, 'bgFillStyleLst') || {children: []}).children];
    }
    const M = Object.assign({bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2'}, mapa || {});
    const alias = {dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2', text1: 'dk1', text2: 'dk2', background1: 'lt1', background2: 'lt2', hyperlink: 'hlink', followedHyperlink: 'folHlink'};
    return {cols, fn, fills, lines, bgFills, M,
      color(v) { v = alias[v] || v; return cols[M[v] || v] || cols[v] || null; },
      fuente(f) { if (!f) return null; if (f.startsWith('+mj') || /^major/i.test(f)) return fn.mayor; if (f.startsWith('+mn') || /^minor/i.test(f)) return fn.menor; return f; }};
  }
  const familia = f => f ? "'" + f.replace(/['"]/g, '') + "', Figtree, 'Segoe UI', system-ui, sans-serif" : null;

  // relleno (spPr) → {css, img, ninguno}
  async function relleno(sp, T, ctx) {
    if (!sp) return null;
    for (const c of sp.children) {
      if (c.localName === 'noFill') return {ninguno: true};
      if (c.localName === 'solidFill') { const k = color(c, T, ctx.ph); return k ? {css: k.css, color: k} : null; }
      if (c.localName === 'gradFill') {
        const gs = desc(c, 'gs').map(g => [num(A(g, 'pos')) / 1000, color(g, T, ctx.ph)]).filter(g => g[1]).sort((a, b) => a[0] - b[0]);
        if (!gs.length) return null; const lin = kid(c, 'lin'); const ang = lin ? num(A(lin, 'ang')) / 60000 : 90;
        return {css: 'linear-gradient(' + f2(ang + 90) + 'deg,' + gs.map(g => g[1].css + ' ' + f2(g[0]) + '%').join(',') + ')', color: gs[0][1]};
      }
      if (c.localName === 'blipFill') { const u = await ctx.imagen(c); return u ? {img: u, stretch: !!kid(c, 'stretch')} : null; }
      if (c.localName === 'pattFill') { const k = color(kid(c, 'fgClr'), T, ctx.ph); return k ? {css: k.css, color: k} : null; }
      if (c.localName === 'grpFill') return ctx.grpFill || null;
    }
    return null;
  }
  function linea(sp, T, ctx) {
    const ln = kid(sp, 'ln'); if (!ln) return null;
    if (kid(ln, 'noFill')) return {ninguno: true};
    const k = color(kid(ln, 'solidFill'), T, ctx.ph) || (kid(ln, 'gradFill') ? color(desc1(ln, 'gs'), T, ctx.ph) : null);
    const pd = A(kid(ln, 'prstDash'), 'val');
    return {color: k, w: A(ln, 'w') ? num(A(ln, 'w')) : null, dash: pd && pd !== 'solid' ? pd : null,
      cola: A(kid(ln, 'tailEnd'), 'type'), cabeza: A(kid(ln, 'headEnd'), 'type')};
  }
  // estilo de la forma (p:style / wps:style): fillRef, lnRef, fontRef
  function estiloRef(stEl, T, ctx) {
    if (!stEl) return {};
    const out = {}; const fr = kid(stEl, 'fillRef'), lr = kid(stEl, 'lnRef'), fo = kid(stEl, 'fontRef');
    if (fr && num(A(fr, 'idx')) > 0) { const ph = color(fr, T, null); const tpl = T.fills[num(A(fr, 'idx')) - 1]; out.ph = ph; out.fill = tpl ? {tpl, ph} : (ph ? {css: ph.css} : null); }
    if (lr && num(A(lr, 'idx')) > 0) { const ph = color(lr, T, null); const tpl = T.lines[num(A(lr, 'idx')) - 1];
      out.line = {color: ph, w: tpl ? num(A(tpl, 'w'), 9525) : 9525}; }
    if (fo) { const k = color(fo, T, null); if (k) out.fontColor = k; }
    return out;
  }
  async function rellenoFinal(sp, stRef, T, ctx) {
    let f = await relleno(sp, T, ctx);
    if (!f && stRef.fill) { if (stRef.fill.css) f = {css: stRef.fill.css}; else { const holder = {children: [stRef.fill.tpl]}; f = await relleno(holder, T, Object.assign({}, ctx, {ph: stRef.fill.ph})); } }
    return f;
  }

  // ------------------------------------------------------------------ geometría (SVG en un sistema w×h)
  function geom(sp, w, h) {
    const pg = kid(sp, 'prstGeom'), cg = kid(sp, 'custGeom');
    if (cg) {
      const ds = [];
      for (const p of desc(cg, 'path')) {
        const pw = num(A(p, 'w')) || w, ph = num(A(p, 'h')) || h, sx = w / pw, sy = h / ph; let d = '', cx = 0, cy = 0;
        const pt = el => [num(A(el, 'x')) * sx, num(A(el, 'y')) * sy];
        for (const c of p.children) {
          const pts = kids(c, 'pt').map(pt);
          if (c.localName === 'moveTo') { [cx, cy] = pts[0]; d += 'M' + f2(cx) + ' ' + f2(cy); }
          else if (c.localName === 'lnTo') { [cx, cy] = pts[0]; d += 'L' + f2(cx) + ' ' + f2(cy); }
          else if (c.localName === 'cubicBezTo') { d += 'C' + pts.map(q => f2(q[0]) + ' ' + f2(q[1])).join(' '); [cx, cy] = pts[2]; }
          else if (c.localName === 'quadBezTo') { d += 'Q' + pts.map(q => f2(q[0]) + ' ' + f2(q[1])).join(' '); [cx, cy] = pts[1]; }
          else if (c.localName === 'arcTo') { const wR = num(A(c, 'wR')) * sx, hR = num(A(c, 'hR')) * sy, st = num(A(c, 'stAng')) / 60000 * Math.PI / 180, sw = num(A(c, 'swAng')) / 60000 * Math.PI / 180;
            const ox = cx - wR * Math.cos(st), oy = cy - hR * Math.sin(st), ex = ox + wR * Math.cos(st + sw), ey = oy + hR * Math.sin(st + sw);
            d += 'A' + f2(wR) + ' ' + f2(hR) + ' 0 ' + (Math.abs(sw) > Math.PI ? 1 : 0) + ' ' + (sw > 0 ? 1 : 0) + ' ' + f2(ex) + ' ' + f2(ey); cx = ex; cy = ey; }
          else if (c.localName === 'close') d += 'Z';
        }
        ds.push({d, fill: A(p, 'fill') !== 'none', stroke: A(p, 'stroke') !== '0'});
      }
      return {paths: ds};
    }
    const prst = pg ? A(pg, 'prst') : 'rect'; const av = {};
    for (const gd of desc(pg, 'gd')) { const m = (A(gd, 'fmla') || '').match(/val\s+(-?\d+)/); if (m) av[A(gd, 'name')] = +m[1]; }
    const ss = Math.min(w, h), adj = (k, d) => (av[k] ?? d) / 100000;
    const P = pts => ({paths: [{d: 'M' + pts.map(p => f2(p[0]) + ' ' + f2(p[1])).join('L') + 'Z', fill: true, stroke: true}]});
    switch (prst) {
      case 'ellipse': case 'flowChartConnector': case 'donut': return {ellipse: true};
      case 'roundRect': case 'flowChartAlternateProcess': case 'round2SameRect': case 'round1Rect': return {rx: adj('adj', 16667) * ss};
      case 'flowChartTerminator': return {rx: h / 2};
      case 'triangle': case 'flowChartExtract': { const a = adj('adj', 50000); return P([[w * a, 0], [w, h], [0, h]]); }
      case 'rtTriangle': return P([[0, 0], [w, h], [0, h]]);
      case 'diamond': case 'flowChartDecision': return P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
      case 'parallelogram': case 'flowChartInputOutput': { const o = adj('adj', 25000) * ss; return P([[o, 0], [w, 0], [w - o, h], [0, h]]); }
      case 'trapezoid': { const o = adj('adj', 25000) * ss; return P([[o, 0], [w - o, 0], [w, h], [0, h]]); }
      case 'hexagon': case 'flowChartPreparation': { const o = adj('adj', 25000) * ss; return P([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]); }
      case 'octagon': { const o = adj('adj', 29289) * ss; return P([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]); }
      case 'pentagon': case 'homePlate': { const o = adj('adj', 50000) * ss; return P([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]); }
      case 'chevron': { const o = adj('adj', 50000) * ss; return P([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]); }
      case 'rightArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000) * ss, y1 = h * (1 - a1) / 2; return P([[0, y1], [w - a2, y1], [w - a2, 0], [w, h / 2], [w - a2, h], [w - a2, h - y1], [0, h - y1]]); }
      case 'leftArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000) * ss, y1 = h * (1 - a1) / 2; return P([[w, y1], [a2, y1], [a2, 0], [0, h / 2], [a2, h], [a2, h - y1], [w, h - y1]]); }
      case 'downArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000) * ss, x1 = w * (1 - a1) / 2; return P([[x1, 0], [w - x1, 0], [w - x1, h - a2], [w, h - a2], [w / 2, h], [0, h - a2], [x1, h - a2]]); }
      case 'upArrow': { const a1 = adj('adj1', 50000), a2 = adj('adj2', 50000) * ss, x1 = w * (1 - a1) / 2; return P([[x1, h], [w - x1, h], [w - x1, a2], [w, a2], [w / 2, 0], [0, a2], [x1, a2]]); }
      case 'plus': case 'flowChartSummingJunction': { const o = adj('adj', 25000) * ss; return P([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]); }
      case 'flowChartDocument': return {paths: [{d: 'M0 0H' + f2(w) + 'V' + f2(h * 0.83) + 'C' + f2(w * 0.7) + ' ' + f2(h * 0.6) + ' ' + f2(w * 0.3) + ' ' + f2(h * 1.1) + ' 0 ' + f2(h * 0.9) + 'Z', fill: true, stroke: true}]};
      case 'flowChartMagneticDisk': case 'can': { const e = Math.min(h * 0.12, w * 0.3); return {paths: [{d: 'M0 ' + f2(e) + 'A' + f2(w / 2) + ' ' + f2(e) + ' 0 0 1 ' + f2(w) + ' ' + f2(e) + 'V' + f2(h - e) + 'A' + f2(w / 2) + ' ' + f2(e) + ' 0 0 1 0 ' + f2(h - e) + 'Z', fill: true, stroke: true}, {d: 'M0 ' + f2(e) + 'A' + f2(w / 2) + ' ' + f2(e) + ' 0 0 0 ' + f2(w) + ' ' + f2(e), fill: false, stroke: true}]}; }
      case 'star5': { const pts = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.38 : 0.5, an = -Math.PI / 2 + k * Math.PI / 5; pts.push([w / 2 + Math.cos(an) * w * r, h / 2 + Math.sin(an) * h * r]); } return P(pts); }
      case 'line': case 'straightConnector1': case 'bentConnector2': case 'bentConnector3': case 'curvedConnector3':
        return {linea: prst === 'bentConnector3' ? 'M0 0H' + f2(w / 2) + 'V' + f2(h) + 'H' + f2(w) : prst === 'bentConnector2' ? 'M0 0H' + f2(w) + 'V' + f2(h) : 'M0 0L' + f2(w) + ' ' + f2(h)};
      default: return {rx: 0};
    }
  }
  // SVG de la forma: ocupa el 100% de su caja (viewBox en las unidades de la caja)
  function svgForma(gm, w, h, fill, ln, strokePx, flips, uid) {
    if (!w && !h) return '';
    const fc = fill && !fill.ninguno ? (fill.img ? 'url(#' + uid + ')' : (fill.css && fill.css.startsWith('linear') ? 'url(#' + uid + ')' : fill.css)) : 'none';
    const sc = ln && !ln.ninguno && ln.color ? ln.color.css : 'none';
    let defs = '';
    if (fill && fill.img) defs = '<defs><pattern id="' + uid + '" patternUnits="objectBoundingBox" width="1" height="1"><image href="' + fill.img + '" width="' + f2(w) + '" height="' + f2(h) + '" preserveAspectRatio="' + (fill.stretch ? 'none' : 'xMidYMid slice') + '"/></pattern></defs>';
    else if (fill && fill.css && fill.css.startsWith('linear')) {
      const m = fill.css.match(/^linear-gradient\(([-\d.]+)deg,(.*)\)$/); const ang = (+m[1] - 90) * Math.PI / 180;
      const stops = m[2].split(/,(?![^(]*\))/).map(s => { const i = s.lastIndexOf(' '); return '<stop offset="' + s.slice(i + 1) + '" stop-color="' + s.slice(0, i) + '"/>'; }).join('');
      defs = '<defs><linearGradient id="' + uid + '" x1="' + f2(0.5 - Math.cos(ang) / 2) + '" y1="' + f2(0.5 - Math.sin(ang) / 2) + '" x2="' + f2(0.5 + Math.cos(ang) / 2) + '" y2="' + f2(0.5 + Math.sin(ang) / 2) + '">' + stops + '</linearGradient></defs>';
    }
    const dash = ln && ln.dash ? ' stroke-dasharray="' + ({dash: '4 3', sysDash: '3 1', dot: '1 2', sysDot: '1 1', dashDot: '4 2 1 2', lgDash: '8 3'}[ln.dash] || '4 3') + '"' : '';
    const stroke = ' stroke="' + sc + '" stroke-width="' + f2(strokePx) + '" vector-effect="non-scaling-stroke"' + dash;
    let body = '';
    const mk = (ln && (ln.cola && ln.cola !== 'none' || ln.cabeza && ln.cabeza !== 'none')) ? '<defs><marker id="' + uid + 'm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0L10 5L0 10Z" fill="' + sc + '"/></marker></defs>' : '';
    const ends = mk ? (ln.cola && ln.cola !== 'none' ? ' marker-end="url(#' + uid + 'm)"' : '') + (ln.cabeza && ln.cabeza !== 'none' ? ' marker-start="url(#' + uid + 'm)"' : '') : '';
    if (gm.ellipse) body = '<ellipse cx="' + f2(w / 2) + '" cy="' + f2(h / 2) + '" rx="' + f2(w / 2) + '" ry="' + f2(h / 2) + '" fill="' + fc + '"' + stroke + '/>';
    else if (gm.linea) body = '<path d="' + gm.linea + '" fill="none"' + stroke + ends + '/>';
    else if (gm.paths) body = gm.paths.map(p => '<path d="' + p.d + '" fill="' + (p.fill ? fc : 'none') + '"' + (p.stroke ? stroke : ' stroke="none"') + '/>').join('');
    else body = '<rect width="' + f2(w) + '" height="' + f2(h) + '" rx="' + f2(Math.min(gm.rx || 0, w / 2, h / 2)) + '" fill="' + fc + '"' + stroke + '/>';
    return '<svg class="geo" viewBox="0 0 ' + f2(Math.max(w, 1)) + ' ' + f2(Math.max(h, 1)) + '" preserveAspectRatio="none" style="overflow:visible' + (flips || '') + '">' + defs + mk + body + '</svg>';
  }

  // ------------------------------------------------------------------ imágenes de un paquete
  function lectorImagenes(z, avisos) {
    const cache = new Map();
    return async (rels, blipFill, dims) => {
      if (!blipFill) return null;
      const blip = blipFill.localName === 'blip' ? blipFill : desc1(blipFill, 'blip'); if (!blip) return null;
      const svg = desc1(blip, 'svgBlip'); const rid = (svg && (A(svg, 'r:embed'))) || A(blip, 'r:embed') || A(blip, 'r:link');
      const t = rels[rid]; if (!t) return null;
      if (cache.has(t)) return cache.get(t);
      let u = null; const m = mimeDe(t);
      if (m && z.tiene(t)) { const b = await z.bytes(t); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); u = 'data:' + m + ';base64,' + btoa(s); }
      else if (/\.(emf|wmf|tif|tiff)$/i.test(t)) avisos.emf = (avisos.emf || 0) + 1;
      cache.set(t, u); return u;
    };
  }

  // =================================================================== POWERPOINT
  async function pptx(z, titulo) {
    const avisos = {}; const textos = []; const img = lectorImagenes(z, avisos);
    const pres = await z.xml('ppt/presentation.xml'), prels = await relaciones(z, 'ppt/presentation.xml');
    const sz = desc1(pres, 'sldSz'); const W = sz ? num(A(sz, 'cx')) : 12192000, H = sz ? num(A(sz, 'cy')) : 6858000;
    const defTxt = desc1(pres, 'defaultTextStyle');
    const CQ = v => f2(v / W * 100);                       // EMU → cqw (1 cqw = 1% del ancho de la diapositiva)
    const PT = pt => f2(pt * 12700 / W * 100);              // puntos → cqw
    const partes = new Map();
    async function parte(ruta) { if (!partes.has(ruta)) partes.set(ruta, {doc: await z.xml(ruta), rels: await relaciones(z, ruta)}); return partes.get(ruta); }
    const relTipo = (rels, tipo) => Object.values(rels).find(t => t && t.includes(tipo)) || null;
    async function relDeTipo(ruta, tipo) {   // busca la relación por tipo leyendo el .rels crudo
      const d = ruta.slice(0, ruta.lastIndexOf('/')); const rp = d + '/_rels/' + ruta.slice(ruta.lastIndexOf('/') + 1) + '.rels';
      const x = await z.xml(rp); if (!x) return null;
      for (const r of desc(x, 'Relationship')) if ((A(r, 'Type') || '').endsWith('/' + tipo)) return unir(d, A(r, 'Target'));
      return null;
    }
    const temas = new Map();
    async function temaDe(maestro) { if (!temas.has(maestro)) { const t = await relDeTipo(maestro, 'theme'); const md = (await parte(maestro)).doc;
      const cm = desc1(md, 'clrMap'); const mapa = {}; if (cm) for (const a of cm.attributes) mapa[a.name] = a.value; temas.set(maestro, await tema(z, t, mapa)); } return temas.get(maestro); }
    const ph = sp => { const p = desc1(kid(sp, 'nvSpPr') || kid(sp, 'nvPicPr') || kid(sp, 'nvGraphicFramePr') || sp, 'ph'); return p ? {type: A(p, 'type') || 'body', idx: A(p, 'idx')} : null; };
    function buscarPh(doc, p) {
      if (!doc || !p) return null; const tree = desc1(doc, 'spTree'); const sps = tree ? desc(tree, 'sp') : [];
      const norm = t => ['ctrTitle', 'title'].includes(t) ? 'title' : t;
      return (p.idx !== null && sps.find(s => { const q = ph(s); return q && q.idx === p.idx; })) || sps.find(s => { const q = ph(s); return q && norm(q.type) === norm(p.type); }) ||
        (p.type === 'body' || p.type === 'obj' ? sps.find(s => { const q = ph(s); return q && (q.type === 'body' || q.type === 'obj'); }) : null) || null;
    }
    function xfrmDe(el) {
      let x = null; for (const c of el.children) { if (['spPr', 'grpSpPr'].includes(c.localName)) { x = kid(c, 'xfrm'); break; } if (c.localName === 'xfrm') { x = c; break; } }
      if (!x) return null; const off = kid(x, 'off'), ex = kid(x, 'ext'); if (!off || !ex) return null;
      const r = {x: num(A(off, 'x')), y: num(A(off, 'y')), w: num(A(ex, 'cx')), h: num(A(ex, 'cy')), rot: num(A(x, 'rot')) / 60000, fh: A(x, 'flipH') === '1', fv: A(x, 'flipV') === '1'};
      const co = kid(x, 'chOff'), ce = kid(x, 'chExt'); if (co && ce) Object.assign(r, {cx: num(A(co, 'x')), cy: num(A(co, 'y')), cw: num(A(ce, 'cx')) || 1, ch: num(A(ce, 'cy')) || 1});
      return r;
    }
    // ---------- texto con herencia
    const LV = l => 'lvl' + (l + 1) + 'pPr';
    function capasNivel(capas, lvl) { return capas.map(c => c ? (kid(c, LV(lvl)) || (c.localName === LV(lvl) ? c : null)) : null).filter(Boolean); }
    function propsTexto(capas, pPr, rPr, ctx) {
      const pr = {sz: 18, b: false, i: false, u: false, color: null, font: null, algn: 'l', marL: 0, indent: 0, bu: null, buClr: null, spcBef: 0, spcAft: 0, lnSpc: null, caps: false};
      const aplicarR = r => { if (!r) return; if (A(r, 'sz')) pr.sz = num(A(r, 'sz')) / 100; if (A(r, 'b')) pr.b = A(r, 'b') === '1'; if (A(r, 'i')) pr.i = A(r, 'i') === '1';
        if (A(r, 'u')) pr.u = A(r, 'u') !== 'none'; if (A(r, 'cap')) pr.caps = A(r, 'cap') === 'all';
        const c = color(kid(r, 'solidFill'), ctx.T, null); if (c) pr.color = c; const l = A(kid(r, 'latin'), 'typeface'); if (l) pr.font = ctx.T.fuente(l); };
      const aplicarP = p => { if (!p) return; if (A(p, 'algn')) pr.algn = A(p, 'algn'); if (A(p, 'marL')) pr.marL = num(A(p, 'marL')); if (A(p, 'indent')) pr.indent = num(A(p, 'indent'));
        if (kid(p, 'buNone')) pr.bu = null; const bc = kid(p, 'buChar'); if (bc) pr.bu = A(bc, 'char'); if (kid(p, 'buAutoNum')) pr.bu = '#' + (A(kid(p, 'buAutoNum'), 'type') || 'arabicPeriod');
        const bcl = color(kid(p, 'buClr'), ctx.T, null); if (bcl) pr.buClr = bcl;
        const sb = desc1(kid(p, 'spcBef'), 'spcPts'), sa = desc1(kid(p, 'spcAft'), 'spcPts'); if (sb) pr.spcBef = num(A(sb, 'val')) / 100; if (sa) pr.spcAft = num(A(sa, 'val')) / 100;
        const ls = desc1(kid(p, 'lnSpc'), 'spcPct'); if (ls) pr.lnSpc = num(A(ls, 'val')) / 100000;
        aplicarR(kid(p, 'defRPr')); };
      for (const c of capas) aplicarP(c);
      aplicarP(pPr); aplicarR(rPr);
      return pr;
    }
    function autoNum(tipo, n) {
      const roman = k => { const v = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [a, b] of v) while (k >= a) { s += b; k -= a; } return s; };
      const base = /alphaLc/.test(tipo) ? String.fromCharCode(96 + n) : /alphaUc/.test(tipo) ? String.fromCharCode(64 + n) : /romanLc/.test(tipo) ? roman(n) : /romanUc/.test(tipo) ? roman(n).toUpperCase() : String(n);
      return /ParenBoth/.test(tipo) ? '(' + base + ')' : /ParenR/.test(tipo) ? base + ')' : /Period/.test(tipo) ? base + '.' : base;
    }
    function htmlTexto(txBody, capasBase, ctx, escalaF, numDiap) {
      if (!txBody) return '';
      const lst = kid(txBody, 'lstStyle'); let o = ''; const cont = {};
      for (const p of kids(txBody, 'p')) {
        const pPr = kid(p, 'pPr'); const lvl = num(A(pPr, 'lvl'));
        const capas = capasNivel([...capasBase, lst], lvl);
        const pp = propsTexto(capas, pPr, null, ctx);
        let runs = ''; let hay = false;
        for (const r of p.children) {
          if (r.localName === 'br') { runs += '<br>'; continue; }
          if (r.localName !== 'r' && r.localName !== 'fld') continue;
          let t = desc(r, 't').map(x => x.textContent).join(''); if (r.localName === 'fld' && /slidenum/i.test(A(r, 'type') || '')) t = String(numDiap);
          if (!t) continue; hay = true; textos.push(t);
          const rp = propsTexto(capas, pPr, kid(r, 'rPr'), ctx);
          const col = rp.color || ctx.colorTexto;
          const st = ['font-size:' + PT(rp.sz * escalaF) + 'cqw'];
          if (rp.b) st.push('font-weight:700'); if (rp.i) st.push('font-style:italic'); if (rp.u) st.push('text-decoration:underline'); if (rp.caps) st.push('text-transform:uppercase');
          if (col) st.push('color:' + col.css); if (rp.font) st.push('font-family:' + familia(rp.font));
          runs += '<span style="' + st.join(';') + '">' + esc(t).replace(/\t/g, '&emsp;') + '</span>';
        }
        const end = kid(p, 'endParaRPr'); const pe = propsTexto(capas, pPr, end, ctx);
        let bu = '';
        if (hay && pp.bu) { let ch = pp.bu; if (ch.startsWith('#')) { cont[lvl] = (cont[lvl] || 0) + 1; ch = autoNum(ch.slice(1), cont[lvl]); } else if (/^[-]$/.test(ch) || ch === '§' || ch === 'Ø') ch = '•';
          bu = '<span class="bu" style="' + (pp.buClr ? 'color:' + pp.buClr.css + ';' : '') + 'width:' + CQ(Math.max(-pp.indent, 0)) + 'cqw">' + esc(ch) + '</span>'; }
        const al = {ctr: 'center', r: 'right', just: 'justify', dist: 'justify'}[pp.algn] || 'left';
        const lh = pp.lnSpc ? pp.lnSpc * 1.2 * (ctx.lnRed || 1) : 1.2 * (ctx.lnRed || 1);
        const ps = ['text-align:' + al, 'line-height:' + f2(lh), 'font-size:' + PT(pe.sz * escalaF) + 'cqw', 'padding-left:' + CQ(pp.marL) + 'cqw', 'text-indent:' + CQ(bu ? 0 : pp.indent) + 'cqw'];
        if (pp.spcBef) ps.push('margin-top:' + PT(pp.spcBef * escalaF) + 'cqw'); if (pp.spcAft) ps.push('margin-bottom:' + PT(pp.spcAft * escalaF) + 'cqw');
        if (bu) ps.push('margin-left:' + CQ(pp.indent) + 'cqw');
        o += '<p style="' + ps.join(';') + '">' + bu + (runs || '&nbsp;') + '</p>';
      }
      return o;
    }
    // ---------- formas
    let uid = 0;
    async function formas(arbol, ctx, tr) {
      let o = '';
      for (const el of arbol.children) {
        const tag = el.localName;
        if (!['sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp', 'AlternateContent'].includes(tag)) continue;
        if (tag === 'AlternateContent') { const ch = kid(el, 'Choice') || kid(el, 'Fallback'); if (ch) o += await formas(ch, ctx, tr); continue; }
        const p = ph(el);
        if (ctx.soloDecoracion && p) continue;               // en patrón y diseño solo se dibujan las formas que no son marcadores
        let xf = xfrmDe(el);
        let base = null;
        if (p && ctx.layout) base = buscarPh(ctx.layout, p); const baseM = p && ctx.maestro ? buscarPh(ctx.maestro, p) : null;
        if (!xf && base) xf = xfrmDe(base); if (!xf && baseM) xf = xfrmDe(baseM);
        if (!xf) continue;
        const [x, y, w, h] = tr(xf.x, xf.y, xf.w, xf.h);
        const trans = []; if (xf.rot) trans.push('rotate(' + f2(xf.rot) + 'deg)'); if (xf.fh || xf.fv) trans.push('scale(' + (xf.fh ? -1 : 1) + ',' + (xf.fv ? -1 : 1) + ')');
        const box = 'left:' + f2(x / W * 100) + '%;top:' + f2(y / H * 100) + '%;width:' + f2(w / W * 100) + '%;height:' + f2(h / H * 100) + '%' + (trans.length ? ';transform:' + trans.join(' ') : '');
        if (tag === 'grpSp') {
          const sx = xf.cw ? w / xf.cw : 1, sy = xf.ch ? h / xf.ch : 1; const cx0 = xf.cx || 0, cy0 = xf.cy || 0;
          const gsp = kid(el, 'grpSpPr'); const gf = await relleno(gsp, ctx.T, ctx);
          o += await formas(el, Object.assign({}, ctx, {grpFill: gf}), (a, b, c, d) => [x + (a - cx0) * sx, y + (b - cy0) * sy, c * sx, d * sy]);
          continue;
        }
        if (tag === 'pic') {
          const bf = kid(el, 'blipFill'); const u = await ctx.imagen(bf);
          const sr = desc1(bf, 'srcRect'); let ist = 'width:100%;height:100%;object-fit:fill';
          if (sr) { const l = num(A(sr, 'l')) / 1e5, t = num(A(sr, 't')) / 1e5, r = num(A(sr, 'r')) / 1e5, b = num(A(sr, 'b')) / 1e5; const wv = 1 - l - r || 1, hv = 1 - t - b || 1;
            ist = 'position:absolute;width:' + f2(100 / wv) + '%;height:' + f2(100 / hv) + '%;left:' + f2(-l / wv * 100) + '%;top:' + f2(-t / hv * 100) + '%;max-width:none'; }
          const gm = geom(kid(el, 'spPr'), w, h); const rad = gm.ellipse ? 'border-radius:50%;' : gm.rx ? 'border-radius:' + CQ(gm.rx) + 'cqw;' : '';
          o += '<div class="f" style="' + box + ';overflow:hidden;' + rad + '">' + (u ? '<img src="' + u + '" alt="" style="' + ist + '">' : '<div class="nd"></div>') + '</div>';
          continue;
        }
        if (tag === 'graphicFrame') {
          const tbl = desc1(el, 'tbl');
          if (tbl) { o += '<div class="f" style="' + box + ';overflow:visible">' + tabla(tbl, ctx, w) + '</div>'; continue; }
          const gd = desc1(el, 'graphicData'); const uri = A(gd, 'uri') || '';
          if (uri.includes('diagram')) {   // SmartArt: dibujo de respaldo guardado por PowerPoint
            const ids = desc1(gd, 'relIds'); const dm = ids && ctx.rels[A(ids, 'r:dm')];
            const dib = dm ? dm.replace(/\/data(\d*)\.xml$/, '/drawing$1.xml') : null;
            if (dib && z.tiene(dib)) { const dp = await parte(dib); const st = desc1(dp.doc, 'spTree');
              if (st) { o += await formas(st, Object.assign({}, ctx, {rels: dp.rels, imagen: bf => img(dp.rels, bf)}), (a, b, c, d) => [x + a, y + b, c, d]); continue; } }
          }
          o += '<div class="f nd" style="' + box + '">' + (uri.includes('chart') ? 'Gráfico (ver original)' : 'Objeto (ver original)') + '</div>';
          continue;
        }
        // sp / cxnSp
        const sp = kid(el, 'spPr'); const stR = estiloRef(kid(el, 'style'), ctx.T, ctx);
        const spBase = base ? kid(base, 'spPr') : null, spM = baseM ? kid(baseM, 'spPr') : null;
        let fill = await rellenoFinal(sp, stR, ctx.T, ctx); if (!fill && spBase) fill = await relleno(spBase, ctx.T, ctx); if (!fill && spM) fill = await relleno(spM, ctx.T, ctx);
        let ln = linea(sp, ctx.T, ctx); if (!ln && spBase) ln = linea(spBase, ctx.T, ctx);
        if (!ln && stR.line) ln = {color: stR.line.color, w: stR.line.w};
        if (ln && !ln.ninguno && !ln.color && stR.line) ln.color = stR.line.color;
        const gm = geom(sp && (kid(sp, 'prstGeom') || kid(sp, 'custGeom')) ? sp : (spBase || sp), w, h);
        const strokePx = ln && ln.w !== null && ln.w !== undefined ? Math.max(ln.w / W * 1100, 0.6) : 1;
        const forma = (fill && !fill.ninguno) || (ln && !ln.ninguno && ln.color) ? svgForma(gm, w, h, fill, ln, strokePx, '', 's' + (++uid)) : '';
        // texto
        const tx = kid(el, 'txBody'); let txt = '';
        if (tx) {
          const bp = kid(tx, 'bodyPr'), bpB = base ? desc1(kid(base, 'txBody'), 'bodyPr') : null, bpM = baseM ? desc1(kid(baseM, 'txBody'), 'bodyPr') : null;
          const g = k => A(bp, k) ?? A(bpB, k) ?? A(bpM, k);
          const ins = [g('tIns') ?? 45720, g('rIns') ?? 91440, g('bIns') ?? 45720, g('lIns') ?? 91440].map(v => CQ(num(v)) + 'cqw').join(' ');
          const anc = g('anchor') || 't'; const wrapN = g('wrap') === 'none'; const vert = g('vert');
          const na = desc1(bp, 'normAutofit'); const escalaF = na && A(na, 'fontScale') ? num(A(na, 'fontScale')) / 100000 : 1; const lnRed = na && A(na, 'lnSpcReduction') ? 1 - num(A(na, 'lnSpcReduction')) / 100000 : 1;
          const tipo = p ? p.type : null;
          const estiloM = tipo ? (['title', 'ctrTitle'].includes(tipo) ? ctx.txTitle : ['body', 'subTitle', 'obj'].includes(tipo) || !tipo ? ctx.txBody : ctx.txOther) : ctx.txOther;
          const capas = [defTxt, estiloM, baseM ? desc1(kid(baseM, 'txBody'), 'lstStyle') : null, base ? desc1(kid(base, 'txBody'), 'lstStyle') : null];
          const colorTexto = stR.fontColor || null;
          const cuerpo = htmlTexto(tx, capas, Object.assign({}, ctx, {colorTexto, lnRed}), escalaF, ctx.numDiap);
          if (cuerpo.replace(/<[^>]+>|&nbsp;/g, '').trim()) {
            const st = ['padding:' + ins, 'justify-content:' + ({ctr: 'center', b: 'flex-end'}[anc] || 'flex-start')];
            if (wrapN) st.push('white-space:nowrap'); if (vert === 'vert270') st.push('writing-mode:vertical-rl;transform:rotate(180deg)'); else if (vert && vert !== 'horz') st.push('writing-mode:vertical-rl');
            txt = '<div class="tx" style="' + st.join(';') + '">' + cuerpo + '</div>';
          }
        }
        if (forma || txt) o += '<div class="f" style="' + box + '">' + forma + txt + '</div>';
      }
      return o;
    }
    function tabla(tbl, ctx, wFrame) {
      const cols = desc(kid(tbl, 'tblGrid'), 'gridCol').map(c => num(A(c, 'w'))); const tot = cols.reduce((a, b) => a + b, 0) || wFrame;
      const tp = kid(tbl, 'tblPr'); const firstRow = A(tp, 'firstRow') === '1', band = A(tp, 'bandRow') === '1', estilo = !!desc1(tp, 'tableStyleId');
      const acc = ctx.T.color('accent1') ? '#' + ctx.T.color('accent1') : '#4472c4';
      let o = '<table style="width:100%;table-layout:fixed"><colgroup>' + cols.map(c => '<col style="width:' + f2(c / tot * 100) + '%">').join('') + '</colgroup>';
      kids(tbl, 'tr').forEach((tr, ri) => {
        o += '<tr style="height:' + CQ(num(A(tr, 'h'))) + 'cqw">';
        for (const tc of kids(tr, 'tc')) {
          if (A(tc, 'hMerge') === '1' || A(tc, 'vMerge') === '1') continue;
          const pr = kid(tc, 'tcPr'); const st = [];
          const f = color(kid(pr, 'solidFill'), ctx.T, null);
          let cab = false;
          if (f) st.push('background:' + f.css); else if (estilo && firstRow && ri === 0) { st.push('background:' + acc); cab = true; }
          else if (estilo && band) st.push('background:' + (ri % 2 ? acc + '33' : acc + '1a'));
          for (const [k, css] of [['lnL', 'left'], ['lnR', 'right'], ['lnT', 'top'], ['lnB', 'bottom']]) { const l = kid(pr, k); if (!l) continue;
            if (kid(l, 'noFill')) st.push('border-' + css + ':none'); else { const c = color(kid(l, 'solidFill'), ctx.T, null); if (c) st.push('border-' + css + ':' + f2(Math.max(num(A(l, 'w'), 12700) / W * 1100, 0.5)) + 'px solid ' + c.css); } }
          const anc = A(pr, 'anchor'); if (anc) st.push('vertical-align:' + ({ctr: 'middle', b: 'bottom'}[anc] || 'top'));
          const ins = ['marT', 'marR', 'marB', 'marL'].map((k, i) => CQ(num(A(pr, k), i % 2 ? 91440 : 45720)) + 'cqw').join(' '); st.push('padding:' + ins);
          const tx = kid(tc, 'txBody');
          const body = tx ? htmlTexto(tx, [defTxt, ctx.txOther], Object.assign({}, ctx, {colorTexto: cab ? {css: '#ffffff'} : null}), 1, ctx.numDiap) : '';
          o += '<td' + (A(tc, 'gridSpan') ? ' colspan="' + A(tc, 'gridSpan') + '"' : '') + (A(tc, 'rowSpan') ? ' rowspan="' + A(tc, 'rowSpan') + '"' : '') + ' style="' + st.join(';') + (cab ? ';font-weight:700' : '') + '">' + body + '</td>';
        }
        o += '</tr>';
      });
      return o + '</table>';
    }
    async function fondo(doc, ctx) {
      const bg = desc1(doc, 'bg'); if (!bg) return null;
      const pr = kid(bg, 'bgPr'); if (pr) return await relleno(pr, ctx.T, ctx);
      const ref = kid(bg, 'bgRef'); if (ref) { const c = color(ref, ctx.T, null); const idx = num(A(ref, 'idx'));
        if (idx >= 1001 && ctx.T.bgFills[idx - 1001]) return await relleno({children: [ctx.T.bgFills[idx - 1001]]}, ctx.T, Object.assign({}, ctx, {ph: c}));
        return c ? {css: c.css} : null; }
      return null;
    }
    // ---------- diapositivas
    const slides = [];
    const orden = desc(pres, 'sldId').map(s => prels[A(s, 'r:id')]).filter(Boolean);
    for (let k = 0; k < orden.length; k++) {
      const ruta = orden[k]; const sl = await parte(ruta); if (!sl.doc) continue;
      const layR = await relDeTipo(ruta, 'slideLayout'); const lay = layR ? await parte(layR) : {doc: null, rels: {}};
      const masR = layR ? await relDeTipo(layR, 'slideMaster') : null; const mas = masR ? await parte(masR) : {doc: null, rels: {}};
      const T = masR ? await temaDe(masR) : await tema(z, null, null);
      const txS = desc1(mas.doc, 'txStyles');
      const base = {T, layout: lay.doc, maestro: mas.doc, txTitle: kid(txS, 'titleStyle'), txBody: kid(txS, 'bodyStyle'), txOther: kid(txS, 'otherStyle'), numDiap: k + 1};
      const ctxDe = p => Object.assign({}, base, {rels: p.rels, imagen: bf => img(p.rels, bf)});
      let bg = await fondo(sl.doc, ctxDe(sl)) || await fondo(lay.doc, ctxDe(lay)) || await fondo(mas.doc, ctxDe(mas));
      let cont = '';
      const showMas = A(sl.doc.documentElement, 'showMasterSp') !== '0', showLayMas = !lay.doc || A(lay.doc.documentElement, 'showMasterSp') !== '0';
      const id = (a, b, c, d) => [a, b, c, d];
      if (showMas && showLayMas && mas.doc) cont += await formas(desc1(mas.doc, 'spTree'), Object.assign(ctxDe(mas), {soloDecoracion: true}), id);
      if (showMas && lay.doc) cont += await formas(desc1(lay.doc, 'spTree'), Object.assign(ctxDe(lay), {soloDecoracion: true}), id);
      cont += await formas(desc1(sl.doc, 'spTree'), ctxDe(sl), id);
      const bgCss = bg ? (bg.img ? 'background:url(' + bg.img + ') center/cover' : 'background:' + bg.css) : 'background:#fff';
      const oculta = A(sl.doc.documentElement, 'show') === '0';
      slides.push('<section class="s" style="aspect-ratio:' + W + '/' + H + ';' + bgCss + '"><span class="n">' + (k + 1) + (oculta ? ' · oculta' : '') + '</span>' + cont + '</section>');
    }
    const page = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(titulo) + '</title><style>' +
      "body{margin:0;background:#3a3f4b;font-family:Figtree,'Segoe UI',system-ui,sans-serif;color:#000;padding:20px}" +
      '.s{position:relative;max-width:1100px;margin:0 auto 22px;box-shadow:0 2px 10px #0006;overflow:hidden;container-type:inline-size}' +
      '.n{position:absolute;right:8px;bottom:5px;font-size:11px;color:#8a90a0;z-index:50;background:#fffc;padding:0 4px;border-radius:3px}' +
      '.f{position:absolute;box-sizing:border-box}.geo{position:absolute;inset:0;width:100%;height:100%}' +
      '.tx{position:absolute;inset:0;display:flex;flex-direction:column;box-sizing:border-box;overflow:visible;font-size:' + PT(18) + 'cqw}' +
      '.tx p{margin:0}.bu{display:inline-block}' +
      '.nd{position:absolute;inset:0;background:#eef0f4;border:1px dashed #b8bfcc;color:#7a8396;display:flex;align-items:center;justify-content:center;font-size:1.1cqw}' +
      'table{border-collapse:collapse}td{border:1px solid #fff;vertical-align:top;overflow:hidden}td p{margin:0}' +
      '</style></head><body>' + slides.join('') + '</body></html>';
    return {page, texto: textos.join(' '), avisos};
  }

  // =================================================================== WORD
  async function docx(z, titulo) {
    const avisos = {}; const textos = []; const img = lectorImagenes(z, avisos);
    const doc = await z.xml('word/document.xml'), rels = await relaciones(z, 'word/document.xml');
    const T = await tema(z, z.tiene('word/theme/theme1.xml') ? 'word/theme/theme1.xml' : null, null);
    const PX = tw => tw / 15;                     // twips → px (96 ppp)
    const EPX = e => e / 9525;                    // EMU → px
    // ---------- estilos
    const sx = await z.xml('word/styles.xml'); const estilos = {}; let defR = null, defP = null, defParr = null, defTab = null;
    if (sx) {
      defR = path(sx.documentElement, 'docDefaults', 'rPrDefault', 'rPr'); defP = path(sx.documentElement, 'docDefaults', 'pPrDefault', 'pPr');
      for (const s of kids(sx.documentElement, 'style')) {
        const id = A(s, 'w:styleId'); estilos[id] = {tipo: A(s, 'w:type'), base: A(kid(s, 'basedOn'), 'w:val'), pPr: kid(s, 'pPr'), rPr: kid(s, 'rPr'), tblPr: kid(s, 'tblPr'), tcPr: kid(s, 'tcPr'), nombre: A(kid(s, 'name'), 'w:val') || ''};
        if (A(s, 'w:default') === '1' && A(s, 'w:type') === 'paragraph') defParr = id; if (A(s, 'w:default') === '1' && A(s, 'w:type') === 'table') defTab = id;
      }
    }
    const cadena = id => { const out = []; const vistos = new Set(); while (id && estilos[id] && !vistos.has(id)) { vistos.add(id); out.unshift(estilos[id]); id = estilos[id].base; } return out; };
    // ---------- numeración
    const nx = await z.xml('word/numbering.xml'); const abs = {}, nums = {};
    if (nx) {
      for (const a of kids(nx.documentElement, 'abstractNum')) { const lv = {}; for (const l of kids(a, 'lvl')) lv[A(l, 'w:ilvl')] = l; abs[A(a, 'w:abstractNumId')] = lv; }
      for (const n of kids(nx.documentElement, 'num')) { const ov = {}; for (const o of kids(n, 'lvlOverride')) ov[A(o, 'w:ilvl')] = o; nums[A(n, 'w:numId')] = {abs: A(kid(n, 'abstractNumId'), 'w:val'), ov}; }
    }
    const contadores = {};
    function numero(numId, ilvl) {
      const n = nums[numId]; if (!n || numId === '0') return null;
      const lvls = abs[n.abs] || {}; const ov = n.ov[ilvl]; const lvl = (ov && kid(ov, 'lvl')) || lvls[ilvl]; if (!lvl) return null;
      const c = contadores[n.abs] = contadores[n.abs] || {};
      const ini = l => num(A(kid((n.ov[l] && kid(n.ov[l], 'lvl')) || lvls[l], 'start'), 'w:val'), 1);
      c[ilvl] = c[ilvl] === undefined ? (ov && kid(ov, 'startOverride') ? num(A(kid(ov, 'startOverride'), 'w:val')) : ini(ilvl)) : c[ilvl] + 1;
      for (const k of Object.keys(c)) if (+k > +ilvl) delete c[k];
      const fmt = A(kid(lvl, 'numFmt'), 'w:val') || 'decimal'; let txt = A(kid(lvl, 'lvlText'), 'w:val') || '';
      const roman = k => { const v = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [a, b] of v) while (k >= a) { s += b; k -= a; } return s; };
      const fmtN = (f, v) => f === 'lowerLetter' ? String.fromCharCode(96 + ((v - 1) % 26) + 1) : f === 'upperLetter' ? String.fromCharCode(64 + ((v - 1) % 26) + 1) : f === 'lowerRoman' ? roman(v).toLowerCase() : f === 'upperRoman' ? roman(v) : f === 'none' ? '' : String(v);
      if (fmt === 'bullet') { txt = txt.replace(/[]/g, ch => ({'': '•', '': '▪', '': '●', '': '➢', '': '❖', '': '✓', '': '○'}[ch])); if (txt === 'o') txt = '○'; if (!txt.trim()) txt = '•'; }
      else txt = txt.replace(/%(\d)/g, (m, d) => { const l = String(+d - 1); const lv2 = lvls[l]; return fmtN(A(kid(lv2, 'numFmt'), 'w:val') || 'decimal', c[l] ?? ini(l)); });
      return {txt, pPr: kid(lvl, 'pPr'), rPr: kid(lvl, 'rPr')};
    }
    // ---------- propiedades
    function aplicarR(pr, r) {
      if (!r) return pr;
      const t = (k, n) => { const v = onOff(kid(r, n)); if (v !== null) pr[k] = v; };
      t('b', 'b'); t('i', 'i'); t('caps', 'caps'); t('sc', 'smallCaps'); t('strike', 'strike'); t('oculto', 'vanish');
      const u = kid(r, 'u'); if (u) pr.u = A(u, 'w:val') !== 'none';
      const s = kid(r, 'sz'); if (s) pr.sz = num(A(s, 'w:val')) / 2;
      const c = kid(r, 'color'); if (c) { const tc = A(c, 'w:themeColor'); let hex = tc ? T.color(tc) : A(c, 'w:val');
        if (hex && hex !== 'auto' && /^[0-9A-Fa-f]{6}$/.test(hex)) { let rgb = hex2rgb(hex); const sh = A(c, 'w:themeShade'), ti = A(c, 'w:themeTint');
          if (sh) rgb = rgb.map(x => x * parseInt(sh, 16) / 255); if (ti) rgb = rgb.map(x => 255 - (255 - x) * parseInt(ti, 16) / 255);
          pr.color = '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join(''); } else if (hex === 'auto') pr.color = null; }
      const f = kid(r, 'rFonts'); if (f) { const fn = A(f, 'w:ascii') || A(f, 'w:hAnsi') || (A(f, 'w:asciiTheme') ? T.fuente(/major/i.test(A(f, 'w:asciiTheme')) ? '+mj' : '+mn') : null); if (fn) pr.font = fn; }
      const hl = kid(r, 'highlight'); if (hl && A(hl, 'w:val') !== 'none') pr.hl = {yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000'}[A(hl, 'w:val')] || null;
      const sh = kid(r, 'shd'); if (sh && /^[0-9A-Fa-f]{6}$/.test(A(sh, 'w:fill') || '')) pr.hl = '#' + A(sh, 'w:fill');
      const va = kid(r, 'vertAlign'); if (va) pr.va = A(va, 'w:val');
      const sp = kid(r, 'spacing'); if (sp) pr.ls = num(A(sp, 'w:val')) / 20;
      return pr;
    }
    function aplicarP(pr, p) {
      if (!p) return pr;
      const jc = kid(p, 'jc'); if (jc) pr.jc = A(jc, 'w:val');
      const sp = kid(p, 'spacing'); if (sp) { if (A(sp, 'w:before') !== null) pr.antes = num(A(sp, 'w:before')); if (A(sp, 'w:after') !== null) pr.despues = num(A(sp, 'w:after'));
        if (A(sp, 'w:line') !== null) { pr.linea = num(A(sp, 'w:line')); pr.regla = A(sp, 'w:lineRule') || 'auto'; }
        if (A(sp, 'w:beforeAutospacing') === '1') pr.antes = 280; if (A(sp, 'w:afterAutospacing') === '1') pr.despues = 280; }
      const ind = kid(p, 'ind'); if (ind) { const l = A(ind, 'w:left') ?? A(ind, 'w:start'), r = A(ind, 'w:right') ?? A(ind, 'w:end');
        if (l !== null) pr.izq = num(l); if (r !== null) pr.der = num(r); if (A(ind, 'w:firstLine') !== null) { pr.primera = num(A(ind, 'w:firstLine')); } if (A(ind, 'w:hanging') !== null) pr.primera = -num(A(ind, 'w:hanging')); }
      const np = kid(p, 'numPr'); if (np) { const ni = kid(np, 'numId'), il = kid(np, 'ilvl'); if (ni) pr.numId = A(ni, 'w:val'); if (il) pr.ilvl = A(il, 'w:val'); }
      const sh = kid(p, 'shd'); if (sh && /^[0-9A-Fa-f]{6}$/.test(A(sh, 'w:fill') || '')) pr.fondo = '#' + A(sh, 'w:fill');
      const bd = kid(p, 'pBdr'); if (bd) { pr.bordes = Object.assign({}, pr.bordes || {}); for (const b of bd.children) pr.bordes[b.localName] = b; }
      if (onOff(kid(p, 'pageBreakBefore'))) pr.saltoAntes = true;
      if (kid(p, 'contextualSpacing')) pr.contextual = onOff(kid(p, 'contextualSpacing'));
      return pr;
    }
    function propsParrafo(pPr) {
      const sid = A(kid(pPr, 'pStyle'), 'w:val') || defParr; const cad = cadena(sid);
      const pr = {jc: 'left', antes: 0, despues: 0, linea: 240, regla: 'auto', izq: 0, der: 0, primera: 0, estilo: sid};
      aplicarP(pr, defP); for (const s of cad) aplicarP(pr, s.pPr); aplicarP(pr, pPr);
      const r = {sz: 10, b: false, i: false, u: false, color: null, font: T.fn.menor || null};
      aplicarR(r, defR); for (const s of cad) aplicarR(r, s.rPr);
      return [pr, r, cad];
    }
    function cssBorde(b) { if (!b) return null; const v = A(b, 'w:val'); if (!v || v === 'nil' || v === 'none') return 'none';
      const w = Math.max(num(A(b, 'w:sz'), 4) / 8 * 1.333, 0.75); const c = A(b, 'w:color'); const col = c && c !== 'auto' ? '#' + c : (A(b, 'w:themeColor') ? '#' + (T.color(A(b, 'w:themeColor')) || '000000') : '#000');
      return f2(w) + 'px ' + (v === 'double' ? 'double' : /dash/.test(v) ? 'dashed' : /dot/.test(v) ? 'dotted' : 'solid') + ' ' + col; }
    function estiloRun(r) {
      const s = ['font-size:' + f2(r.sz) + 'pt']; if (r.font) s.push('font-family:' + familia(r.font));
      if (r.b) s.push('font-weight:700'); if (r.i) s.push('font-style:italic'); const deco = [r.u ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean); if (deco.length) s.push('text-decoration:' + deco.join(' '));
      if (r.caps) s.push('text-transform:uppercase'); if (r.sc) s.push('font-variant:small-caps'); if (r.color) s.push('color:' + r.color); if (r.hl) s.push('background:' + r.hl);
      if (r.va === 'superscript') s.push('vertical-align:super;font-size:' + f2(r.sz * 0.65) + 'pt'); if (r.va === 'subscript') s.push('vertical-align:sub;font-size:' + f2(r.sz * 0.65) + 'pt');
      if (r.ls) s.push('letter-spacing:' + f2(r.ls) + 'pt');
      return s.join(';');
    }
    // ---------- dibujos (en línea y anclados)
    const EMUS = el => num(el && (A(el, 'cx') ?? A(el, 'x')));
    async function dibujoWps(el, w, h, ctx) {         // forma de Word (wps:wsp): geometría + relleno + cuadro de texto
      const sp = kid(el, 'spPr'); const stR = estiloRef(kid(el, 'style'), T, {});
      const fill = await rellenoFinal(sp, stR, T, {imagen: bf => img(ctx.rels, bf), ph: stR.ph});
      let ln = linea(sp, T, {}); if (!ln && stR.line) ln = {color: stR.line.color, w: stR.line.w}; if (ln && !ln.ninguno && !ln.color && stR.line) ln.color = stR.line.color;
      const gm = geom(sp, w, h);
      let o = (fill && !fill.ninguno) || (ln && !ln.ninguno && ln.color) ? svgForma(gm, w, h, fill, ln, ln && ln.w ? Math.max(EPX(ln.w), 0.6) : 1, '', 'w' + (++ctx.uid.n)) : '';
      const tb = desc1(el, 'txbxContent');
      if (tb) { const bp = kid(el, 'bodyPr'); const ins = [A(bp, 'tIns') ?? 45720, A(bp, 'rIns') ?? 91440, A(bp, 'bIns') ?? 45720, A(bp, 'lIns') ?? 91440].map(v => f2(EPX(num(v))) + 'px').join(' ');
        const anc = A(bp, 'anchor'); const cuerpo = await bloques(tb, Object.assign({}, ctx, {enCaja: true}));
        o += '<div class="tb" style="padding:' + ins + ';justify-content:' + ({ctr: 'center', b: 'flex-end'}[anc] || 'flex-start') + '">' + cuerpo + '</div>'; }
      return o;
    }
    async function grupo(gEl, W0, H0, ctx) {          // wpg:wgp / wpc: hijos en coordenadas del grupo
      const gx = desc1(kid(gEl, 'grpSpPr'), 'xfrm'); const co = kid(gx, 'chOff'), ce = kid(gx, 'chExt');
      const cx0 = num(A(co, 'x')), cy0 = num(A(co, 'y')), cw = num(A(ce, 'cx')) || W0, ch = num(A(ce, 'cy')) || H0;
      let o = '';
      for (const c of gEl.children) {
        const n = c.localName; if (!['wsp', 'pic', 'grpSp', 'cxnSp'].includes(n)) continue;
        const xf = desc1(c, 'xfrm'); if (!xf) continue; const off = kid(xf, 'off'), ex = kid(xf, 'ext');
        const x = (num(A(off, 'x')) - cx0) / cw * 100, y = (num(A(off, 'y')) - cy0) / ch * 100, w = num(A(ex, 'cx')), h = num(A(ex, 'cy'));
        const tr = []; if (A(xf, 'rot')) tr.push('rotate(' + f2(num(A(xf, 'rot')) / 60000) + 'deg)'); if (A(xf, 'flipH') === '1' || A(xf, 'flipV') === '1') tr.push('scale(' + (A(xf, 'flipH') === '1' ? -1 : 1) + ',' + (A(xf, 'flipV') === '1' ? -1 : 1) + ')');
        const box = 'left:' + f2(x) + '%;top:' + f2(y) + '%;width:' + f2(w / cw * 100) + '%;height:' + f2(h / ch * 100) + '%' + (tr.length ? ';transform:' + tr.join(' ') : '');
        let inner = '';
        if (n === 'pic') { const u = await img(ctx.rels, kid(c, 'blipFill')); inner = u ? '<img src="' + u + '" alt="" style="width:100%;height:100%;object-fit:fill">' : ''; }
        else if (n === 'grpSp') inner = await grupo(c, w, h, ctx);
        else inner = await dibujoWps(c, w, h, ctx);
        o += '<div class="ab" style="' + box + '">' + inner + '</div>';
      }
      return o;
    }
    async function contenidoGrafico(gd, w, h, ctx) {
      const pic = desc1(gd, 'pic'); const wsp = desc1(gd, 'wsp'); const wgp = desc1(gd, 'wgp') || desc1(gd, 'wpc');
      if (wgp) return await grupo(wgp, w, h, ctx);
      if (wsp && !pic) return await dibujoWps(wsp, w, h, ctx);
      if (pic) { const bf = kid(pic, 'blipFill'); const u = await img(ctx.rels, bf);
        const sr = desc1(bf, 'srcRect'); let ist = 'width:100%;height:100%;object-fit:fill';
        if (sr) { const l = num(A(sr, 'l')) / 1e5, t = num(A(sr, 't')) / 1e5, r = num(A(sr, 'r')) / 1e5, b = num(A(sr, 'b')) / 1e5; const wv = 1 - l - r || 1, hv = 1 - t - b || 1;
          ist = 'position:absolute;width:' + f2(100 / wv) + '%;height:' + f2(100 / hv) + '%;left:' + f2(-l / wv * 100) + '%;top:' + f2(-t / hv * 100) + '%;max-width:none'; }
        return u ? '<div style="position:absolute;inset:0;overflow:hidden"><img src="' + u + '" alt="" style="' + ist + '"></div>' : '<div class="nd">imagen no compatible (EMF/WMF)</div>'; }
      if (/chart/.test(A(gd, 'uri') || '')) return '<div class="nd">Gráfico (ver original)</div>';
      return '';
    }
    async function dibujo(dr, ctx) {
      const inl = kid(dr, 'inline'), anc = kid(dr, 'anchor'); const el = inl || anc; if (!el) return '';
      const ex = kid(el, 'extent'); const w = num(A(ex, 'cx')), h = num(A(ex, 'cy'));
      const gd = desc1(el, 'graphicData'); const inner = await contenidoGrafico(gd, w, h, ctx);
      if (inl) return '<span class="il" style="width:' + f2(EPX(w)) + 'px;height:' + f2(EPX(h)) + 'px">' + inner + '</span>';
      // anclado
      const ph = kid(anc, 'positionH'), pv = kid(anc, 'positionV'); const sec = ctx.sec;
      const rh = A(ph, 'relativeFrom') || 'column', rv = A(pv, 'relativeFrom') || 'paragraph';
      const oh = kid(ph, 'posOffset'), ah = kid(ph, 'align'), ov = kid(pv, 'posOffset'), av = kid(pv, 'align');
      const pagW = sec.w, pagH = sec.h, mL = sec.mL, mT = sec.mT, cW = sec.w - sec.mL - sec.mR, cH = sec.h - sec.mT - sec.mB;
      const wpx = EPX(w), hpx = EPX(h);
      const refH = rh === 'page' ? [0, pagW] : ['margin', 'column', 'character', 'insideMargin'].includes(rh) ? [mL, cW] : rh === 'leftMargin' ? [0, mL] : rh === 'rightMargin' ? [pagW - sec.mR, sec.mR] : [mL, cW];
      let x = oh ? refH[0] + EPX(num(oh.textContent)) : refH[0] + ({center: (refH[1] - wpx) / 2, right: refH[1] - wpx, inside: 0, outside: refH[1] - wpx}[ah ? ah.textContent : 'left'] || 0);
      const enPagina = ['page', 'margin', 'topMargin', 'bottomMargin'].includes(rv) && !ctx.enCaja;
      const refV = rv === 'page' ? [0, pagH] : rv === 'margin' ? [mT, cH] : rv === 'topMargin' ? [0, mT] : rv === 'bottomMargin' ? [pagH - sec.mB, sec.mB] : [0, 0];
      let y = ov ? refV[0] + EPX(num(ov.textContent)) : refV[0] + ({center: (refV[1] - hpx) / 2, bottom: refV[1] - hpx}[av ? av.textContent : 'top'] || 0);
      const detras = A(anc, 'behindDoc') === '1'; const z_ = detras ? 0 : 3;
      const html_ = '<div class="ab" style="left:' + f2(x) + 'px;top:' + f2(y) + 'px;width:' + f2(wpx) + 'px;height:' + f2(hpx) + 'px;z-index:' + z_ + '">' + inner + '</div>';
      if (enPagina) { ctx.flotantes.push(html_); return '\u0002F' + (ctx.flotantes.length - 1) + '\u0002'; }
      // relativo al párrafo/línea: posición dentro del párrafo (que es relativo), x medido desde el margen izquierdo
      return '<span class="ab" style="left:' + f2(x - mL - (ctx.indent || 0)) + 'px;top:' + f2(y) + 'px;width:' + f2(wpx) + 'px;height:' + f2(hpx) + 'px;z-index:' + z_ + '">' + inner + '</span>';
    }
    // ---------- párrafos (con cortes de página)
    const PAG = '\u0000PAGINA\u0000';
    async function runs(cont, rBase, ctx, campo) {
      let o = '';
      for (const r of cont.children) {
        const n = r.localName;
        if (['hyperlink', 'smartTag', 'ins', 'customXml', 'fldSimple', 'bdo', 'dir'].includes(n)) {
          if (n === 'fldSimple' && /^\s*PAGE\b/.test(A(r, 'w:instr') || '')) { o += '<span style="' + estiloRun(rBase) + '">\u0001PG\u0001</span>'; continue; }
          o += await runs(r, rBase, ctx, campo); continue; }
        if (n === 'sdt') { const c = kid(r, 'sdtContent'); if (c) o += await runs(c, rBase, ctx, campo); continue; }
        if (n === 'AlternateContent') { const c = kid(r, 'Choice') || kid(r, 'Fallback'); if (c) o += await runs(c, rBase, ctx, campo); continue; }
        if (n !== 'r') continue;
        const rPr = kid(r, 'rPr'); const pr = Object.assign({}, rBase);
        const cs = A(kid(rPr, 'rStyle'), 'w:val'); for (const s of cadena(cs)) aplicarR(pr, s.rPr); aplicarR(pr, rPr);
        if (pr.oculto) continue;
        let txt = '';
        for (const c of r.children) {
          const k = c.localName;
          if (k === 'fldChar') { const t = A(c, 'w:fldCharType'); if (t === 'begin') { campo.estado = 'instr'; campo.instr = ''; } else if (t === 'separate') campo.estado = 'resultado'; else if (t === 'end') campo.estado = null; continue; }
          if (k === 'instrText') { campo.instr += c.textContent; continue; }
          if (campo.estado === 'instr') continue;
          if (campo.estado === 'resultado' && /^\s*(PAGE|NUMPAGES)\b/.test(campo.instr)) { if (k === 't' && !campo.puesto) { txt += /NUMPAGES/.test(campo.instr) ? '\u0001NP\u0001' : '\u0001PG\u0001'; campo.puesto = true; } if (k === 't') continue; }
          else campo.puesto = false;
          if (k === 't') { txt += esc(c.textContent); textos.push(c.textContent); }
          else if (k === 'tab' || k === 'ptab') txt += '<span class="tab"></span>';
          else if (k === 'br' || k === 'cr') { if (A(c, 'w:type') === 'page' && !ctx.enCaja && !ctx.enTabla) { if (txt) { o += '<span style="' + estiloRun(pr) + '">' + txt + '</span>'; txt = ''; } o += PAG; } else txt += '<br>'; }
          else if (k === 'lastRenderedPageBreak') { if (!ctx.enCaja && !ctx.enTabla && ctx.usarPaginacion) { if (txt) { o += '<span style="' + estiloRun(pr) + '">' + txt + '</span>'; txt = ''; } o += PAG; } }
          else if (k === 'noBreakHyphen') txt += '‑';
          else if (k === 'sym') { const ch = A(c, 'w:char'); txt += ch && /^F0/i.test(ch) ? '•' : ch ? String.fromCharCode(parseInt(ch, 16)) : ''; }
          else if (k === 'drawing') { if (txt) { o += '<span style="' + estiloRun(pr) + '">' + txt + '</span>'; txt = ''; } o += await dibujo(c, ctx); }
          else if (k === 'AlternateContent') { const ch = kid(c, 'Choice'); const dr = ch && desc1(ch, 'drawing'); if (dr) o += await dibujo(dr, ctx); else { const fb = kid(c, 'Fallback'); const tb = fb && desc1(fb, 'txbxContent'); if (tb) o += '<span class="vml">' + await bloques(tb, Object.assign({}, ctx, {enCaja: true})) + '</span>'; } }
          else if (k === 'pict' || k === 'object') { const tb = desc1(c, 'txbxContent'); if (tb) o += '<span class="vml">' + await bloques(tb, Object.assign({}, ctx, {enCaja: true})) + '</span>';
            const im = desc1(c, 'imagedata'); if (im) { const u = await img(ctx.rels, {localName: 'blip', getAttribute: a => a === 'r:embed' ? A(im, 'r:id') : null, getElementsByTagName: () => []}); if (u) o += '<img src="' + u + '" alt="" style="max-width:100%">'; } }
        }
        if (txt) o += '<span style="' + estiloRun(pr) + '">' + txt + '</span>';
      }
      return o;
    }
    async function parrafo(p, ctx) {
      const pPr = kid(p, 'pPr'); const [pr, rBase, cad] = propsParrafo(pPr);
      const rMarca = Object.assign({}, rBase); aplicarR(rMarca, kid(pPr, 'rPr'));
      if (pr.contextual) { if (ctx.estAnt === pr.estilo) pr.antes = 0; if (ctx.estSig === pr.estilo) pr.despues = 0; }
      let pre = '';
      const numId = pr.numId, ilvl = pr.ilvl || '0';
      if (numId && numId !== '0') { const n = numero(numId, ilvl); if (n) { aplicarP(pr, n.pPr); if (pPr) aplicarP(pr, pPr);
        const rn = Object.assign({}, rMarca); aplicarR(rn, n.rPr); const ancho = Math.max(-pr.primera, 0);
        pre = '<span class="num" style="' + estiloRun(rn) + ';min-width:' + f2(PX(ancho)) + 'px">' + esc(n.txt) + '</span>'; } }
      const st = ['text-align:' + ({center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify'}[pr.jc] || 'left')];
      st.push('margin:' + f2(PX(pr.antes)) + 'px ' + f2(PX(pr.der)) + 'px ' + f2(PX(pr.despues)) + 'px ' + f2(PX(pr.izq)) + 'px');
      if (pre) st.push('text-indent:' + f2(PX(pr.primera)) + 'px'); else if (pr.primera) st.push('text-indent:' + f2(PX(pr.primera)) + 'px');
      if (pr.regla === 'auto') st.push('line-height:' + f2(pr.linea / 240 * 1.15)); else st.push('line-height:' + f2(PX(pr.linea)) + 'px' + (pr.regla === 'atLeast' ? ';min-height:' + f2(PX(pr.linea)) + 'px' : ''));
      if (pr.fondo) st.push('background:' + pr.fondo);
      if (pr.bordes) for (const [k, css] of [['top', 'top'], ['bottom', 'bottom'], ['left', 'left'], ['right', 'right']]) { const b = cssBorde(pr.bordes[k]); if (b && b !== 'none') st.push('border-' + css + ':' + b + ';padding-' + css + ':' + f2(num(A(pr.bordes[k], 'w:space')) * 1.333) + 'px'); }
      st.push('font-size:' + f2(rMarca.sz) + 'pt'); if (rMarca.font) st.push('font-family:' + familia(rMarca.font));
      const cont = await runs(p, rBase, Object.assign({}, ctx, {indent: PX(pr.izq)}), {estado: null, instr: ''});
      const partes = cont.split(PAG);
      const visible = c => c.replace(/\u0002F\d+\u0002/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim() || /<(img|div|span class="(ab|il|vml))/.test(c);
      const abrir = (k, c) => '<div class="p" style="' + st.join(';') + (k > 0 ? ';text-indent:0' : '') + '">' + (k === 0 ? pre : '') + c + (visible(c) || (k === 0 && pre) ? '' : '&nbsp;') + '</div>';
      const out = [];
      partes.forEach((c, k) => {
        if (k > 0) out.push(PAG);
        const vacio = !visible(c) && !(k === 0 && pre);
        if (partes.length > 1 && vacio && (k === 0 || k < partes.length - 1)) { if (c) out.push(c); return; }   // trozo vacío junto a un corte: no deja renglón en blanco
        out.push(abrir(k, c));
      });
      if (pr.saltoAntes && !ctx.enCaja && !ctx.enTabla) out.unshift(PAG);
      return out.join('');
    }
    async function tabla(t, ctx) {
      const tp = kid(t, 'tblPr'); const sid = A(kid(tp, 'tblStyle'), 'w:val') || defTab; const cad = cadena(sid);
      const bordesT = {}; for (const s of cad) { const b = kid(s.tblPr, 'tblBorders'); if (b) for (const x of b.children) bordesT[x.localName] = x; }
      const tb = kid(tp, 'tblBorders'); if (tb) for (const x of tb.children) bordesT[x.localName] = x;
      const mar = {}; for (const s of [...cad.map(s => s.tblPr), tp]) { const m = kid(s, 'tblCellMar'); if (m) for (const x of m.children) mar[x.localName] = num(A(x, 'w:w')); }
      const grid = kids(kid(t, 'tblGrid'), 'gridCol').map(g => num(A(g, 'w:w')));
      const jc = A(kid(tp, 'jc'), 'w:val'); const ind = num(A(kid(tp, 'tblInd'), 'w:w'));
      const filas = kids(t, 'tr');
      // celdas con columnas y combinación vertical
      const M = filas.map(tr => { let c = 0; return kids(tr, 'tc').map(tc => { const pr = kid(tc, 'tcPr'); const span = num(A(kid(pr, 'gridSpan'), 'w:val'), 1); const vm = kid(pr, 'vMerge');
        const o = {tc, pr, col: c, span, vm: vm ? (A(vm, 'w:val') || 'continue') : null, rows: 1}; c += span; return o; }); });
      M.forEach((f, i) => f.forEach(c => { if (c.vm === 'restart') { let k = i + 1; while (k < M.length && M[k].some(x => x.col === c.col && x.vm === 'continue')) { c.rows++; k++; } } }));
      let o = '<table class="t" style="' + (jc === 'center' ? 'margin-left:auto;margin-right:auto;' : '') + (ind ? 'margin-left:' + f2(PX(ind)) + 'px;' : '') + 'width:' + f2(PX(grid.reduce((a, b) => a + b, 0))) + 'px"><colgroup>' + grid.map(g => '<col style="width:' + f2(PX(g)) + 'px">').join('') + '</colgroup>';
      for (let i = 0; i < filas.length; i++) {
        const trPr = kid(filas[i], 'trPr'); const hh = kid(trPr, 'trHeight');
        o += '<tr' + (hh ? ' style="height:' + f2(PX(num(A(hh, 'w:val')))) + 'px"' : '') + '>';
        for (const c of M[i]) {
          if (c.vm === 'continue') continue;
          const st = []; const ult = c.col + c.span >= grid.length, ultF = i + c.rows >= filas.length;
          const tcb = kid(c.pr, 'tcBorders'); const lados = {top: i === 0 ? 'top' : 'insideH', bottom: ultF ? 'bottom' : 'insideH', left: c.col === 0 ? (bordesT.left ? 'left' : 'start') : 'insideV', right: ult ? (bordesT.right ? 'right' : 'end') : 'insideV'};
          for (const [css, def] of Object.entries(lados)) { const b = (tcb && (kid(tcb, css) || kid(tcb, css === 'left' ? 'start' : css === 'right' ? 'end' : css))) || bordesT[def]; const v = cssBorde(b); st.push('border-' + css + ':' + (v || 'none')); }
          const sh = kid(c.pr, 'shd'); if (sh && /^[0-9A-Fa-f]{6}$/.test(A(sh, 'w:fill') || '')) st.push('background:#' + A(sh, 'w:fill')); else if (sh && A(sh, 'w:themeFill')) st.push('background:#' + (T.color(A(sh, 'w:themeFill')) || 'ffffff'));
          const va = A(kid(c.pr, 'vAlign'), 'w:val'); st.push('vertical-align:' + ({center: 'middle', bottom: 'bottom'}[va] || 'top'));
          const cm = {}; const tm = kid(c.pr, 'tcMar'); if (tm) for (const x of tm.children) cm[x.localName] = num(A(x, 'w:w'));
          const pad = k => cm[k] ?? mar[k] ?? (k === 'left' || k === 'right' || k === 'start' || k === 'end' ? 108 : 0);
          st.push('padding:' + [pad('top'), cm.right ?? mar.right ?? mar.end ?? 108, pad('bottom'), cm.left ?? mar.left ?? mar.start ?? 108].map(v => f2(PX(v)) + 'px').join(' '));
          o += '<td' + (c.span > 1 ? ' colspan="' + c.span + '"' : '') + (c.rows > 1 ? ' rowspan="' + c.rows + '"' : '') + ' style="' + st.join(';') + '">' + (await bloques(c.tc, Object.assign({}, ctx, {enTabla: true}))).split(PAG).join('') + '</td>';
        }
        o += '</tr>';
      }
      return o + '</table>';
    }
    async function bloques(el, ctx) {
      let o = '';
      const est = c => c && c.localName === 'p' ? (A(kid(kid(c, 'pPr'), 'pStyle'), 'w:val') || defParr) : null;
      const hs = [...el.children];
      for (let i = 0; i < hs.length; i++) { const c = hs[i];
        if (c.localName === 'p') o += await parrafo(c, Object.assign({}, ctx, {estAnt: est(hs[i - 1]), estSig: est(hs[i + 1])}));
        else if (c.localName === 'tbl') o += await tabla(c, ctx);
        else if (c.localName === 'sdt') { const s = kid(c, 'sdtContent'); if (s) o += await bloques(s, ctx); }
        else if (c.localName === 'customXml') o += await bloques(c, ctx);
        else if (c.localName === 'AlternateContent') { const s = kid(c, 'Choice') || kid(c, 'Fallback'); if (s) o += await bloques(s, ctx); }
      }
      return o;
    }
    // ---------- secciones, páginas, encabezados y pies
    function datosSeccion(sp) {
      const pg = kid(sp, 'pgSz'), m = kid(sp, 'pgMar');
      const r = {w: PX(num(A(pg, 'w:w'), 12240)), h: PX(num(A(pg, 'w:h'), 15840)), mT: PX(Math.abs(num(A(m, 'w:top'), 1440))), mB: PX(Math.abs(num(A(m, 'w:bottom'), 1440))),
        mL: PX(num(A(m, 'w:left'), 1440)), mR: PX(num(A(m, 'w:right'), 1440)), hd: PX(num(A(m, 'w:header'), 708)), ft: PX(num(A(m, 'w:footer'), 708)), titlePg: !!kid(sp, 'titlePg'), refs: {}};
      for (const k of ['headerReference', 'footerReference']) for (const h of kids(sp, k)) r.refs[k + ':' + (A(h, 'w:type') || 'default')] = A(h, 'r:id');
      return r;
    }
    const body = desc1(doc, 'body'); const secs = []; let actual = [];
    for (const c of body.children) {
      if (c.localName === 'sectPr') continue;
      actual.push(c);
      const sp = c.localName === 'p' ? path(c, 'pPr', 'sectPr') : null;
      if (sp) { secs.push({els: actual, sp}); actual = []; }
    }
    const spFinal = kid(body, 'sectPr'); secs.push({els: actual, sp: spFinal});
    // ¿usar la paginación guardada por Word? solo si el documento la trae
    const usarPaginacion = desc(body, 'lastRenderedPageBreak').length > 0;
    const paginas = []; let ultimoHF = {};
    for (let si = 0; si < secs.length; si++) {
      const S0 = datosSeccion(secs[si].sp); for (const [k, v] of Object.entries(S0.refs)) ultimoHF[k] = v; S0.refs = Object.assign({}, ultimoHF);
      const ctx = {rels, sec: S0, flotantes: [], uid: {n: 0}, usarPaginacion};
      let html_ = '';
      html_ += await bloques({children: secs[si].els}, ctx);
      // reparte los flotantes por página según su posición en el texto
      const trozos = html_.split(PAG);
      trozos.forEach((t, k) => {
        const flot = []; t = t.replace(/\u0002F(\d+)\u0002/g, (m, i) => { flot.push(ctx.flotantes[+i]); return ''; });
        if (k > 0 && k === trozos.length - 1 && !t.replace(/<[^>]+>|&nbsp;/g, '').trim() && !/<(img|div)/.test(t) && !flot.length) return;
        paginas.push({S: S0, html: t, flot, primera: k === 0});
      });
    }
    // los flotantes se capturan durante el armado; se asignan a la página donde aparecen
    // (aproximación: a la primera página de su sección, salvo que haya un corte antes en el mismo bloque)
    async function hf(S, tipo, n, total, primeraDeSeccion) {
      const id = (primeraDeSeccion && S.titlePg && S.refs[tipo + ':first']) || S.refs[tipo + ':default']; if (!id || !rels[id]) return '';
      const ruta = rels[id]; const x = await z.xml(ruta); if (!x) return '';
      const r2 = await relaciones(z, ruta); const ctx = {rels: r2, sec: S, flotantes: [], uid: {n: 0}, enTabla: true};
      const h = (await bloques(x.documentElement, ctx)).replace(/\u0001PG\u0001/g, n).replace(/\u0001NP\u0001/g, total).replace(/\u0002F(\d+)\u0002/g, '');
      return h + ctx.flotantes.map(f => f.replace(/top:([-\d.]+)px/, (m, v) => 'top:' + f2(+v - S.hd) + 'px').replace(/left:([-\d.]+)px/, (m, v) => 'left:' + f2(+v - S.mL) + 'px')).join('');
    }
    let out = ''; const total = paginas.length;
    for (let k = 0; k < paginas.length; k++) {
      const P = paginas[k], S = P.S;
      const cab = await hf(S, 'headerReference', k + 1, total, P.primera), pie = await hf(S, 'footerReference', k + 1, total, P.primera);
      out += '<div class="pag" style="width:' + f2(S.w) + 'px;min-height:' + f2(S.h) + 'px;padding:' + f2(S.mT) + 'px ' + f2(S.mR) + 'px ' + f2(S.mB) + 'px ' + f2(S.mL) + 'px">' +
        (cab ? '<div class="hd" style="top:' + f2(S.hd) + 'px;left:' + f2(S.mL) + 'px;right:' + f2(S.mR) + 'px">' + cab + '</div>' : '') +
        P.flot.join('') + '<div class="cuerpo">' + P.html.replace(/\u0001PG\u0001/g, k + 1).replace(/\u0001NP\u0001/g, total) + '</div>' +
        (pie ? '<div class="ft" style="bottom:' + f2(S.ft) + 'px;left:' + f2(S.mL) + 'px;right:' + f2(S.mR) + 'px">' + pie + '</div>' : '') + '<span class="npag">' + (k + 1) + ' / ' + total + '</span></div>';
    }
    const fBase = familia(T.fn.menor) || "Figtree, 'Segoe UI', system-ui, sans-serif";  // comillas simples: va dentro de atributos style
    const page = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(titulo) + '</title><style>' +
      'body{margin:0;background:#e3e6ec;padding:24px 12px;font-family:' + fBase + ';color:#000}' +
      '.pag{position:relative;margin:0 auto 24px;background:#fff;box-shadow:0 1px 6px #0003;box-sizing:border-box;overflow:hidden}' +
      '.cuerpo{position:relative;z-index:1}.hd,.ft{position:absolute;z-index:1;color:#000}' +
      '.p{margin:0;position:relative;overflow-wrap:break-word}.num{display:inline-block;text-indent:0;padding-right:4px}' +
      '.tab{display:inline-block;width:48px}.ab{position:absolute;box-sizing:border-box}.il{display:inline-block;position:relative;vertical-align:bottom}' +
      '.geo{position:absolute;inset:0;width:100%;height:100%}.tb{position:absolute;inset:0;display:flex;flex-direction:column;box-sizing:border-box;overflow:visible}' +
      '.vml{display:block;border:1px dashed #ccd;padding:4px;margin:4px 0}' +
      '.nd{position:absolute;inset:0;background:#eef0f4;border:1px dashed #b8bfcc;color:#7a8396;display:flex;align-items:center;justify-content:center;font:12px Figtree,sans-serif}' +
      'table.t{border-collapse:collapse;table-layout:fixed}table.t td{overflow-wrap:break-word}img{max-width:none}' +
      '.npag{position:absolute;right:10px;bottom:6px;font:11px Figtree,sans-serif;color:#9aa1ae}' +
      '</style></head><body>' + out + '</body></html>';
    return {page, texto: textos.join(' '), avisos};
  }

  async function docxAHtml(u8, titulo) { const z = await abrirZip(u8); return await docx(z, titulo); }
  async function pptxAHtml(u8, titulo) { const z = await abrirZip(u8); return await pptx(z, titulo); }
  return {docxAHtml, pptxAHtml};
})();
