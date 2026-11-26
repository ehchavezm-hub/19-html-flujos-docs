/* PDF → HTML (sin internet). Usa PDF.js (web/vendor, licencia Apache-2.0) solo para LEER el PDF; el dibujo lo
   arma este módulo: cada página es un SVG con
     · texto real (<text>, seleccionable y que encuentra Ctrl+F), en su fuente y posición exactas
       (textLength ajusta el ancho aunque la PC no tenga la misma fuente),
     · líneas, rellenos y tablas como vectores (nítidos con cualquier zoom),
     · imágenes reducidas a 1600 px en WebP.
   No se incrusta el PDF: el resultado pesa mucho menos y se comporta como HTML. */
const PDFX = (() => {
  const OPS = {setLineWidth: 2, setDash: 6, setGState: 9, save: 10, restore: 11, transform: 12, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17,
    closePath: 18, rectangle: 19, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27,
    endPath: 28, clip: 29, eoClip: 30, beginText: 31, setCharSpacing: 33, setWordSpacing: 34, setHScale: 35, setLeading: 36, setFont: 37, setTextRenderingMode: 38, setTextRise: 39,
    moveText: 40, setLeadingMoveText: 41, setTextMatrix: 42, nextLine: 43, showText: 44, showSpacedText: 45, nextLineShowText: 46, nextLineSetSpacingShowText: 47,
    setStrokeColorN: 53, setFillColorN: 55, setStrokeRGBColor: 58, setFillRGBColor: 59, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, beginGroup: 76, endGroup: 77,
    paintImageMaskXObject: 83, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageXObjectRepeat: 88, paintSolidColorImageMask: 90, constructPath: 91};
  const ESC = 96 / 72;                                   // puntos → píxeles CSS (como Word)
  const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const hex = (r, g, b) => '#' + [r, g, b].map(v => (v | 0).toString(16).padStart(2, '0')).join('');
  const escX = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let iniciado = false;
  function iniciar() {
    if (iniciado) return; if (typeof pdfjsLib === 'undefined') throw new Error('falta el lector de PDF');
    const wk = document.getElementById('pdfjs-worker');
    if (wk) pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([wk.textContent], {type: 'text/javascript'}));
    iniciado = true;
  }

  // ---------- fuentes: nombre del PDF → familia CSS
  function fuenteCss(f) {
    let n = String((f && f.name) || '').replace(/^[A-Z]{6}\+/, ''); const fb = (f && f.fallbackName) || 'sans-serif';
    const [base, estilo = ''] = n.split(/[-,]/); const sinSuf = (base || '').replace(/(PSMT|PS|MT)$/, '');
    const conEsp = sinSuf.replace(/([a-z])([A-Z])/g, '$1 $2');
    const fam = [...new Set([conEsp, sinSuf].filter(Boolean))].map(x => "'" + x.replace(/'/g, '') + "'").join(',');
    const negrita = (f && (f.black || f.bold)) || /bold|black|heavy|semibold|demi/i.test(estilo + n);
    const peso = f && f.black || /black|heavy/i.test(estilo) ? 900 : /semibold|demi/i.test(estilo) ? 600 : /light/i.test(estilo) ? 300 : negrita ? 700 : 400;
    const cursiva = (f && f.italic) || /italic|oblique/i.test(estilo);
    return 'font-family:' + (fam ? fam + ',' : '') + fb + ';font-weight:' + peso + (cursiva ? ';font-style:italic' : '');
  }

  // ---------- imágenes → WebP reducido
  async function imagenUrl(d) {
    if (!d) return null; const w = d.width, h = d.height; if (!w || !h) return null;
    let src;
    if (d.bitmap) { src = d.bitmap; }
    else if (d.data) {
      const id = new ImageData(w, h); const o = id.data, s = d.data;
      if (d.kind === 3) o.set(s.subarray(0, w * h * 4));
      else if (d.kind === 2) { for (let i = 0, j = 0; i < w * h; i++, j += 3) { o[i * 4] = s[j]; o[i * 4 + 1] = s[j + 1]; o[i * 4 + 2] = s[j + 2]; o[i * 4 + 3] = 255; } }
      else if (d.kind === 1) { const fila = (w + 7) >> 3; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (s[y * fila + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; const k = (y * w + x) * 4; o[k] = o[k + 1] = o[k + 2] = v; o[k + 3] = 255; } }
      else return null;
      src = new OffscreenCanvas(w, h); src.getContext('2d').putImageData(id, 0, 0);
    } else return null;
    const k = Math.min(1, 1600 / Math.max(w, h)); const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const cv = new OffscreenCanvas(cw, ch); const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, cw, ch);
    const b = await cv.convertToBlob({type: 'image/webp', quality: 0.8});
    const u8 = new Uint8Array(await b.arrayBuffer()); let t = ''; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return 'data:' + (b.type || 'image/png') + ';base64,' + btoa(t);
  }

  // ---------- una página
  async function pagina(pg, fuentes, imgCache) {
    const vp = pg.getViewport({scale: ESC}); const W = vp.width, H = vp.height;
    const ol = await pg.getOperatorList(); const fn = ol.fnArray, aa = ol.argsArray;
    const els = []; const textoPag = [];
    let st = {ctm: vp.transform.slice(), fill: '#000000', stroke: '#000000', lw: 1, dash: null, fa: 1, sa: 1,
      font: null, fid: '', size: 0, dir: 1, tc: 0, tw: 0, th: 1, lead: 0, rise: 0, modo: 0};
    let tm = [1, 0, 0, 1, 0, 0], lx = 0, ly = 0, cx = 0, cy = 0;   // como PDF.js: matriz de texto fija + desplazamiento de línea y avance
    const mover = (x, y) => { cx = lx += x; cy = ly += y; };
    const pila = []; let ruta = '';
    // geometría de la ruta actual (para reconocer tablas, reglas, cajas y dibujos)
    const nuevoGeo = () => ({rects: [], segs: [], subs: [], curva: false, bb: [1e9, 1e9, -1e9, -1e9], pt: null, ini: null});
    let geo = nuevoGeo();
    const D = (x, y) => { const p = ap(st.ctm, x, y); const b = geo.bb; if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; return p; };
    const P = (x, y) => { const p = D(x, y); return r1(p[0]) + ' ' + r1(p[1]); };
    const recto = () => Math.abs(st.ctm[1]) < 1e-6 && Math.abs(st.ctm[2]) < 1e-6 || Math.abs(st.ctm[0]) < 1e-6 && Math.abs(st.ctm[3]) < 1e-6;
    const escala = () => Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])) || 1;
    function emitirRuta(fill, stroke, eo) {
      if (!ruta) return; const d = ruta; ruta = ''; const g = geo; geo = nuevoGeo();
      if (fill && !st.fill) fill = false; if (!fill && !stroke) return;
      let a = 'fill="' + (fill ? st.fill : 'none') + '"' + (fill && eo ? ' fill-rule="evenodd"' : '') + (fill && st.fa < 1 ? ' fill-opacity="' + r2(st.fa) + '"' : '');
      if (stroke) { const w = Math.max(st.lw * escala(), 0.5);
        a += ' stroke="' + st.stroke + '" stroke-width="' + r2(w) + '"' + (st.sa < 1 ? ' stroke-opacity="' + r2(st.sa) + '"' : '') +
          (st.dash && st.dash.length ? ' stroke-dasharray="' + st.dash.map(v => r2(v * escala())).join(' ') + '"' : ''); }
      const info = {fill: fill ? st.fill : null, stroke: stroke ? st.stroke : null, lw: stroke ? Math.max(st.lw * escala(), 0.5) : 0, fa: st.fa};
      const prev = els[els.length - 1];                    // unir trazos seguidos con el mismo estilo (bordes de tablas)
      if (prev && prev.t === 'p' && prev.a === a) { prev.d += ' ' + d; prev.g.push({g, d, ...info}); } else els.push({t: 'p', a, d, g: [{g, d, ...info}]});
    }
    function texto(glyphs) {
      const f = st.font; if (!f || !st.size) return;
      const fm = (f.fontMatrix || [0.001])[0]; const adv = st.size * fm; const hs = st.th * st.dir;
      let x = 0, seg = null; const segs = [];
      const cerrar = () => { if (seg && seg.s.trim()) { seg.x1 = x; segs.push(seg); } seg = null; };
      for (const g of glyphs) {
        if (typeof g === 'number') { const dx = -g * st.size / 1000; if (Math.abs(dx) > st.size * 0.6) cerrar(); else if (dx > st.size * 0.18 && seg && !seg.s.endsWith(' ')) seg.s += ' '; x += dx; continue; }
        if (!g) continue;
        const sp = (g.isSpace ? st.tw : 0) + st.tc; const u = g.unicode || '';
        if (!seg) { if (u.trim()) seg = {x0: x, s: ''}; }
        if (seg) seg.s += u;
        x += g.width * adv + sp * st.dir;
      }
      cerrar();
      const M = mul(st.ctm, tm); const x0 = cx; cx += x * hs; const modo = st.modo & 3;
      const color = modo === 3 ? 'transparent' : modo === 1 ? st.stroke : st.fill;
      if (!fuentes.has(st.fid)) fuentes.set(st.fid, {css: fuenteCss(f), n: fuentes.size});
      const cls = 'f' + fuentes.get(st.fid).n;
      for (const s of segs) {
        const a = ap(M, x0 + s.x0 * hs, cy + st.rise), b = ap(M, x0 + s.x1 * hs, cy + st.rise);
        const v = ap(M, 0, st.size); const o = ap(M, 0, 0); const sz = Math.hypot(v[0] - o[0], v[1] - o[1]);
        if (sz < 0.5) continue;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let txt = s.s.replace(/\s+$/, ''); let largo = len * (txt.length / Math.max(s.s.length, 1));
        // texto horizontal que se sale de su recorte: se corta como en el PDF
        if (st.clip && Math.abs(ang) < 0.3 && largo > 0) { const c = st.clip; if (a[1] < c[1] - sz || a[1] > c[3] + sz * 0.5 || a[0] > c[2] - 0.5) continue;
          if (a[0] + largo > c[2] + 1) { const n = Math.max(0, Math.floor(txt.length * (c[2] - a[0]) / largo)); if (!n) continue; txt = txt.slice(0, n).replace(/\s+$/, ''); largo = largo * txt.length / s.s.replace(/\s+$/, '').length; } }
        els.push({t: 't', cls, sz: r1(sz), x: r1(a[0]), y: r1(a[1]), ang: Math.abs(ang) < 0.3 ? 0 : r1(ang), len: r1(largo), s: txt,
          col: color, op: st.fa < 1 ? st.fa : 1});
        textoPag.push(txt);
      }
    }
    async function imagen(d, mascara) {
      let u = null; if (d && d._id && imgCache.has(d._id)) u = imgCache.get(d._id); else { try { u = await imagenUrl(d); } catch (e) { u = null; } if (d && d._id) imgCache.set(d._id, u); }
      if (!u) return; const m = mul(st.ctm, [1, 0, 0, -1, 0, 1]);
      // la misma imagen (logos del encabezado en cada página) se guarda una sola vez y se reutiliza con <use>
      if (!imgCache.urls.has(u)) imgCache.urls.set(u, 'im' + imgCache.urls.size);
      const cs = [ap(m, 0, 0), ap(m, 1, 0), ap(m, 0, 1), ap(m, 1, 1)]; const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
      els.push({t: 'i', id: imgCache.urls.get(u), giro: Math.abs(m[1]) > 1e-3 || Math.abs(m[2]) > 1e-3 || m[0] < 0 || m[3] < 0,
        bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], h: '<use href="#' + imgCache.urls.get(u) + '" transform="matrix(' + m.map(v => +v.toFixed(4)).join(' ') + ')"' + (st.fa < 1 ? ' opacity="' + r2(st.fa) + '"' : '') + '/>'});
    }
    const obj = id => { try { return (id.startsWith('g_') ? pg.commonObjs : pg.objs).get(id); } catch (e) { return null; } };

    for (let i = 0; i < fn.length; i++) {
      const a = aa[i];
      switch (fn[i]) {
        case OPS.save: pila.push(Object.assign({}, st, {ctm: st.ctm.slice()})); break;
        case OPS.restore: if (pila.length) st = pila.pop(); break;
        case OPS.transform: st.ctm = mul(st.ctm, a); break;
        case OPS.setLineWidth: st.lw = a[0]; break;
        case OPS.setDash: st.dash = a[0]; break;
        case OPS.setGState: for (const [k, v] of a[0]) { if (k === 'LW') st.lw = v; else if (k === 'ca') st.fa = v; else if (k === 'CA') st.sa = v; else if (k === 'D') st.dash = v[0]; else if (k === 'Font') { st.fid = v[0]; st.font = obj(v[0]); st.size = Math.abs(v[1]); st.dir = v[1] < 0 ? -1 : 1; } } break;
        case OPS.setFillRGBColor: st.fill = hex(a[0], a[1], a[2]); break;
        case OPS.setStrokeRGBColor: st.stroke = hex(a[0], a[1], a[2]); break;
        case OPS.setFillColorN: st.fill = null; break;             // tramas y degradados: no se dibujan
        case OPS.setStrokeColorN: break;
        case OPS.constructPath: {
          const ops = a[0], c = a[1]; let j = 0, cx = 0, cy = 0;
          for (const op of ops) {
            if (op === OPS.rectangle) { const x = c[j++], y = c[j++], w = c[j++], h = c[j++]; ruta += 'M' + P(x, y) + 'L' + P(x + w, y) + 'L' + P(x + w, y + h) + 'L' + P(x, y + h) + 'Z'; cx = x; cy = y;
              const p = ap(st.ctm, x, y), q = ap(st.ctm, x + w, y + h);
              if (recto()) geo.rects.push([Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])]); else geo.curva = true; }
            else if (op === OPS.moveTo) { cx = c[j++]; cy = c[j++]; ruta += 'M' + P(cx, cy); geo.pt = geo.ini = ap(st.ctm, cx, cy); geo.subs.push({p: [geo.pt], ok: true}); }
            else if (op === OPS.lineTo) { cx = c[j++]; cy = c[j++]; ruta += 'L' + P(cx, cy); const q = ap(st.ctm, cx, cy); if (geo.pt) { geo.segs.push([geo.pt[0], geo.pt[1], q[0], q[1]]); const sb = geo.subs[geo.subs.length - 1]; if (sb) { if (Math.abs(geo.pt[0] - q[0]) > 0.6 && Math.abs(geo.pt[1] - q[1]) > 0.6) sb.ok = false; sb.p.push(q); } } geo.pt = q; }
            else if (op === OPS.curveTo) { geo.curva = true; ruta += 'C' + P(c[j], c[j + 1]) + ' ' + P(c[j + 2], c[j + 3]) + ' ' + P(c[j + 4], c[j + 5]); cx = c[j + 4]; cy = c[j + 5]; j += 6; }
            else if (op === OPS.curveTo2) { geo.curva = true; ruta += 'C' + P(cx, cy) + ' ' + P(c[j], c[j + 1]) + ' ' + P(c[j + 2], c[j + 3]); cx = c[j + 2]; cy = c[j + 3]; j += 4; }
            else if (op === OPS.curveTo3) { geo.curva = true; ruta += 'C' + P(c[j], c[j + 1]) + ' ' + P(c[j + 2], c[j + 3]) + ' ' + P(c[j + 2], c[j + 3]); cx = c[j + 2]; cy = c[j + 3]; j += 4; }
            else if (op === OPS.closePath) { ruta += 'Z'; if (geo.pt && geo.ini) geo.segs.push([geo.pt[0], geo.pt[1], geo.ini[0], geo.ini[1]]); geo.pt = geo.ini; }
          }
          break; }
        case OPS.fill: emitirRuta(true, false, false); break;
        case OPS.eoFill: emitirRuta(true, false, true); break;
        case OPS.stroke: emitirRuta(false, true); break;
        case OPS.closeStroke: ruta += 'Z'; emitirRuta(false, true); break;
        case OPS.fillStroke: emitirRuta(true, true, false); break;
        case OPS.eoFillStroke: emitirRuta(true, true, true); break;
        case OPS.closeFillStroke: ruta += 'Z'; emitirRuta(true, true, false); break;
        case OPS.closeEOFillStroke: ruta += 'Z'; emitirRuta(true, true, true); break;
        case OPS.endPath: ruta = ''; geo = nuevoGeo(); break;
        // recorte rectangular (Excel recorta así el texto de cada celda): se guarda para cortar los textos que se salen
        case OPS.clip: case OPS.eoClip: if (geo.rects.length === 1 && !geo.curva && !geo.segs.length) { const r = geo.rects[0];
            st.clip = st.clip ? [Math.max(st.clip[0], r[0]), Math.max(st.clip[1], r[1]), Math.min(st.clip[2], r[2]), Math.min(st.clip[3], r[3])] : r.slice(); } break;
        case OPS.beginText: tm = [1, 0, 0, 1, 0, 0]; lx = ly = cx = cy = 0; break;
        case OPS.setCharSpacing: st.tc = a[0]; break;
        case OPS.setWordSpacing: st.tw = a[0]; break;
        case OPS.setHScale: st.th = a[0] / 100; break;
        case OPS.setLeading: st.lead = -a[0]; break;
        case OPS.setFont: st.fid = a[0]; st.font = obj(a[0]); st.size = Math.abs(a[1]); st.dir = a[1] < 0 ? -1 : 1; break;
        case OPS.setTextRenderingMode: st.modo = a[0]; break;
        case OPS.setTextRise: st.rise = a[0]; break;
        case OPS.moveText: mover(a[0], a[1]); break;
        case OPS.setLeadingMoveText: st.lead = a[1]; mover(a[0], a[1]); break;
        case OPS.setTextMatrix: tm = a.slice(0, 6); lx = ly = cx = cy = 0; break;
        case OPS.nextLine: mover(0, st.lead); break;
        case OPS.showText: case OPS.showSpacedText: texto(a[0]); break;
        case OPS.nextLineShowText: mover(0, st.lead); texto(a[0]); break;
        case OPS.nextLineSetSpacingShowText: st.tw = a[0]; st.tc = a[1]; mover(0, st.lead); texto(a[2]); break;
        case OPS.paintFormXObjectBegin: pila.push(Object.assign({}, st, {ctm: st.ctm.slice()})); if (Array.isArray(a[0]) && a[0].length === 6) st.ctm = mul(st.ctm, a[0]); break;
        case OPS.paintFormXObjectEnd: if (pila.length) st = pila.pop(); break;
        case OPS.beginGroup: pila.push(Object.assign({}, st, {ctm: st.ctm.slice()})); if (a[0] && a[0].matrix) st.ctm = mul(st.ctm, a[0].matrix); break;
        case OPS.endGroup: if (pila.length) st = pila.pop(); break;
        case OPS.paintImageXObject: case OPS.paintImageXObjectRepeat: { const d = obj(a[0]); if (d) { d._id = a[0]; await imagen(d); } break; }
        case OPS.paintInlineImageXObject: await imagen(a[0]); break;
        case OPS.paintSolidColorImageMask: if (st.fill) { ruta = 'M' + P(0, 0) + 'L' + P(1, 0) + 'L' + P(1, 1) + 'L' + P(0, 1) + 'Z'; emitirRuta(true, false); } break;
      }
    }

    // unir textos seguidos de la misma línea y estilo (menos elementos, selección más natural)
    const out = []; let ult = null;
    for (const e of els) {
      if (e.t === 't' && ult && ult.t === 't' && !e.ang && !ult.ang && e.cls === ult.cls && e.sz === ult.sz && e.col === ult.col && Math.abs(e.y - ult.y) < 0.6) {
        const fin = ult.x + ult.len, hueco = e.x - fin;
        if (hueco > -ult.sz * 0.3 && hueco < ult.sz * 0.6) { ult.s += (hueco > ult.sz * 0.12 && !ult.s.endsWith(' ') ? ' ' : '') + e.s; ult.len = r1(e.x + e.len - ult.x); continue; }
      }
      out.push(e); ult = e;
    }
    let svg = '';
    for (const e of out) {
      if (e.t === 'p') svg += '<path d="' + e.d + '" ' + e.a + '/>';
      else if (e.t === 'i') svg += e.h;
      else svg += '<text class="' + e.cls + '" x="' + e.x + '" y="' + e.y + '" font-size="' + e.sz + '"' + (e.col !== '#000000' ? ' fill="' + e.col + '"' : '') + (e.op < 1 ? ' fill-opacity="' + r2(e.op) + '"' : '') +
        (e.s.length > 1 && e.len > 0 ? ' textLength="' + e.len + '" lengthAdjust="spacingAndGlyphs"' : '') + (e.ang ? ' transform="rotate(' + e.ang + ' ' + e.x + ' ' + e.y + ')"' : '') + '>' + escX(e.s) + '</text>';
    }
    const html = '<div class="pag" style="width:' + r1(W) + 'px;height:' + r1(H) + 'px"><svg viewBox="0 0 ' + r1(W) + ' ' + r1(H) + '" width="' + r1(W) + '" height="' + r1(H) + '">' + svg + '</svg></div>';
    let real = null; try { CLS_CSS = new Map([...fuentes.values()].map(f => ['f' + f.n, f.css])); real = estructurar(out, W, H); } catch (e) { console.warn('PDF→HTML: página como dibujo', e); }
    return {html: real || html, real: !!real, texto: textoPag.join(' ')};
  }


  // =================================================================== reconstrucción como HTML real
  // A partir de lo que la página dibuja (textos, trazos, rellenos, imágenes) arma HTML de verdad:
  //   tablas → <table> (filas, columnas, celdas combinadas, bordes y fondos), texto → <p> con su alineación y estilos,
  //   reglas → <hr>, imágenes → bloques en su lugar. Lo que es un dibujo (curvas, logos vectoriales) queda como SVG pequeño.
  //   Si algo se superpone (texto sobre una caja de color, logos al lado de un título), ese tramo se coloca por posición.
  const colorHex = c => c && c !== 'transparent' ? c : null;
  const esBlanco = c => !c || /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(c) && parseInt(c.slice(1, 3), 16) > 250 && parseInt(c.slice(3, 5), 16) > 250 && parseInt(c.slice(5, 7), 16) > 250;
  const solapaY = (a, b, t = 0) => a[1] < b[3] - t && b[1] < a[3] - t;
  const solapaX = (a, b, t = 0) => a[0] < b[2] - t && b[0] < a[2] - t;
  const dentro = (x, y, b, t = 0) => x >= b[0] - t && x <= b[2] + t && y >= b[1] - t && y <= b[3] + t;
  const px = v => r1(v) + 'px';
  let ESTILOS = new Map();
  // medir el texto con la fuente que usará el navegador: si ocupa más (o mucho menos) que en el PDF, se ajusta el espaciado de letras
  let CLS_CSS = new Map(); let CTX = null; const MEDIDAS = new Map();
  function ancho(cls, sz, s) {
    const k = cls + '|' + sz + '|' + s; if (MEDIDAS.has(k)) return MEDIDAS.get(k);
    if (!CTX) { try { CTX = new OffscreenCanvas(1, 1).getContext('2d'); } catch (e) { CTX = false; } }
    let w = 0; if (CTX) { const css = CLS_CSS.get(cls) || ''; const fam = (css.match(/font-family:([^;]+)/) || [, 'sans-serif'])[1], pes = (css.match(/font-weight:(\d+)/) || [, '400'])[1], it = /italic/.test(css) ? 'italic ' : '';
      CTX.font = it + pes + ' ' + sz + 'px ' + fam; w = CTX.measureText(s).width; }
    MEDIDAS.set(k, w); return w;
  }                                   // estilos repetidos → clases (pesa menos)
  const clase = css => { if (!ESTILOS.has(css)) ESTILOS.set(css, 'e' + ESTILOS.size.toString(36)); return ESTILOS.get(css); };

  // ---------- gráficos (barras): muchas cajas de color del mismo ancho apoyadas en la misma base, o del mismo alto
  // alineadas a la izquierda. Esa zona (barras, rejilla, ejes, etiquetas y leyenda) se conserva como dibujo SVG.
  function graficos(els) {
    const cajas = [];
    for (const e of els) if (e.t === 'p') for (const q of e.g) if (q.fill && !esBlanco(q.fill) && !q.g.curva)
      // rectángulos: los del operador «re» o subtrayectos de 4 lados rectos (Excel dibuja así cada barra, a veces todas en un mismo trayecto)
      for (const r of (q.g.rects.length ? q.g.rects : q.g.subs.filter(sb => sb.ok && sb.p.length >= 4 && sb.p.length <= 6).map(sb => [Math.min(...sb.p.map(p => p[0])), Math.min(...sb.p.map(p => p[1])), Math.max(...sb.p.map(p => p[0])), Math.max(...sb.p.map(p => p[1]))]))) { const w = r[2] - r[0], h = r[3] - r[1]; if (w > 2.2 && h > 2.2) cajas.push({r, w, h, c: q.fill}); }   // las líneas (rectángulos finos) no son barras
    const zonas = [];
    const agrupar = (clave) => { const m = new Map(); for (const c of cajas) { const k = clave(c); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(c); } return [...m.values()]; };
    const cen = els.filter(e => e.t === 't' && !e.ang).map(e => [e.x + e.len / 2, e.y - e.sz * 0.3]);
    const conTexto = c => cen.some(([x, y]) => x > c.r[0] && x < c.r[2] && y > c.r[1] && y < c.r[3]);
    // barras: separadas entre sí (las celdas de una tabla se tocan) y sin texto dentro
    const separadas = (g, vert) => { const o = g.slice().sort((a, b) => vert ? a.r[0] - b.r[0] : a.r[1] - b.r[1]); let n = 0;
      for (let i = 1; i < o.length; i++) { const gap = vert ? o[i].r[0] - o[i - 1].r[2] : o[i].r[1] - o[i - 1].r[3]; if (gap > 0.6) n++; } return n >= (o.length - 1) * 0.6; };
    const grupos = [...agrupar(c => c.c + '|' + Math.round(c.w * 2) + '|' + Math.round(c.r[3] / 2)).map(g => [g, true]), ...agrupar(c => c.c + '|' + Math.round(c.h * 2) + '|' + Math.round(c.r[0] / 2)).map(g => [g, false])];
    for (const [g, vert] of grupos) {
      if (g.length < 6 || !separadas(g, vert) || g.filter(conTexto).length > g.length * 0.2) continue;
      const bb = [Math.min(...g.map(c => c.r[0])), Math.min(...g.map(c => c.r[1])), Math.max(...g.map(c => c.r[2])), Math.max(...g.map(c => c.r[3]))];
      if (bb[2] - bb[0] < 60 && bb[3] - bb[1] < 60) continue;
      // barras de distinto tamaño (no una fila de celdas iguales de una tabla)
      const lados = g.map(c => vert ? c.h : c.w); const tam = new Set(lados.map(Math.round)); if (tam.size < 3 || Math.max(...lados) < Math.min(...lados) * 1.8) continue;
      const z = zonas.find(z => solapaX(z, bb, -30) && solapaY(z, bb, -30));
      if (z) { z[0] = Math.min(z[0], bb[0]); z[1] = Math.min(z[1], bb[1]); z[2] = Math.max(z[2], bb[2]); z[3] = Math.max(z[3], bb[3]); } else zonas.push(bb);
    }
    // cada zona se amplía a los ejes, etiquetas y el marco del gráfico
    const res = zonas.map(z => [z[0] - 60, z[1] - 40, z[2] + 40, z[3] + 70]);
    // leyendas: 4 o más muestras de color pequeñas y sueltas (no se tocan entre sí) en una franja de pocas filas.
    // Su texto suele ir recortado por la celda; reflujarlo lo desordena, así que la franja se conserva como dibujo.
    const toca = (a, b) => a !== b && a.r[0] <= b.r[2] + 1.5 && b.r[0] <= a.r[2] + 1.5 && a.r[1] <= b.r[3] + 1.5 && b.r[1] <= a.r[3] + 1.5;
    const mues = cajas.filter(c => c.w >= 5 && c.h >= 5 && c.w <= 45 && c.h <= 30 && c.w / c.h < 4 && c.h / c.w < 4).filter(c => !cajas.some(o => o !== c && toca(c, o) && !(o.r[0] >= c.r[0] - 0.5 && o.r[2] <= c.r[2] + 0.5 && o.r[1] >= c.r[1] - 0.5 && o.r[3] <= c.r[3] + 0.5) && !(c.r[0] >= o.r[0] - 0.5 && c.r[2] <= o.r[2] + 0.5 && c.r[1] >= o.r[1] - 0.5 && c.r[3] <= o.r[3] + 0.5)));
    const usadas = new Set();
    for (const c of mues) {
      if (usadas.has(c)) continue; const grupo = [c]; usadas.add(c); let bb = c.r.slice();
      for (let cambio = true; cambio;) { cambio = false;
        for (const o of mues) if (!usadas.has(o) && o.r[1] < bb[3] + o.h * 1.2 && o.r[3] > bb[1] - o.h * 1.2 && o.r[0] < bb[2] + 260 && o.r[2] > bb[0] - 260) {
          usadas.add(o); grupo.push(o); bb = [Math.min(bb[0], o.r[0]), Math.min(bb[1], o.r[1]), Math.max(bb[2], o.r[2]), Math.max(bb[3], o.r[3])]; cambio = true; } }
      if (grupo.length >= 4 && bb[3] - bb[1] < 90 && !res.some(z => solapaX(z, bb) && solapaY(z, bb))) res.push([bb[0] - 4, bb[1] - 3, bb[2] + 170, bb[3] + 3]);
    }
    return res;
  }
  function estructurar(els, W, H) {
    const textos = [], imgs = [], lineas = [], cajas = [], dibujos = [];
    const zonasG = graficos(els);
    if (zonasG.length) {
      const enZona = bb => zonasG.findIndex(z => bb[0] >= z[0] && bb[1] >= z[1] && bb[2] <= z[2] && bb[3] <= z[3]);
      const partes = zonasG.map(() => ({svg: '', bb: [1e9, 1e9, -1e9, -1e9]}));
      const suma = (k, bb, svg) => { const P = partes[k]; P.svg += svg; P.bb = [Math.min(P.bb[0], bb[0]), Math.min(P.bb[1], bb[1]), Math.max(P.bb[2], bb[2]), Math.max(P.bb[3], bb[3])]; };
      const resto = [];
      for (const e of els) {
        if (e.t === 'p') { const g2 = [];
          for (const q of e.g) { const k = enZona(q.g.bb); if (k >= 0) suma(k, q.g.bb, '<path d="' + q.d + '" ' + e.a + '/>'); else g2.push(q); }
          if (g2.length) resto.push(g2.length === e.g.length ? e : Object.assign({}, e, {g: g2})); }
        else if (e.t === 't') { const bb = [e.x - 1, e.y - e.sz, e.x + e.len + 1, e.y + e.sz * 0.3]; const k = e.ang ? -1 : enZona(bb);
          const k2 = e.ang ? zonasG.findIndex(z => dentro(e.x, e.y, z)) : k;
          if (k2 >= 0) suma(k2, bb, textoSvg(e)); else resto.push(e); }
        else if (e.t === 'i') { const k = enZona(e.bb); if (k >= 0) suma(k, e.bb, e.h); else resto.push(e); }
        else resto.push(e);
      }
      for (const P of partes) if (P.svg) dibujos.push({bb: P.bb, svg: '<g data-graf="1">' + P.svg + '</g>', grafico: true});
      els = resto;
    }
    for (const e of els) {
      if (e.t === 't') { if (e.ang) { const a = e.ang * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
          const pts = [[0, -e.sz * 0.85], [e.len, -e.sz * 0.85], [0, e.sz * 0.25], [e.len, e.sz * 0.25]].map(([u, v]) => [e.x + u * co - v * si, e.y + u * si + v * co]);
          dibujos.push({bb: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))], svg: textoSvg(e), txt: true}); } else textos.push(Object.assign({}, e, {bb: [e.x, e.y - e.sz * 0.82, e.x + e.len, e.y + e.sz * 0.22]})); }
      else if (e.t === 'i') { if (e.giro) dibujos.push({bb: e.bb, svg: e.h}); else imgs.push(e); }
      else if (e.t === 'p') for (const q of e.g) clasificar(q, e);
    }
    function clasificar(q, e) {
      const g = q.g;   // las líneas blancas sirven para la estructura de tablas (separan celdas sobre fondo oscuro); solas no se dibujan
      const ejes = g.segs.every(sg => Math.abs(sg[0] - sg[2]) < 0.6 || Math.abs(sg[1] - sg[3]) < 0.6);
      if (g.curva || !ejes) { dibujos.push({bb: g.bb, svg: '<path d="' + e.d + '" ' + e.a + '/>', dedup: e}); return; }
      const rects = g.rects.slice();
      // polígonos cerrados de 4 lados alineados (algunos programas dibujan así los rectángulos)
      if (!rects.length && q.fill && g.segs.length >= 3 && g.segs.length <= 5) rects.push(g.bb.slice());
      for (const r of rects) {
        const w = r[2] - r[0], h = r[3] - r[1];
        if (q.fill && (w <= 2.6 || h <= 2.6)) {               // rectángulo delgado = línea
          if (w >= h) lineas.push({o: 'h', p: (r[1] + r[3]) / 2, a: r[0], b: r[2], w: Math.max(h, 0.6), c: q.fill});
          else lineas.push({o: 'v', p: (r[0] + r[2]) / 2, a: r[1], b: r[3], w: Math.max(w, 0.6), c: q.fill});
        } else if (q.fill && !esBlanco(q.fill) && q.fa > 0.05) {
          cajas.push({bb: r, c: q.fill, borde: q.stroke ? {w: q.lw, c: q.stroke} : null});
        }
        if (q.stroke && w > 2.6 && h > 2.6) {
          lineas.push({o: 'h', p: r[1], a: r[0], b: r[2], w: q.lw, c: q.stroke}, {o: 'h', p: r[3], a: r[0], b: r[2], w: q.lw, c: q.stroke},
            {o: 'v', p: r[0], a: r[1], b: r[3], w: q.lw, c: q.stroke}, {o: 'v', p: r[2], a: r[1], b: r[3], w: q.lw, c: q.stroke});
        }
      }
      if (q.stroke) for (const sg of g.segs) {
        if (Math.abs(sg[1] - sg[3]) < 0.6) lineas.push({o: 'h', p: sg[1], a: Math.min(sg[0], sg[2]), b: Math.max(sg[0], sg[2]), w: q.lw, c: q.stroke});
        else lineas.push({o: 'v', p: sg[0], a: Math.min(sg[1], sg[3]), b: Math.max(sg[1], sg[3]), w: q.lw, c: q.stroke});
      }
    }
    // bordes «virtuales» (sin dibujo) de las celdas pintadas: así una fila de encabezado de color o una tabla sin líneas también es tabla.
    // Solo para cajas que se tocan con otra (una grilla); una caja suelta (muestra de color de una leyenda, etiqueta) no arma tabla.
    const toca = (a, b) => a !== b && a.bb[0] <= b.bb[2] + 1.5 && b.bb[0] <= a.bb[2] + 1.5 && a.bb[1] <= b.bb[3] + 1.5 && b.bb[1] <= a.bb[3] + 1.5;
    for (const k of cajas) { if (!cajas.some(o => toca(k, o))) { k.suelta = true; continue; } const r = k.bb;
      lineas.push({o: 'h', p: r[1], a: r[0], b: r[2], w: 0, c: null}, {o: 'h', p: r[3], a: r[0], b: r[2], w: 0, c: null},
        {o: 'v', p: r[0], a: r[1], b: r[3], w: 0, c: null}, {o: 'v', p: r[2], a: r[1], b: r[3], w: 0, c: null}); }
    // subrayados: línea corta justo bajo un texto → se marca el texto y se quita la línea
    for (let i = lineas.length - 1; i >= 0; i--) {
      const l = lineas[i]; if (l.o !== 'h' || l.b - l.a > W * 0.9 || !l.c || esBlanco(l.c)) continue;
      const t = textos.find(t => l.p >= t.y - 0.5 && l.p <= t.y + t.sz * 0.3 && l.a >= t.x - 2 && l.b <= t.x + t.len + 2);
      if (t) { t.sub = true; lineas.splice(i, 1); }
    }
    // líneas de la misma recta que se tocan → una sola
    const unir = o => { const L = lineas.filter(l => l.o === o).sort((x, y) => x.p - y.p || x.a - y.a); const out = [];
      for (const l of L) { const cat = c => c == null ? 'v' : esBlanco(c) ? 'w' : 'c';
        const u = out.find(m => Math.abs(m.p - l.p) < 1 && l.a <= m.b + 1.5 && l.b >= m.a - 1.5 && (cat(m.c) === cat(l.c) || cat(m.c) === 'v' || cat(l.c) === 'v'));
        if (u) { u.a = Math.min(u.a, l.a); u.b = Math.max(u.b, l.b); if (u.c == null || (cat(u.c) === 'w' && l.c != null && cat(l.c) === 'c')) { if (l.c != null) { u.c = l.c; u.w = l.w; } } else if (l.c != null) u.w = Math.max(u.w, l.w); } else out.push(Object.assign({}, l)); }
      return out.filter(l => l.b - l.a > 1); };
    const LH = unir('h'), LV = unir('v');

    // ---------- tablas: grupos de líneas horizontales y verticales que se cruzan
    const todas = [...LH, ...LV]; const padre = todas.map((_, i) => i);
    const raiz = i => padre[i] === i ? i : (padre[i] = raiz(padre[i]));
    for (let i = 0; i < LH.length; i++) for (let j = 0; j < LV.length; j++) {
      const h = LH[i], v = LV[j];
      if (v.p >= h.a - 2 && v.p <= h.b + 2 && h.p >= v.a - 2 && h.p <= v.b + 2) padre[raiz(i)] = raiz(LH.length + j);
    }
    const grupos = new Map(); todas.forEach((l, i) => { const r = raiz(i); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(l); });
    const tablas = []; const usadas = new Set();
    const bbDe = g => [Math.min(...g.map(l => l.o === 'h' ? l.a : l.p)), Math.min(...g.map(l => l.o === 'h' ? l.p : l.a)), Math.max(...g.map(l => l.o === 'h' ? l.b : l.p)), Math.max(...g.map(l => l.o === 'h' ? l.p : l.b))];
    // grupos que se superponen (p. ej. celdas pintadas del encabezado sobre la cuadrícula) forman una sola tabla
    let GS = [...grupos.values()].map(g => ({g, bb: bbDe(g)}));
    for (let i = 0; i < GS.length; i++) for (let j = i + 1; j < GS.length; j++) {
      const a = GS[i].bb, b = GS[j].bb; const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      const menor = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
      if (ix > 2 && iy > 2 && ix * iy > 0.5 * menor) { GS[i] = {g: GS[i].g.concat(GS[j].g)}; GS[i].bb = bbDe(GS[i].g); GS.splice(j, 1); j = i; }
    }
    for (const {g, bb} of GS) {
      const hs = g.filter(l => l.o === 'h'), vs = g.filter(l => l.o === 'v');
      if (hs.length < 2 || vs.length < 2) continue;
      if (bb[2] - bb[0] < 20 || bb[3] - bb[1] < 8) continue;
      const T = tabla(hs, vs, bb); if (!T) continue;
      tablas.push(T); g.forEach(l => usadas.add(l));
    }
    function cortes(vals) { vals.sort((a, b) => a - b); const o = []; for (const v of vals) if (!o.length || v - o[o.length - 1] > 4) o.push(v); return o; }
    function tabla(hs, vs, bb) {
      hs = hs.slice().sort((a, b) => (b.c ? 1 : 0) - (a.c ? 1 : 0)); vs = vs.slice().sort((a, b) => (b.c ? 1 : 0) - (a.c ? 1 : 0));
      const xs = cortes([bb[0], bb[2], ...vs.map(v => v.p)]), ys = cortes([bb[1], bb[3], ...hs.map(h => h.p)]);
      const nc = xs.length - 1, nf = ys.length - 1; if (nc < 1 || nf < 1) return null;
      const hayV = (x, y0, y1) => { const m = (y0 + y1) / 2; return vs.find(v => Math.abs(v.p - x) < 4 && v.a <= m + 0.5 && v.b >= m - 0.5); };
      const hayH = (y, x0, x1) => { const m = (x0 + x1) / 2; return hs.find(h => Math.abs(h.p - y) < 4 && h.a <= m + 0.5 && h.b >= m - 0.5); };
      const tomada = []; for (let f = 0; f < nf; f++) tomada.push(new Array(nc).fill(false));
      const celdas = [];
      for (let f = 0; f < nf; f++) for (let c = 0; c < nc; c++) {
        if (tomada[f][c]) continue;
        let cs = 1; while (c + cs < nc && !hayV(xs[c + cs], ys[f], ys[f + 1])) cs++;
        let rs = 1; while (f + rs < nf && !hayH(ys[f + rs], xs[c], xs[c + cs])) rs++;
        for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) tomada[f + a][c + b] = true;
        const cb = [xs[c], ys[f], xs[c + cs], ys[f + rs]];
        celdas.push({f, c, cs, rs, bb: cb, textos: [], imgs: [], bordes: {t: hayH(cb[1], cb[0], cb[2]), b: hayH(cb[3], cb[0], cb[2]), l: hayV(cb[0], cb[1], cb[3]), r: hayV(cb[2], cb[1], cb[3])}});
      }
      return {bb, xs, ys, nf, nc, celdas};
    }
    // contenido de cada celda (por el centro de cada texto o imagen) y su fondo
    const libres = [];
    for (const t of textos) {
      const cx = (t.bb[0] + t.bb[2]) / 2, cy = (t.bb[1] + t.bb[3]) / 2; let ok = false;
      for (const T of tablas) if (dentro(cx, cy, T.bb)) { const c = T.celdas.find(c => dentro(cx, cy, c.bb, 0.5)); if (c) { c.textos.push(t); ok = true; break; } }
      if (!ok) libres.push(t);
    }
    const imgsLibres = [];
    for (const im of imgs) {
      const cx = (im.bb[0] + im.bb[2]) / 2, cy = (im.bb[1] + im.bb[3]) / 2; let ok = false;
      for (const T of tablas) if (dentro(cx, cy, T.bb)) { const c = T.celdas.find(c => dentro(cx, cy, c.bb, 0.5)); if (c) { c.imgs.push(im); ok = true; break; } }
      if (!ok) imgsLibres.push(im);
    }
    const cajasLibres = [];
    for (const k of cajas) {
      let ok = false;
      for (const T of tablas) if (dentro(k.bb[0], k.bb[1], T.bb, 1.5) && dentro(k.bb[2], k.bb[3], T.bb, 1.5)) {
        for (const c of T.celdas) { const ix = Math.min(c.bb[2], k.bb[2]) - Math.max(c.bb[0], k.bb[0]), iy = Math.min(c.bb[3], k.bb[3]) - Math.max(c.bb[1], k.bb[1]);
          if (ix > 0 && iy > 0 && ix * iy > 0.6 * (c.bb[2] - c.bb[0]) * (c.bb[3] - c.bb[1])) c.fondo = k.c; }
        ok = true; break; }
      if (!ok) cajasLibres.push(k);
    }
    // las cajas de color sin líneas pero con varias celdas de texto alineadas no se intentan como tabla: van por posición

    // ---------- bloques de la página
    const bloques = [];
    for (const im of imgsLibres) bloques.push({bb: im.bb, html: imgHtml(im), tipo: 'img'});
    for (const l of LH) if (!usadas.has(l) && l.b - l.a > 15 && l.c && !esBlanco(l.c)) bloques.push({bb: [l.a, l.p - l.w / 2, l.b, l.p + l.w / 2], html: '<hr style="width:' + px(l.b - l.a) + ';border-top:' + px(Math.max(l.w, 0.7)) + ' solid ' + l.c + '">', tipo: 'hr'});
    const sueltas = [...LV.filter(l => !usadas.has(l) && l.b - l.a > 2), ...LH.filter(l => !usadas.has(l) && l.b - l.a <= 15)].filter(l => l.c && !esBlanco(l.c));
    for (const l of sueltas) dibujos.push({bb: l.o === 'v' ? [l.p - l.w / 2, l.a, l.p + l.w / 2, l.b] : [l.a, l.p - l.w / 2, l.b, l.p + l.w / 2], svg: '<path d="M' + (l.o === 'v' ? r1(l.p) + ' ' + r1(l.a) + 'V' + r1(l.b) : r1(l.a) + ' ' + r1(l.p) + 'H' + r1(l.b)) + '" stroke="' + l.c + '" stroke-width="' + r2(l.w) + '" fill="none"/>'});
    for (const k of cajasLibres) bloques.push({bb: k.bb, html: '<div class="caja" style="width:' + px(k.bb[2] - k.bb[0]) + ';height:' + px(k.bb[3] - k.bb[1]) + ';background:' + k.c + (k.borde ? ';outline:' + px(k.borde.w) + ' solid ' + k.borde.c : '') + '"></div>', tipo: 'caja'});
    // dibujos: se agrupan los que se tocan y cada grupo es un SVG pequeño
    const dg = []; const vistos = new Set();
    for (const d of dibujos) {
      if (d.dedup) { if (vistos.has(d.dedup)) continue; vistos.add(d.dedup); }
      const tol = d.txt ? 0.5 : -2; const g = dg.find(g => (d.txt ? g.txt : !g.txt) && solapaX(g.bb, d.bb, tol) && solapaY(g.bb, d.bb, tol));
      if (g) { g.items.push(d); g.bb = [Math.min(g.bb[0], d.bb[0]), Math.min(g.bb[1], d.bb[1]), Math.max(g.bb[2], d.bb[2]), Math.max(g.bb[3], d.bb[3])]; } else dg.push({bb: d.bb.slice(), items: [d], txt: !!d.txt});
    }
    for (const g of dg) { const b = [g.bb[0] - 1, g.bb[1] - 1, g.bb[2] + 1, g.bb[3] + 1]; const w = b[2] - b[0], h = b[3] - b[1]; if (w < 0.5 || h < 0.5) continue;
      const svgG = '<svg class="dib" viewBox="' + [b[0], b[1], w, h].map(r1).join(' ') + '" width="' + r1(w) + '" height="' + r1(h) + '">' + g.items.map(d => d.svg).join('') + '</svg>';
      // dibujo o texto girado dentro de una celda: va en la celda
      const mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2; let celda = null;
      for (const T of tablas) if (dentro(mx, my, T.bb)) { celda = T.celdas.find(c => dentro(mx, my, c.bb, 0.5)); if (celda) break; }
      if (celda) { celda.extra = (celda.extra || []).concat({bb: b, html: svgG.replace('class="dib"', 'class="dib" style="margin:0 auto"'), tipo: 'img'}); continue; }
      bloques.push({bb: b, html: '<svg class="dib" viewBox="' + [b[0], b[1], w, h].map(r1).join(' ') + '" width="' + r1(w) + '" height="' + r1(h) + '">' + g.items.map(d => d.svg).join('') + '</svg>', tipo: 'dib'}); }
    // texto libre → líneas → párrafos
    for (const p of parrafos(libres, null)) bloques.push(p);
    for (const T of tablas) bloques.push({bb: T.bb, html: tablaHtml(T), tipo: 'tabla'});

    // ---------- orden de lectura: de arriba abajo; lo que comparte altura con otra cosa al costado se coloca por posición
    bloques.sort((a, b) => a.bb[1] - b.bb[1] || a.bb[0] - b.bb[0]);
    const filas = [];
    for (const b of bloques) {
      const f = filas.find(f => solapaY(f.bb, b.bb, 1.5));
      if (f) { f.items.push(b); f.bb = [Math.min(f.bb[0], b.bb[0]), Math.min(f.bb[1], b.bb[1]), Math.max(f.bb[2], b.bb[2]), Math.max(f.bb[3], b.bb[3])]; }
      else filas.push({bb: b.bb.slice(), items: [b]});
    }
    // una fila puede haber crecido y tocar otra: se vuelven a unir
    for (let i = 0; i < filas.length; i++) for (let j = i + 1; j < filas.length; j++) if (solapaY(filas[i].bb, filas[j].bb, 1.5)) {
      filas[i].items.push(...filas[j].items); filas[i].bb = [Math.min(filas[i].bb[0], filas[j].bb[0]), Math.min(filas[i].bb[1], filas[j].bb[1]), Math.max(filas[i].bb[2], filas[j].bb[2]), Math.max(filas[i].bb[3], filas[j].bb[3])];
      filas.splice(j, 1); j = i; }
    filas.sort((a, b) => a.bb[1] - b.bb[1]);
    const xsMin = bloques.length ? Math.min(...bloques.map(b => b.bb[0])) : 40;
    const margen = Math.max(12, Math.min(xsMin, W * 0.16)); let y = 0, html = '';
    for (const f of filas) {
      const sep = Math.max(0, f.bb[1] - y);
      if (f.items.length === 1) { const b = f.items[0];
        html += '<div class="bl" style="margin:' + px(sep) + ' 0 0 ' + px(b.bb[0] - margen) + (b.tipo === 'p' && b.ancho ? ';max-width:' + px(b.ancho) : '') + '">' + b.html + '</div>'; }
      else {
        const ord = f.items.sort((a, b) => (a.tipo === 'caja' ? 0 : 1) - (b.tipo === 'caja' ? 0 : 1) || a.bb[1] - b.bb[1]);
        html += '<div class="pos" style="margin-top:' + px(sep) + ';height:' + px(f.bb[3] - f.bb[1]) + '">' + ord.map(b0 => { const b = b0.propio ? Object.assign({}, b0, {bb: b0.propio}) : b0; return '<div style="left:' + px(b.bb[0] - margen - (b.tipo === 'p' ? 3 : 0)) + ';top:' + px(b.bb[1] - f.bb[1]) +
          (b.tipo === 'p' ? ';width:' + px((b.bb[2] - b.bb[0]) * 1.04 + 6) + (b.multi ? ';white-space:normal' : '') : '') + '">' + b.html + '</div>'; }).join('') + '</div>';
      }
      y = f.bb[3];
    }
    return '<div class="pag real" style="width:' + px(W) + ';min-height:' + px(H * 0.25) + ';padding:0 ' + px(margen) + ' ' + px(Math.max(12, H - y)) + ' ' + px(margen) + '">' + html + '</div>';

    // ---------- tabla → <table>
    function tablaHtml(T) {
      const ancho = T.bb[2] - T.bb[0];
      let h = '<table class="t" style="width:' + px(ancho) + '"><colgroup>' + T.xs.slice(1).map((x, i) => '<col style="width:' + r2((x - T.xs[i]) / ancho * 100) + '%">').join('') + '</colgroup>';
      for (let f = 0; f < T.nf; f++) {
        h += '<tr style="height:' + px(T.ys[f + 1] - T.ys[f]) + '">';
        for (const c of T.celdas.filter(c => c.f === f)) {
          const bd = k => c.bordes[k] && c.bordes[k].c ? px(Math.max(c.bordes[k].w, 0.7)) + ' solid ' + c.bordes[k].c : 'none';
          const st = ['border-top:' + bd('t'), 'border-bottom:' + bd('b'), 'border-left:' + bd('l'), 'border-right:' + bd('r')];
          if (c.fondo) st.push('background:' + c.fondo);
          const ps = parrafos(c.textos, c.bb);
          if (ps.length) { const top = Math.min(...ps.map(p => p.bb[1])) - c.bb[1], bot = c.bb[3] - Math.max(...ps.map(p => p.bb[3]));
            const tol = Math.max(3, (c.bb[3] - c.bb[1]) * 0.18);
            if (Math.abs(top - bot) < tol && top > 2) st.push('vertical-align:middle'); else if (bot < top - tol) st.push('vertical-align:bottom'); }
          let cont = '', yy = c.bb[1] + 1.5;
          const items = [...ps, ...(c.extra || []), ...c.imgs.map(im => ({bb: im.bb, html: imgHtml(im), tipo: 'img'}))].sort((a, b) => a.bb[1] - b.bb[1]);
          for (const p of items) { const m = Math.max(0, p.bb[1] - yy); cont += '<div' + (m > 3 && cont ? ' style="margin-top:' + px(m) + '"' : '') + '>' + p.html + '</div>'; yy = p.bb[3]; }
          h += '<td' + (c.cs > 1 ? ' colspan="' + c.cs + '"' : '') + (c.rs > 1 ? ' rowspan="' + c.rs + '"' : '') + ' class="' + clase(st.join(';')) + '">' + cont + '</td>';
        }
        h += '</tr>';
      }
      return h + '</table>';
    }
  }

  const imgHtml = im => '<svg class="im" viewBox="0 0 1 1" preserveAspectRatio="none" width="' + r1(im.bb[2] - im.bb[0]) + '" height="' + r1(im.bb[3] - im.bb[1]) + '" role="img"><use href="#' + im.id + '"/></svg>';
  function textoSvg(e) {
    return '<text class="' + e.cls + '" x="' + e.x + '" y="' + e.y + '" font-size="' + e.sz + '"' + (e.col !== '#000000' ? ' fill="' + e.col + '"' : '') +
      (e.s.length > 1 && e.len > 0 ? ' textLength="' + e.len + '" lengthAdjust="spacingAndGlyphs"' : '') + (e.ang ? ' transform="rotate(' + e.ang + ' ' + e.x + ' ' + e.y + ')"' : '') + '>' + escX(e.s) + '</text>';
  }

  // ---------- textos → líneas → párrafos (en la página o dentro de una celda: caja = límites de la celda)
  function parrafos(items, caja) {
    if (!items.length) return [];
    const its = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const lns = [];
    for (const t of its) {
      // el renglón con la altura más cercana (una viñeta de otra fuente suele estar algo más arriba o abajo)
      let l = null, dmin = 1e9; for (let k = lns.length - 1; k >= 0 && k >= lns.length - 4; k--) { const m = lns[k]; const dy = Math.abs(m.y - t.y); if (dy < Math.max(m.sz, t.sz) * 0.38 && dy < dmin) { l = m; dmin = dy; } }
      if (!l) { l = {y: t.y, sz: t.sz, its: []}; lns.push(l); }
      l.its.push(t); if (t.sz > l.sz) { l.sz = t.sz; l.y = t.y; }
    }
    for (const l of lns) {
      l.its.sort((a, b) => a.x - b.x); l.segs = [];
      for (const t of l.its) { const s = l.segs[l.segs.length - 1];
        if (s && t.x - s.x1 < Math.max(l.sz * 1.6, 8)) { s.its.push(t); s.x1 = Math.max(s.x1, t.x + t.len); } else l.segs.push({x0: t.x, x1: t.x + t.len, its: [t]}); }
      // viñeta o número de lista separado de su texto por una tabulación: un solo elemento de lista
      const i0 = l.segs[0].its[0], i1 = l.segs[0].its[1];
      // viñeta como texto aparte dentro del mismo tramo («•» y, a cierta distancia, el texto)
      if (i1 && /^[•▪◦●■◆►✓\-–·o\uf0b7\uf0a7\uf076\uf0d8\uf0fc]$/.test(i0.s.trim()) && i1.x - (i0.x + i0.len) > i0.sz * 0.5) {
        l.vin = {txt: i0.s.trim().replace(/^[\uf0b7\uf0a7\uf076\uf0d8\uf0fc]$/, '•'), x: i0.x, cls: i0.cls, col: i0.col};
        l.segs[0] = {x0: i1.x, x1: l.segs[0].x1, its: l.segs[0].its.slice(1)};
      }
      const s0 = l.segs[0].its.map(t => t.s).join('').trim();
      if (!l.vin && l.segs.length > 1 && /^([•▪◦●■◆►✓\-–·o\uf0b7\uf0a7\uf076\uf0d8\uf0fc]|\d{1,2}[.)]|[a-zA-Z][.)]|\d+(\.\d+)+\.?)$/.test(s0)) {
        l.vin = {txt: s0.replace(/^[\uf0b7\uf0a7\uf076\uf0d8\uf0fc]$/, '•'), x: l.segs[0].x0, cls: l.segs[0].its[0].cls, col: l.segs[0].its[0].col};
        l.segs = l.segs.slice(1); if (l.segs.length > 1) l.segs = [{x0: l.segs[0].x0, x1: l.segs[l.segs.length - 1].x1, its: l.segs.flatMap(s => s.its)}];
      }
      l.x0 = l.segs[0].x0; l.x1 = Math.max(...l.segs.map(s => s.x1));
    }
    lns.sort((a, b) => a.y - b.y);
    const izq = caja ? caja[0] : Math.min(...lns.map(l => l.x0)), der = caja ? caja[2] : Math.max(...lns.map(l => l.x1)), centro = (izq + der) / 2;
    // margen derecho real: el borde que comparten más renglones largos (el texto justificado termina ahí)
    const largos = lns.filter(l => l.x1 - l.x0 > (der - izq) * 0.55); const cuenta = new Map();
    for (const l of largos) { const k = Math.round(l.x1 / 3); cuenta.set(k, (cuenta.get(k) || 0) + 1); }
    const moda = [...cuenta].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    let derLin = moda && moda[1] >= 2 ? moda[0] * 3 : Math.max(...lns.map(l => l.x1));
    if (caja) derLin = Math.min(caja[2] - 2, derLin);
    const out = []; let P = null;
    const viñeta = s => /^\s*([•●▪■◦○\-–—]|\d{1,2}[.)]|[a-z][.)])(\s|$)/.test(s);
    const cerrar = () => {
      if (!P) return; const L = P.lineas;
      const xs0 = L.map(l => l.x0), xs1 = L.map(l => l.x1), cs = L.map(l => (l.x0 + l.x1) / 2);
      const rango = v => Math.max(...v) - Math.min(...v); let bz = null; const base0 = () => bz || (bz = estiloBase(L));
      let al = 'left';
      const tc = Math.max(3, base0().sz * 0.45);
      if (L.length > 1) { if (!L[0].vin && rango(cs) < tc && rango(xs0) > tc) al = 'center'; else if (rango(xs1) < 3 && rango(xs0) > 3) al = 'right'; else if (L.length > 2 && rango(xs0.slice(1)) < 3 && rango(xs1.slice(0, -1)) < 3) al = 'justify'; }
      else { const l = L[0]; if (!l.vin && (caja || l.x1 - l.x0 < (der - izq) * 0.85) && Math.abs((l.x0 + l.x1) / 2 - centro) < (caja ? Math.max(3, l.sz * 0.35) : 4) && l.x0 > izq + (caja ? 3 : 15)) al = 'center'; else if (Math.abs(l.x1 - der) < (caja ? 3 : 4) && l.x0 > izq + (der - izq) * 0.3) al = 'right'; }
      const x0 = Math.min(...xs0), x1 = Math.max(...xs1);
      const base = base0();
      const paso = L.length > 1 ? (L[L.length - 1].y - L[0].y) / (L.length - 1) : base.sz * 1.2;
      const lh = Math.max(1, Math.min(2.2, paso / base.sz));
      const sangria = L.length > 1 && al !== 'center' && xs0[0] - Math.min(...xs0.slice(1)) > 3 ? xs0[0] - Math.min(...xs0.slice(1)) : 0;
      let txt = '';
      L.forEach((l, i) => { if (i) { const prev = txt.replace(/<[^>]+>/g, ''); txt += al === 'center' || al === 'right' ? '<br>' : /[-‐]$/.test(prev) && /^[a-záéíóúñ]/.test(l.segs[0].its[0].s) ? '' : ' '; } txt += lineaHtml(l, base); });
      const st = ['font-size:' + px(base.sz), 'line-height:' + r2(lh)]; if (base.col !== '#000000') st.push('color:' + base.col);
      if (al !== 'left') st.push('text-align:' + al); if (sangria) st.push('text-indent:' + px(sangria)); if (L.length === 1 && !caja) st.push('white-space:nowrap');
      if (caja && al === 'left' && x0 - caja[0] > 8 && x0 - caja[0] < (caja[2] - caja[0]) * 0.35) st.push('padding-left:' + px(x0 - caja[0] - 3));
      const vin = L[0].vin; let x0v = x0;
      if (vin) { const sep = Math.max(4, L[0].x0 - vin.x); x0v = vin.x;
        txt = '<span class="vi" style="width:' + px(sep) + (vin.cls !== base.cls ? '' : '') + '">' + escX(vin.txt) + '</span>' + txt;
        const k = st.findIndex(z => z.startsWith('text-indent')); if (k >= 0) st.splice(k, 1);
        st.push('padding-left:' + px(sep), 'text-indent:' + px(-sep)); if (al === 'justify' || al === 'left') {} }
      const top = L[0].y - base.sz * (0.5 + lh / 2) + base.sz * 0.15, bot = L[L.length - 1].y + base.sz * (lh / 2 - 0.35);
      out.push({bb: [al === 'center' && !caja ? Math.min(x0v, izq) : x0v, top, al === 'center' && !caja ? Math.max(x1, der) : x1, bot], propio: [x0v, top, x1, bot], tipo: 'p',
        ancho: L.length > 1 && al !== 'center' ? x1 - x0v + base.sz * 1.5 : 0,
        multi: L.length > 1, html: '<p class="' + base.cls + ' ' + clase(st.join(';')) + '">' + txt + '</p>'});
      P = null;
    };
    for (const l of lns) {
      if (l.segs.length > 1 && !caja && !l.vin) {           // línea con columnas separadas (p. ej. «REFERENCIA ……  CUI N°…»): cada parte por su lado
        cerrar();
        for (const s of l.segs) { const sub = {y: l.y, sz: l.sz, segs: [s], x0: s.x0, x1: s.x1, its: s.its}; P = {lineas: [sub]}; cerrar(); }
        continue;
      }
      if (l.segs.length > 1) { const s0 = l.segs; l.segs = [{x0: s0[0].x0, x1: s0[s0.length - 1].x1, its: s0.flatMap(s => s.its), hueco: true}]; }
      const u = P && P.lineas[P.lineas.length - 1];
      // un renglón que no llega al margen derecho cierra su párrafo (en Word, el que continúa llena el ancho);
      // los renglones con puntos guía (índices) van siempre solos
      const txtL = x => x.segs.map(sg => sg.its.map(t => t.s).join(' ')).join(' ');
      const guia = x => /(\.\s?){5,}|…{2,}|_{5,}/.test(txtL(x));
      const centrada = u && Math.abs((l.x0 + l.x1) / 2 - (u.x0 + u.x1) / 2) < Math.max(3, u.sz * 0.45) && Math.abs(l.x0 - u.x0) > 3;
      const llena = u && (u.x1 >= derLin - Math.max(u.sz * 2.2, 10) || centrada);
      const sigue = u && llena && !guia(u) && !guia(l) && !l.vin && Math.abs(l.sz - u.sz) <= Math.max(0.8, u.sz * 0.12) && l.y - u.y <= u.sz * (caja ? 2.4 : 1.75) && l.y - u.y >= u.sz * 0.7 &&
        !viñeta(l.segs[0].its[0].s) && (Math.abs(l.x0 - u.x0) < 3 || (llena && !centrada && Math.abs(l.x0 - u.x0) < u.sz * 0.9) || Math.abs((l.x0 + l.x1) / 2 - (u.x0 + u.x1) / 2) < Math.max(3, u.sz * 0.45) || (P.lineas.length === 1 && u.x0 - l.x0 > 3 && u.x0 - l.x0 < 60) || (P.lineas.length > 1 && Math.abs(l.x0 - P.lineas[1].x0) < 3)) &&
        estiloBase([l]).cls === estiloBase([u]).cls;
      if (sigue) P.lineas.push(l); else { cerrar(); P = {lineas: [l]}; }
    }
    cerrar();
    return out;
  }
  function estiloBase(L) {
    const peso = new Map();
    for (const l of L) for (const s of l.segs) for (const t of s.its) { const k = t.cls + '|' + t.col + '|' + t.sz; peso.set(k, (peso.get(k) || 0) + t.s.length); }
    const [k] = [...peso].sort((a, b) => b[1] - a[1])[0]; const [cls, col, sz] = k.split('|');
    return {cls, col, sz: +sz};
  }
  function lineaHtml(l, base) {
    let h = ''; let prev = null;
    for (const s of l.segs) for (const t of s.its) {
      if (prev) { const gap = t.x - (prev.x + prev.len); if (gap > t.sz * 0.15 && !/\s$/.test(prev.s) && !/^\s/.test(t.s)) h += gap > t.sz * 2.5 ? '&emsp;' : ' '; }
      let txt = escX(t.s);
      const st = []; const nat = t.s.length > 1 ? ancho(t.cls, t.sz, t.s) : 0;
      if (nat && t.len > 0 && (nat > t.len * 1.03 || nat < t.len * 0.8)) st.push('letter-spacing:' + r2((t.len - nat) / t.s.length) + 'px');
      if (t.cls !== base.cls) txt = '<span class="' + t.cls + '">' + txt + '</span>';
      if (t.col !== base.col) st.push('color:' + (colorHex(t.col) || 'transparent'));
      const sup = t.sz < base.sz * 0.8 && t.y < l.y - base.sz * 0.15;
      if (!sup && Math.abs(t.sz - base.sz) > 0.6) st.push('font-size:' + px(t.sz));
      if (t.sub) st.push('text-decoration:underline');
      if (st.length) txt = '<span style="' + st.join(';') + '">' + txt + '</span>';
      if (sup) txt = '<sup style="font-size:' + px(t.sz) + '">' + txt + '</sup>';
      h += txt; prev = t;
    }
    return h;
  }

  async function pdfAHtml(u8, titulo, alAvanzar) {
    iniciar();
    const doc = await pdfjsLib.getDocument({data: u8.slice(), isEvalSupported: false, isOffscreenCanvasSupported: false, disableFontFace: true, fontExtraProperties: false, verbosity: 0}).promise;
    const fuentes = new Map(), imgCache = new Map(); imgCache.urls = new Map(); ESTILOS = new Map(); let html = ''; const textos = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i); const R = await pagina(pg, fuentes, imgCache);
      html += R.html.replace('</div>', '<span class="npag">' + i + ' / ' + doc.numPages + '</span></div>'); textos.push(R.texto); pg.cleanup();
      if (alAvanzar) alAvanzar(i, doc.numPages);
    }
    await doc.destroy();
    const css = [...fuentes.values()].map(f => '.f' + f.n + '{' + f.css + '}').join('') + [...ESTILOS].map(([c, n]) => '.' + n + '{' + c + '}').join('');
    const page = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + escX(titulo || '') + '</title><style>' +
      'body{margin:0;background:#e3e6ec;padding:24px 12px}.pag{position:relative;margin:0 auto 24px;background:#fff;box-shadow:0 1px 6px #0003;overflow:hidden}' +
      '.pag svg{display:block}text{white-space:pre}' +
      '.pag.real{box-sizing:border-box;height:auto;overflow:visible;color:#000}.real p{margin:0;overflow-wrap:break-word}.real sup{line-height:0}.real .vi{display:inline-block;text-indent:0}' +
      '.real .bl{position:relative}.real .pos{position:relative}.real .pos>div{position:absolute}.real .pos>div{white-space:nowrap}' +
      '.real hr{margin:0;border:0;height:0}.real .im,.real .dib{display:block;overflow:visible}.real .caja{box-sizing:border-box}' +
      '.real table.t{white-space:normal;border-collapse:collapse;table-layout:fixed;max-width:100%}.real td{padding:1px;vertical-align:top;overflow-wrap:break-word}.real td>div>.im{display:inline-block}' +
      '.npag{position:absolute;right:10px;bottom:6px;font:11px Figtree,sans-serif;color:#9aa1ae}' +
      '@media print{body{background:#fff;padding:0}.pag{box-shadow:none;margin:0;page-break-after:always}.npag{display:none}}' + css +
      '</style></head><body>' + (imgCache.urls.size ? '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
        [...imgCache.urls].map(([u, id]) => '<image id="' + id + '" width="1" height="1" preserveAspectRatio="none" href="' + u + '"/>').join('') + '</defs></svg>' : '') + html + '</body></html>';
    return {page, texto: textos.join(' '), paginas: doc.numPages};
  }
  return {pdfAHtml};
})();
