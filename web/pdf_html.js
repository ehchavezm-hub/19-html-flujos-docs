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
    endPath: 28, beginText: 31, setCharSpacing: 33, setWordSpacing: 34, setHScale: 35, setLeading: 36, setFont: 37, setTextRenderingMode: 38, setTextRise: 39,
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
    const P = (x, y) => { const p = ap(st.ctm, x, y); return r1(p[0]) + ' ' + r1(p[1]); };
    const escala = () => Math.sqrt(Math.abs(st.ctm[0] * st.ctm[3] - st.ctm[1] * st.ctm[2])) || 1;
    function emitirRuta(fill, stroke, eo) {
      if (!ruta) return; const d = ruta; ruta = '';
      if (fill && !st.fill) fill = false; if (!fill && !stroke) return;
      let a = 'fill="' + (fill ? st.fill : 'none') + '"' + (fill && eo ? ' fill-rule="evenodd"' : '') + (fill && st.fa < 1 ? ' fill-opacity="' + r2(st.fa) + '"' : '');
      if (stroke) { const w = Math.max(st.lw * escala(), 0.5);
        a += ' stroke="' + st.stroke + '" stroke-width="' + r2(w) + '"' + (st.sa < 1 ? ' stroke-opacity="' + r2(st.sa) + '"' : '') +
          (st.dash && st.dash.length ? ' stroke-dasharray="' + st.dash.map(v => r2(v * escala())).join(' ') + '"' : ''); }
      const prev = els[els.length - 1];                    // unir trazos seguidos con el mismo estilo (bordes de tablas)
      if (prev && prev.t === 'p' && prev.a === a) prev.d += ' ' + d; else els.push({t: 'p', a, d});
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
        const txt = s.s.replace(/\s+$/, '');
        els.push({t: 't', cls, sz: r1(sz), x: r1(a[0]), y: r1(a[1]), ang: Math.abs(ang) < 0.3 ? 0 : r1(ang), len: r1(len * (txt.length / Math.max(s.s.length, 1))), s: txt,
          col: color, op: st.fa < 1 ? st.fa : 1});
        textoPag.push(txt);
      }
    }
    async function imagen(d, mascara) {
      let u = null; if (d && d._id && imgCache.has(d._id)) u = imgCache.get(d._id); else { try { u = await imagenUrl(d); } catch (e) { u = null; } if (d && d._id) imgCache.set(d._id, u); }
      if (!u) return; const m = mul(st.ctm, [1, 0, 0, -1, 0, 1]);
      // la misma imagen (logos del encabezado en cada página) se guarda una sola vez y se reutiliza con <use>
      if (!imgCache.urls.has(u)) imgCache.urls.set(u, 'im' + imgCache.urls.size);
      els.push({t: 'i', h: '<use href="#' + imgCache.urls.get(u) + '" transform="matrix(' + m.map(v => +v.toFixed(4)).join(' ') + ')"' + (st.fa < 1 ? ' opacity="' + r2(st.fa) + '"' : '') + '/>'});
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
            if (op === OPS.rectangle) { const x = c[j++], y = c[j++], w = c[j++], h = c[j++]; ruta += 'M' + P(x, y) + 'L' + P(x + w, y) + 'L' + P(x + w, y + h) + 'L' + P(x, y + h) + 'Z'; cx = x; cy = y; }
            else if (op === OPS.moveTo) { cx = c[j++]; cy = c[j++]; ruta += 'M' + P(cx, cy); }
            else if (op === OPS.lineTo) { cx = c[j++]; cy = c[j++]; ruta += 'L' + P(cx, cy); }
            else if (op === OPS.curveTo) { ruta += 'C' + P(c[j], c[j + 1]) + ' ' + P(c[j + 2], c[j + 3]) + ' ' + P(c[j + 4], c[j + 5]); cx = c[j + 4]; cy = c[j + 5]; j += 6; }
            else if (op === OPS.curveTo2) { ruta += 'C' + P(cx, cy) + ' ' + P(c[j], c[j + 1]) + ' ' + P(c[j + 2], c[j + 3]); cx = c[j + 2]; cy = c[j + 3]; j += 4; }
            else if (op === OPS.curveTo3) { ruta += 'C' + P(c[j], c[j + 1]) + ' ' + P(c[j + 2], c[j + 3]) + ' ' + P(c[j + 2], c[j + 3]); cx = c[j + 2]; cy = c[j + 3]; j += 4; }
            else if (op === OPS.closePath) ruta += 'Z';
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
        case OPS.endPath: ruta = ''; break;
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
    return {html: '<div class="pag" style="width:' + r1(W) + 'px;height:' + r1(H) + 'px"><svg viewBox="0 0 ' + r1(W) + ' ' + r1(H) + '" width="' + r1(W) + '" height="' + r1(H) + '">' + svg + '</svg></div>', texto: textoPag.join(' ')};
  }

  async function pdfAHtml(u8, titulo, alAvanzar) {
    iniciar();
    const doc = await pdfjsLib.getDocument({data: u8.slice(), isEvalSupported: false, isOffscreenCanvasSupported: false, disableFontFace: true, fontExtraProperties: false, verbosity: 0}).promise;
    const fuentes = new Map(), imgCache = new Map(); imgCache.urls = new Map(); let html = ''; const textos = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i); const R = await pagina(pg, fuentes, imgCache);
      html += R.html.replace('</div>', '<span class="npag">' + i + ' / ' + doc.numPages + '</span></div>'); textos.push(R.texto); pg.cleanup();
      if (alAvanzar) alAvanzar(i, doc.numPages);
    }
    await doc.destroy();
    const css = [...fuentes.values()].map(f => '.f' + f.n + '{' + f.css + '}').join('');
    const page = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + escX(titulo || '') + '</title><style>' +
      'body{margin:0;background:#e3e6ec;padding:24px 12px}.pag{position:relative;margin:0 auto 24px;background:#fff;box-shadow:0 1px 6px #0003;overflow:hidden}' +
      '.pag svg{display:block}text{white-space:pre}.npag{position:absolute;right:10px;bottom:6px;font:11px Figtree,sans-serif;color:#9aa1ae}' +
      '@media print{body{background:#fff;padding:0}.pag{box-shadow:none;margin:0;page-break-after:always}.npag{display:none}}' + css +
      '</style></head><body>' + (imgCache.urls.size ? '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
        [...imgCache.urls].map(([u, id]) => '<image id="' + id + '" width="1" height="1" preserveAspectRatio="none" href="' + u + '"/>').join('') + '</defs></svg>' : '') + html + '</body></html>';
    return {page, texto: textos.join(' '), paginas: doc.numPages};
  }
  return {pdfAHtml};
})();
