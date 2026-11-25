/* Generador de portal de documentos · se ejecuta en el navegador (Edge/Chrome), sin instalar nada ni usar internet.
   Lee una carpeta, convierte cada archivo y guarda «<carpeta> - Portal.html» en la misma carpeta.
   Formatos: .drawio, .pdf, .html/.htm, .docx, .xlsx/.xlsm, .pptx (los .doc/.xls/.ppt antiguos quedan para descargar). */
'use strict';
const GENERADOR = 'portal-documentos';
const FONT = "Figtree, 'Segoe UI', system-ui, -apple-system, sans-serif";
const FONTFACE = "@font-face{font-family:'Figtree';font-style:normal;font-weight:300 900;font-display:swap;src:url(data:font/ttf;base64," + FIGTREE_B64 + ") format('truetype')}";
const TIPOS = {'.drawio': 'drawio', '.pdf': 'pdf', '.html': 'html', '.htm': 'html', '.docx': 'word', '.doc': 'word',
  '.pptx': 'ppt', '.ppt': 'ppt', '.xlsx': 'excel', '.xlsm': 'excel', '.xls': 'excel'};
const MIME = {'.drawio': 'application/xml', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt': 'application/vnd.ms-powerpoint',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12', '.xls': 'application/vnd.ms-excel'};
const NOTA = {
  excel: 'Vista simplificada del Excel: valores, colores y celdas combinadas; no incluye formato condicional ni gráficos. Descarga el original para verlo completo.',
  word: 'Vista del Word convertida a HTML: el formato puede variar. Descarga el original para verlo exacto.',
  ppt: 'Vista de la presentación convertida a HTML: textos, imágenes y tablas en su posición; el diseño puede variar. Descarga el original para verla exacta.'};
const MAX_FILAS = 3000, MAX_COLS = 150;
const dec = new TextDecoder(), enc = new TextEncoder();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const clave = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ext = n => (n.match(/\.[^.\/]+$/) || [''])[0].toLowerCase();
const tituloDe = n => n.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
const fechaDe = ms => { const d = new Date(ms); return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear(); };
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64txt(t) { return b64(enc.encode(t)); }
// vistas HTML: se guardan como texto (no base64, que pesa un 33 % más); solo se protege el cierre de <script>
function vistaTxt(id, t) { return '<script type="text/plain" data-t id="' + id + '">' + t.replace(/<\/(script)/gi, '<\\/$1') + '<\/script>'; }
function deB64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const hijos = (el, n) => el ? [...el.children].filter(c => c.localName === n) : [];
const hijo = (el, n) => hijos(el, n)[0] || null;
const todos = (el, n) => el ? [...el.getElementsByTagName('*')].filter(c => c.localName === n) : [];
const uno = (el, n) => { if (!el) return null; for (const c of el.getElementsByTagName('*')) if (c.localName === n) return c; return null; };
const at = (el, n) => el ? el.getAttribute(n) : null;
const HEX6 = /^[0-9A-Fa-f]{6}$/;
let AVISOS = [];
function aviso(m) { AVISOS.push(m); log('⚠ ' + m, 'av'); }

// ------------------------------------------------------------------ ZIP nativo (DecompressionStream)
async function inflar(data) {
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function abrirZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('no es un archivo ZIP/Office válido');
  const n = dv.getUint16(e + 10, true); let off = dv.getUint32(e + 16, true);
  const F = new Map();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nlen = dv.getUint16(off + 28, true),
      xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true), loff = dv.getUint32(off + 42, true);
    F.set(dec.decode(u8.subarray(off + 46, off + 46 + nlen)), {method, csize, loff});
    off += 46 + nlen + xlen + clen;
  }
  const z = {
    nombres: [...F.keys()], tiene: x => F.has(x),
    async bytes(x) { const f = F.get(x); if (!f) return null;
      const ln = dv.getUint16(f.loff + 26, true), lx = dv.getUint16(f.loff + 28, true), ini = f.loff + 30 + ln + lx;
      const d = u8.subarray(ini, ini + f.csize); return f.method === 0 ? d : inflar(d); },
    async texto(x) { const d = await z.bytes(x); return d ? dec.decode(d) : null; },
    async xml(x) { const t = await z.texto(x); return t ? xml(t) : null; },
  };
  return z;
}
function mimeImg(n) { const e = ext(n); return {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff'}[e] || null; }
function unir(base, rel) {
  if (rel.startsWith('/')) return rel.slice(1);
  const p = (base ? base.split('/') : []); for (const s of rel.split('/')) { if (s === '..') p.pop(); else if (s && s !== '.') p.push(s); }
  return p.join('/');
}
async function relaciones(z, parte) {
  const d = parte.includes('/') ? parte.slice(0, parte.lastIndexOf('/')) : '';
  const rp = (d ? d + '/' : '') + '_rels/' + parte.slice(parte.lastIndexOf('/') + 1) + '.rels';
  const out = {}; const x = await z.xml(rp); if (!x) return out;
  for (const r of todos(x, 'Relationship')) out[at(r, 'Id')] = at(r, 'TargetMode') === 'External' ? at(r, 'Target') : unir(d, at(r, 'Target'));
  return out;
}
function conFigtree(page) {
  const css = '<style>' + FONTFACE + "html,body{font-family:Figtree,'Segoe UI',system-ui,sans-serif}</style>";
  const m = page.match(/<head[^>]*>/i);
  return m ? page.slice(0, m.index + m[0].length) + css + page.slice(m.index + m[0].length) : css + page;
}

// ------------------------------------------------------------------ Excel (.xlsx)
const FMT_FECHA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const FMT_STD = {1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 49: '@'};
async function leerXlsx(u8) {
  const z = await abrirZip(u8);
  const wb = await z.xml('xl/workbook.xml'), wrels = await relaciones(z, 'xl/workbook.xml');
  const ss = []; const sx = await z.xml('xl/sharedStrings.xml');
  if (sx) for (const si of hijos(sx.documentElement, 'si')) ss.push(todos(si, 't').filter(t => !t.closest || !t.parentElement || t.parentElement.localName !== 'rPh').map(t => t.textContent).join(''));
  const st = await z.xml('xl/styles.xml'); const numFmts = {}, fonts = [], fills = [], xfs = [];
  if (st) {
    for (const n of todos(st, 'numFmt')) numFmts[+at(n, 'numFmtId')] = at(n, 'formatCode');
    const col = c => { const v = at(c, 'rgb'); return v && v.length === 8 && v !== '00000000' ? '#' + v.slice(2) : null; };
    for (const f of hijos(hijo(st.documentElement, 'fonts'), 'font')) {
      const b = hijo(f, 'b'), i = hijo(f, 'i'), c = hijo(f, 'color'), s = hijo(f, 'sz');
      fonts.push({b: b && at(b, 'val') !== '0', i: i && at(i, 'val') !== '0', color: c ? col(c) : null, sz: s ? +at(s, 'val') : 11});
    }
    for (const f of hijos(hijo(st.documentElement, 'fills'), 'fill')) {
      const p = hijo(f, 'patternFill'); const fg = p && hijo(p, 'fgColor');
      fills.push(p && at(p, 'patternType') === 'solid' && fg ? col(fg) : null);
    }
    for (const x of hijos(hijo(st.documentElement, 'cellXfs'), 'xf')) {
      const a = hijo(x, 'alignment');
      xfs.push({fmt: +at(x, 'numFmtId') || 0, font: +at(x, 'fontId') || 0, fill: +at(x, 'fillId') || 0,
        h: a ? at(a, 'horizontal') : null, v: a ? at(a, 'vertical') : null, wrap: a ? at(a, 'wrapText') === '1' : false});
    }
  }
  const hojas = [];
  for (const s of todos(wb, 'sheet')) {
    const parte = wrels[at(s, 'r:id')]; if (!parte) continue;
    const d = await z.xml(parte); if (!d) continue;
    hojas.push({nombre: at(s, 'name'), estado: at(s, 'state') || 'visible', doc: d});
  }
  return {ss, numFmts, fonts, fills, xfs, hojas};
}
function colNum(ref) { const m = ref.match(/^([A-Z]+)(\d+)$/); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [+m[2], c]; }
function colLetra(c) { let s = ''; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; }
function esFecha(id, code) {
  if (FMT_FECHA.has(id)) return true; if (!code) return false;
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(c) && !/^[#0.,%E+\-\s]*$/.test(c);
}
function valorCelda(c, X) {
  const t = at(c, 't'), vEl = hijo(c, 'v'); const xf = X.xfs[+at(c, 's') || 0] || {fmt: 0};
  if (t === 'inlineStr') return {txt: todos(c, 't').map(x => x.textContent).join(''), num: false};
  if (!vEl) return {txt: '', num: false};
  const v = vEl.textContent;
  if (t === 's') return {txt: X.ss[+v] ?? '', num: false};
  if (t === 'b') return {txt: v === '1' ? 'VERDADERO' : 'FALSO', num: false};
  if (t === 'str' || t === 'e') return {txt: v, num: false};
  const n = +v; const code = X.numFmts[xf.fmt] || FMT_STD[xf.fmt] || 'General';
  if (code === ';;;') return {txt: '', num: true};
  if (esFecha(xf.fmt, X.numFmts[xf.fmt])) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 864e5));
    const f = String(d.getUTCDate()).padStart(2, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + d.getUTCFullYear();
    const hh = d.getUTCHours(), mm = d.getUTCMinutes();
    return {txt: n < 1 && n > 0 ? String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') : f + (hh || mm ? ' ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') : ''), num: true};
  }
  const dm = code.match(/0\.(0+)/); const decs = dm ? dm[1].length : null;
  if (code.includes('%')) return {txt: (n * 100).toFixed(decs || 0) + '%', num: true};
  if (decs !== null || code.includes('#,##0') || code === '0') {
    let s = n.toFixed(decs || 0); if (code.includes('#,##0')) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return {txt: s, num: true};
  }
  return {txt: Number.isInteger(n) ? String(n) : String(+n.toPrecision(6)), num: true};
}
async function xlsxAHtml(u8, titulo) {
  const X = await leerXlsx(u8); const textos = [], cortes = [], hojas = [];
  for (const h of X.hojas) {
    if (h.estado !== 'visible') continue;
    const d = h.doc, cols = {}, filas = {}, celdas = new Map(); let mr = 0, mc = 0;
    for (const c of todos(d, 'col')) for (let k = +at(c, 'min'); k <= Math.min(+at(c, 'max'), MAX_COLS); k++) cols[k] = {w: +at(c, 'width') || 8.43, oculta: at(c, 'hidden') === '1'};
    for (const r of todos(d, 'row')) {
      const rn = +at(r, 'r'); if (rn > MAX_FILAS) { cortes.push(h.nombre); break; }
      filas[rn] = {h: at(r, 'ht') ? +at(r, 'ht') : null, oculta: at(r, 'hidden') === '1'};
      for (const c of hijos(r, 'c')) { const [fr, fc] = colNum(at(c, 'r')); if (fc > MAX_COLS) continue;
        const v = valorCelda(c, X); celdas.set(fr + ',' + fc, {v, s: +at(c, 's') || 0});
        if (v.txt) { textos.push(v.txt); mr = Math.max(mr, fr); mc = Math.max(mc, fc); }
        else if (+at(c, 's')) { mr = Math.max(mr, fr); mc = Math.max(mc, fc); } }
    }
    const span = new Map(), oculto = new Set();
    for (const m of todos(d, 'mergeCell')) {
      const [a, b] = at(m, 'ref').split(':'); if (!b) continue; const [r1, c1] = colNum(a), [r2, c2] = colNum(b);
      span.set(r1 + ',' + c1, [r2 - r1 + 1, c2 - c1 + 1]); mr = Math.max(mr, Math.min(r2, MAX_FILAS)); mc = Math.max(mc, Math.min(c2, MAX_COLS));
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) oculto.add(r + ',' + c);
    }
    const cv = [], fv = []; for (let c = 1; c <= mc; c++) if (!(cols[c] && cols[c].oculta)) cv.push(c); for (let r = 1; r <= mr; r++) if (!(filas[r] && filas[r].oculta)) fv.push(r);
    const cvs = new Set(cv), fvs = new Set(fv);
    let o = '<table><colgroup><col style="width:38px">' + cv.map(c => '<col style="width:' + Math.round((cols[c] ? cols[c].w : 8.43) * 7 + 5) + 'px">').join('') + '</colgroup>';
    o += '<thead><tr><th></th>' + cv.map(c => '<th>' + colLetra(c) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of fv) {
      const hgt = filas[r] && filas[r].h; o += '<tr' + (hgt ? ' style="height:' + Math.round(hgt * 1.33) + 'px"' : '') + '><th>' + r + '</th>';
      for (const c of cv) {
        if (oculto.has(r + ',' + c)) continue;
        const cel = celdas.get(r + ',' + c); const xf = X.xfs[cel ? cel.s : 0] || {}; const s = [];
        const f = X.fonts[xf.font]; if (f) { if (f.b) s.push('font-weight:700'); if (f.i) s.push('font-style:italic'); if (f.color && f.color.toLowerCase() !== '#000000') s.push('color:' + f.color); if (f.sz && Math.abs(f.sz - 11) > 0.5) s.push('font-size:' + f.sz + 'pt'); }
        const bg = X.fills[xf.fill]; if (bg) s.push('background:' + bg);
        if (['center', 'right', 'left', 'centerContinuous'].includes(xf.h)) s.push('text-align:' + (xf.h === 'centerContinuous' ? 'center' : xf.h)); else if (cel && cel.v.num) s.push('text-align:right');
        if (xf.wrap) s.push('white-space:normal'); if (xf.v === 'top' || xf.v === 'center') s.push('vertical-align:' + (xf.v === 'center' ? 'middle' : 'top'));
        const sp = span.get(r + ',' + c); let a = '';
        if (sp) { let rs = 0, cs = 0; for (let k = r; k < r + sp[0]; k++) if (fvs.has(k)) rs++; for (let k = c; k < c + sp[1]; k++) if (cvs.has(k)) cs++;
          if (rs > 1) a += ' rowspan="' + rs + '"'; if (cs > 1) a += ' colspan="' + cs + '"'; }
        o += '<td' + a + (s.length ? ' style="' + s.join(';') + '"' : '') + '>' + esc(cel ? cel.v.txt : '') + '</td>';
      }
      o += '</tr>';
    }
    hojas.push([h.nombre, o + '</tbody></table>']);
  }
  const tabs = hojas.map((h, k) => '<button data-h="' + k + '"' + (k ? '' : ' aria-selected="true"') + '>' + esc(h[0]) + '</button>').join('');
  const cuerpos = hojas.map((h, k) => '<div class="h" id="h' + k + '"' + (k ? ' hidden' : '') + '>' + h[1] + '</div>').join('');
  const page = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(titulo) + '</title><style>' +
    "body{margin:0;font-family:Figtree,Calibri,'Segoe UI',system-ui,sans-serif;font-size:11pt;color:#1f2433;background:#fff}" +
    '.tabs{position:sticky;top:0;z-index:3;display:flex;gap:2px;flex-wrap:wrap;background:#e9ecf2;padding:6px 6px 0;border-bottom:1px solid #c9cdd6}' +
    '.tabs button{font:inherit;font-size:12px;border:1px solid #c9cdd6;border-bottom:0;background:#f6f7f9;padding:5px 12px;border-radius:6px 6px 0 0;cursor:pointer}' +
    '.tabs button[aria-selected=true]{background:#fff;color:#217346;font-weight:700}[hidden]{display:none!important}.h{overflow:auto}' +
    'table{border-collapse:collapse;table-layout:fixed;width:max-content}' +
    'td,th{border:1px solid #dde1e7;padding:1px 4px;white-space:nowrap;overflow:hidden;vertical-align:bottom;height:20px}' +
    'th{background:#f3f4f6;color:#6b7280;font-weight:400;font-size:10px;text-align:center;position:sticky;top:0}tbody th{position:sticky;left:0;z-index:1}' +
    '</style></head><body><div class="tabs">' + tabs + '</div>' + cuerpos +
    '<script>document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.removeAttribute("aria-selected"));' +
    'b.setAttribute("aria-selected","true");document.querySelectorAll(".h").forEach((h,i)=>h.hidden=i!=+b.dataset.h)})<\/script></body></html>';
  if (cortes.length) aviso(titulo + ': hojas recortadas a ' + MAX_FILAS + ' filas × ' + MAX_COLS + ' columnas: ' + cortes.join(', '));
  return {page, texto: textos.join(' ')};
}

// ------------------------------------------------------------------ draw.io → SVG (fiel al estilo original)
function sty(s) { const d = {}; (s || '').split(';').forEach(p => { if (!p) return; const i = p.indexOf('='); if (i < 0) d[p] = '1'; else d[p.slice(0, i)] = p.slice(i + 1); }); return d; }
const _ta = document.createElement('textarea');
function desHtml(v) { _ta.innerHTML = v; return _ta.value; }
function lineasEtiqueta(v) {
  v = String(v || '').replace(/<br\s*\/?>|<\/div>|<\/p>|<\/li>|<div[^>]*>|<p[^>]*>|<li[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  v = desHtml(desHtml(v)).replace(/ /g, ' ').split(/%3CmxGraphModel|<mxGraphModel/)[0];
  return v.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function ancho(t, fs) { return t.length * fs * 0.56; }
function envolver(lineas, fs, w) {
  const out = [];
  for (const l of lineas) { let cur = '';
    for (const pal of l.split(' ')) { const t = cur ? cur + ' ' + pal : pal; if (ancho(t, fs) <= w || !cur) cur = t; else { out.push(cur); cur = pal; } }
    if (cur) out.push(cur); }
  return out;
}
function paginasDrawio(txt) {
  const d = xml(txt); const raiz = d.documentElement;
  if (raiz.localName === 'mxGraphModel') return [['Página 1', raiz]];
  const out = []; let k = 0;
  for (const dg of todos(raiz, 'diagram')) { k++;
    const nombre = at(dg, 'name') || 'Página ' + k; let m = hijo(dg, 'mxGraphModel');
    if (!m && dg.textContent.trim()) out.push([nombre, dg.textContent.trim()]); else if (m) out.push([nombre, m]); }
  return out;
}
async function modeloDe(x) {
  if (typeof x !== 'string') return x;
  const raw = await inflar(deB64(x)); const s = decodeURIComponent(dec.decode(raw));
  return xml(s).documentElement;
}
const COLOR = (c, def) => !c ? def : c === 'none' ? 'none' : c;
function drawioSvg(modelo, slug, nombreArchivo) {
  // celdas (incluye <object>/<UserObject> que envuelven a mxCell)
  const C = new Map(), orden = [];
  for (const el of todos(modelo, 'mxCell')) {
    const p = el.parentElement; const obj = p && (p.localName === 'object' || p.localName === 'UserObject') ? p : null;
    const id = obj ? at(obj, 'id') : at(el, 'id'); if (!id) continue;
    const g = hijo(el, 'mxGeometry');
    const c = {id, el, value: obj ? (at(obj, 'label') || '') : (at(el, 'value') || ''), s: sty(at(el, 'style')), parent: at(el, 'parent'),
      vertex: at(el, 'vertex') === '1', edge: at(el, 'edge') === '1', source: at(el, 'source'), target: at(el, 'target'), g};
    C.set(id, c); orden.push(c);
  }
  const num = (g, k) => g ? (+at(g, k) || 0) : 0;
  const memo = new Map();
  function origen(id) {
    if (memo.has(id)) return memo.get(id); const c = C.get(id);
    let r = [0, 0]; if (c && c.vertex && c.g) { const p = origen(c.parent); r = [p[0] + num(c.g, 'x'), p[1] + num(c.g, 'y')]; }
    memo.set(id, r); return r;
  }
  const caja = id => { const c = C.get(id); const o = origen(id); return [o[0], o[1], num(c.g, 'width'), num(c.g, 'height')]; };
  const verts = orden.filter(c => c.vertex && c.g && !(C.get(c.parent) && C.get(c.parent).edge));
  const etqArista = new Map();
  for (const c of orden) if (c.vertex && C.get(c.parent) && C.get(c.parent).edge) {
    const l = lineasEtiqueta(c.value); if (!l.length) continue;
    if (!etqArista.has(c.parent)) etqArista.set(c.parent, []); etqArista.get(c.parent).push({l, x: num(c.g, 'x'), s: c.s});
  }
  const B = new Map(); for (const c of verts) B.set(c.id, caja(c.id));
  const tipo = c => { const s = c.s;
    if ('swimlane' in s || s.shape === 'swimlane' || s.shape === 'table') return 'lane';
    if (s.shape === 'image' || (s.image && s.image !== '1')) return 'image';
    if ('rhombus' in s || s.shape === 'rhombus' || s.shape === 'mxgraph.flowchart.decision') return 'rombo';
    if ('ellipse' in s || s.shape === 'ellipse' || s.shape === 'mxgraph.flowchart.start_1' || s.shape === 'mxgraph.flowchart.start_2' || s.shape === 'doubleEllipse') return 'elipse';
    if (s.shape === 'document' || s.shape === 'mxgraph.flowchart.document' || s.shape === 'mxgraph.basic.document') return 'doc';
    if ((s.shape || '').includes('cylinder') || s.shape === 'mxgraph.flowchart.database' || s.shape === 'datastore') return 'cil';
    if (s.shape === 'note' || s.shape === 'mxgraph.basic.note') return 'nota';
    if (s.shape === 'parallelogram' || s.shape === 'mxgraph.flowchart.data') return 'paral';
    if (s.shape === 'hexagon' || s.shape === 'mxgraph.flowchart.preparation') return 'hex';
    if (s.shape === 'mxgraph.flowchart.terminator') return 'term';
    if (s.shape === 'triangle') return 'tri';
    if ('text' in s || s.shape === 'text' || ((s.strokeColor === 'none' || !s.strokeColor) && (s.fillColor === 'none' || !s.fillColor) && !('rounded' in s) && s.shape === undefined && 'html' in s && !('whiteSpace' in s) && false)) return 'texto';
    if (s.strokeColor === 'none' && (s.fillColor === 'none' || s.fillColor === undefined)) return 'texto';
    return 'rect'; };
  // aristas
  function lado(b, p) { const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2, dx = (p[0] - cx) / (b[2] || 1), dy = (p[1] - cy) / (b[3] || 1);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'B' : 'T'); }
  const punto = (b, sd) => ({R: [b[0] + b[2], b[1] + b[3] / 2], L: [b[0], b[1] + b[3] / 2], T: [b[0] + b[2] / 2, b[1]], B: [b[0] + b[2] / 2, b[1] + b[3]]}[sd]);
  const E = [];
  for (const c of orden.filter(c => c.edge)) {
    const s = c.s, g = c.g; const o = origen(c.parent);
    const wps = []; let sp = null, tp = null;
    if (g) { const arr = hijo(g, 'Array'); if (arr) for (const p of hijos(arr, 'mxPoint')) wps.push([o[0] + (+at(p, 'x') || 0), o[1] + (+at(p, 'y') || 0)]);
      for (const p of hijos(g, 'mxPoint')) { const pt = [o[0] + (+at(p, 'x') || 0), o[1] + (+at(p, 'y') || 0)]; if (at(p, 'as') === 'sourcePoint') sp = pt; if (at(p, 'as') === 'targetPoint') tp = pt; } }
    const sb = B.get(c.source), tb = B.get(c.target);
    if (!sb && !sp || !tb && !tp) continue;
    const sc = sb ? [sb[0] + sb[2] / 2, sb[1] + sb[3] / 2] : sp, tc = tb ? [tb[0] + tb[2] / 2, tb[1] + tb[3] / 2] : tp;
    let a, z, sideA = null;
    if (sb) { if (s.exitX !== undefined) a = [sb[0] + (+s.exitX) * sb[2], sb[1] + (+s.exitY || 0) * sb[3]];
      else { sideA = lado(sb, wps[0] || tc); a = punto(sb, sideA); } } else a = sp;
    if (tb) { if (s.entryX !== undefined) z = [tb[0] + (+s.entryX) * tb[2], tb[1] + (+s.entryY || 0) * tb[3]];
      else z = punto(tb, lado(tb, wps.length ? wps[wps.length - 1] : (sb ? a : sc))); } else z = tp;
    if (sb && s.exitX !== undefined) { const ex = +s.exitX, ey = +s.exitY || 0; sideA = ex <= 0 ? 'L' : ex >= 1 ? 'R' : ey <= 0 ? 'T' : 'B'; }
    let pts = [a, ...wps, z];
    const orto = (s.edgeStyle || '').includes('orthogonal') || (s.edgeStyle || '').includes('elbow') || s.edgeStyle === 'entityRelationEdgeStyle';
    if (orto) { const q = [pts[0]]; let horiz = sideA ? (sideA === 'L' || sideA === 'R') : Math.abs(pts[1][0] - pts[0][0]) >= Math.abs(pts[1][1] - pts[0][1]);
      for (let i = 1; i < pts.length; i++) { const p0 = q[q.length - 1], p1 = pts[i];
        if (Math.abs(p0[0] - p1[0]) > 0.5 && Math.abs(p0[1] - p1[1]) > 0.5) { q.push(horiz ? [p1[0], p0[1]] : [p0[0], p1[1]]); }
        q.push(p1); horiz = !horiz; }
      pts = q; }
    const lab = lineasEtiqueta(c.value); const extra = etqArista.get(c.id) || [];
    E.push({c, pts, s, lab, extra, src: sb ? c.source : null, tgt: tb ? c.target : null});
  }
  // límites
  let xs = [], ys = [];
  for (const c of verts) { const b = B.get(c.id); xs.push(b[0], b[0] + b[2]); ys.push(b[1], b[1] + b[3]); }
  for (const e of E) for (const p of e.pts) { xs.push(p[0]); ys.push(p[1]); }
  if (!xs.length) { xs = [0, 100]; ys = [0, 100]; }
  const M = 24, x0 = Math.min(...xs) - M, y0 = Math.min(...ys) - M, VW = Math.ceil(Math.max(...xs) - x0 + M), VH = Math.ceil(Math.max(...ys) - y0 + M);
  const X = v => +(v - x0).toFixed(1), Y = v => +(v - y0).toFixed(1);
  // pasos (BFS desde los inicios)
  const nodos = verts.filter(c => !['lane', 'texto'].includes(tipo(c)));
  const sal = new Map(), indeg = new Map();
  for (const e of E) if (e.src && e.tgt && e.s.endArrow !== 'none') { if (!sal.has(e.src)) sal.set(e.src, []); sal.get(e.src).push(e.tgt); indeg.set(e.tgt, (indeg.get(e.tgt) || 0) + 1); }
  const pos = id => B.get(id) || [0, 0, 0, 0];
  let inicios = nodos.filter(c => /^inicio/i.test(clave(lineasEtiqueta(c.value).join(' ')))).map(c => c.id);
  if (!inicios.length) inicios = nodos.filter(c => !indeg.get(c.id) && sal.has(c.id)).map(c => c.id);
  if (!inicios.length && nodos.length) inicios = [nodos[0].id];
  const nivel = new Map(); const cola = [];
  inicios.sort((a, b) => pos(a)[1] - pos(b)[1] || pos(a)[0] - pos(b)[0]).forEach(i => { nivel.set(i, 0); cola.push(i); });
  while (cola.length) { const u = cola.shift(); for (const v of (sal.get(u) || []).sort((a, b) => pos(a)[1] - pos(b)[1] || pos(a)[0] - pos(b)[0])) if (!nivel.has(v)) { nivel.set(v, nivel.get(u) + 1); cola.push(v); } }
  let mx = Math.max(-1, ...nivel.values());
  for (const c of nodos.filter(c => !nivel.has(c.id)).sort((a, b) => pos(a.id)[0] - pos(b.id)[0] || pos(a.id)[1] - pos(b.id)[1])) {
    const vecino = E.find(e => (e.src === c.id && nivel.has(e.tgt)) || (e.tgt === c.id && nivel.has(e.src)));
    if (vecino) nivel.set(c.id, nivel.get(vecino.src === c.id ? vecino.tgt : vecino.src)); else nivel.set(c.id, ++mx);
  }
  const pasos = Math.max(1, ...[...nivel.values()].map(v => v + 1));
  const paso = id => nivel.has(id) ? nivel.get(id) + 1 : null;
  const item = st => st ? ' data-motion-item data-step="' + st + '"' : '';
  // dibujo
  const marcas = new Map(); const marca = col => { if (!marcas.has(col)) marcas.set(col, slug + '-m' + marcas.size); return marcas.get(col); };
  const o = [], textos = [];
  function etiqueta(c, b, lineas, extraY) {
    if (!lineas.length) return '';
    const s = c.s, fs = +s.fontSize || 12, col = COLOR(s.fontColor, '#000000') === 'none' ? '#000000' : COLOR(s.fontColor, '#000000');
    const fsty = +s.fontStyle || 0, peso = fsty & 1 ? 700 : 400, ital = fsty & 2 ? ' font-style="italic"' : '', sub = fsty & 4 ? ' text-decoration="underline"' : '';
    let [x, y, w, h] = b; const sp = 4;
    const lp = s.labelPosition, vlp = s.verticalLabelPosition;
    if (vlp === 'bottom') { y = y + h; h = fs * 1.3 * lineas.length + 6; } else if (vlp === 'top') { h = fs * 1.3 * lineas.length + 6; y = y - h; }
    if (lp === 'right') x = x + w; else if (lp === 'left') x = x - w;
    let hor = s.horizontal === '0';
    const wl = (s.whiteSpace === 'wrap' || s.html === '1') ? envolver(lineas, fs, hor ? h - 2 * sp : w - 2 * sp) : lineas;
    const al = s.align || 'center', va = s.verticalAlign || (tipo(c) === 'lane' ? 'top' : 'middle');
    const lh = fs * 1.2, tot = wl.length * lh;
    if (hor) { const cx = x + (+s.startSize || 23) / 2 + (extraY || 0), cy = y + h / 2;
      return '<text transform="translate(' + X(cx) + ',' + Y(cy) + ') rotate(-90)" text-anchor="middle" font-size="' + fs + '" font-weight="' + peso + '" fill="' + col + '"' + ital + sub + '>' +
        wl.map((l, i) => '<tspan x="0" y="' + (+((i - (wl.length - 1) / 2) * lh + fs * 0.35).toFixed(1)) + '">' + esc(l) + '</tspan>').join('') + '</text>'; }
    const tx = al === 'left' ? x + sp : al === 'right' ? x + w - sp : x + w / 2, anc = al === 'left' ? 'start' : al === 'right' ? 'end' : 'middle';
    let ty = va === 'top' ? y + sp + fs : va === 'bottom' ? y + h - sp - tot + fs : y + h / 2 - tot / 2 + fs * 0.85;
    if (tipo(c) === 'lane' && s.horizontal !== '0') ty = y + Math.min(+s.startSize || 23, h) / 2 - tot / 2 + fs * 0.85;
    return '<text text-anchor="' + anc + '" font-size="' + fs + '" font-weight="' + peso + '" fill="' + col + '"' + ital + sub + '>' +
      wl.map((l, i) => '<tspan x="' + X(tx) + '" y="' + Y(ty + i * lh).toFixed(1) + '">' + esc(l) + '</tspan>').join('') + '</text>';
  }
  for (const c of verts) {
    const b = B.get(c.id), s = c.s, k = tipo(c), lin = lineasEtiqueta(c.value); textos.push(...lin);
    const [x, y, w, h] = [X(b[0]), Y(b[1]), b[2], b[3]];
    const fill = COLOR(s.fillColor, k === 'texto' || k === 'lane' && !s.fillColor ? 'none' : '#ffffff'), stroke = COLOR(s.strokeColor, k === 'texto' ? 'none' : '#000000');
    const sw = +s.strokeWidth || 1, dash = s.dashed === '1' ? ' stroke-dasharray="' + (s.dashPattern ? s.dashPattern.replace(/\s+/g, ',') : '6,4') + '"' : '';
    const op = s.opacity ? ' opacity="' + (+s.opacity / 100) + '"' : '';
    const base = ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + op;
    let g = '';
    if (k === 'lane') {
      const ss = Math.min(+s.startSize || 23, s.horizontal === '0' ? w : h), hor = s.horizontal !== '0';
      const cuerpo = COLOR(s.swimlaneFillColor, 'none');
      g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + (cuerpo === 'default' ? 'none' : cuerpo) + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + '/>';
      g += hor ? '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + ss + '"' + base + '/>' : '<rect x="' + x + '" y="' + y + '" width="' + ss + '" height="' + h + '"' + base + '/>';
      g += etiqueta(c, b, lin);
      o.push('<g>' + g + '</g>'); continue;
    }
    const rx = s.rounded === '1' ? Math.min(w, h) * (s.absoluteArcSize === '1' ? (+s.arcSize || 10) / Math.min(w, h) : (+s.arcSize || 15) / 100) : 0;
    if (k === 'rect' || k === 'term') g += '<rect class="nb" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (k === 'term' ? h / 2 : +rx.toFixed(1)) + '"' + base + '/>';
    else if (k === 'elipse') g += '<ellipse class="nb" cx="' + (x + w / 2) + '" cy="' + (y + h / 2) + '" rx="' + w / 2 + '" ry="' + h / 2 + '"' + base + '/>';
    else if (k === 'rombo') g += '<polygon class="nb" points="' + [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]].map(p => p.join(',')).join(' ') + '"' + base + '/>';
    else if (k === 'paral') { const d = Math.min(w * 0.2, 20); g += '<polygon class="nb" points="' + [[x + d, y], [x + w, y], [x + w - d, y + h], [x, y + h]].map(p => p.join(',')).join(' ') + '"' + base + '/>'; }
    else if (k === 'hex') { const d = Math.min(w * 0.25, 20); g += '<polygon class="nb" points="' + [[x + d, y], [x + w - d, y], [x + w, y + h / 2], [x + w - d, y + h], [x + d, y + h], [x, y + h / 2]].map(p => p.join(',')).join(' ') + '"' + base + '/>'; }
    else if (k === 'tri') g += '<polygon class="nb" points="' + [[x, y], [x + w, y + h / 2], [x, y + h]].map(p => p.join(',')).join(' ') + '"' + base + '/>';
    else if (k === 'doc') { const d = h * 0.12; g += '<path class="nb" d="M' + x + ' ' + y + ' H' + (x + w) + ' V' + (y + h - d) + ' Q' + (x + w * 0.75) + ' ' + (y + h - 2.6 * d) + ' ' + (x + w / 2) + ' ' + (y + h - d) + ' T' + x + ' ' + (y + h - d) + ' Z"' + base + '/>'; }
    else if (k === 'cil') { const e = Math.min(h * 0.15, 12); g += '<path class="nb" d="M' + x + ' ' + (y + e) + ' A' + w / 2 + ' ' + e + ' 0 0 1 ' + (x + w) + ' ' + (y + e) + ' V' + (y + h - e) + ' A' + w / 2 + ' ' + e + ' 0 0 1 ' + x + ' ' + (y + h - e) + ' Z"' + base + '/><path d="M' + x + ' ' + (y + e) + ' A' + w / 2 + ' ' + e + ' 0 0 0 ' + (x + w) + ' ' + (y + e) + '" fill="none" stroke="' + stroke + '"/>'; }
    else if (k === 'nota') { const f = 12; g += '<path class="nb" d="M' + x + ' ' + y + ' H' + (x + w - f) + ' L' + (x + w) + ' ' + (y + f) + ' V' + (y + h) + ' H' + x + ' Z"' + base + '/>'; }
    else if (k === 'image') {
      let href = s.image || ''; if (href.startsWith('data:')) { const [hd, ...rest] = href.split(','); href = (hd.includes(';base64') || hd.startsWith('data:image/svg+xml') ? hd : hd + ';base64') + ',' + rest.join(','); }
      if (href.startsWith('data:')) g += '<image x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" href="' + esc(href) + '" preserveAspectRatio="xMidYMid meet"/>';
      else g += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#eef0f4" stroke="#9aa1ae" stroke-dasharray="4,3"/><text x="' + (x + w / 2) + '" y="' + (y + h / 2 + 3) + '" text-anchor="middle" font-size="8" fill="#566079">IMAGEN NO DISPONIBLE</text>';
      if (!s.verticalLabelPosition) c.s.verticalLabelPosition = 'bottom';
    }
    g += etiqueta(c, b, lin);
    o.push('<g' + item(paso(c.id)) + ' aria-label="' + esc(lin.join(' ').slice(0, 80) || k) + '">' + g + '</g>');
  }
  for (const e of E) {
    const s = e.s, col = COLOR(s.strokeColor, '#000000') === 'none' ? '#000000' : COLOR(s.strokeColor, '#000000'), sw = +s.strokeWidth || 1;
    const P = e.pts.map(p => [X(p[0]), Y(p[1])]);
    let d = 'M' + P[0].join(' ');
    if (s.rounded === '1' && P.length > 2) { for (let i = 1; i < P.length - 1; i++) { const a = P[i - 1], b = P[i], c2 = P[i + 1];
        const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c2[0] - b[0], c2[1] - b[1]), r = Math.min(8, l1 / 2, l2 / 2);
        const p1 = [b[0] - (b[0] - a[0]) / (l1 || 1) * r, b[1] - (b[1] - a[1]) / (l1 || 1) * r], p2 = [b[0] + (c2[0] - b[0]) / (l2 || 1) * r, b[1] + (c2[1] - b[1]) / (l2 || 1) * r];
        d += ' L' + p1.map(v => v.toFixed(1)).join(' ') + ' Q' + b.join(' ') + ' ' + p2.map(v => v.toFixed(1)).join(' '); }
      d += ' L' + P[P.length - 1].join(' '); }
    else for (let i = 1; i < P.length; i++) d += ' L' + P[i].join(' ');
    const fin = s.endArrow !== 'none' ? ' marker-end="url(#' + marca(col) + ')"' : '', ini = s.startArrow && s.startArrow !== 'none' ? ' marker-start="url(#' + marca(col) + 's)"' : '';
    const dash = s.dashed === '1' ? ' stroke-dasharray="' + (s.dashPattern ? s.dashPattern.replace(/\s+/g, ',') : '6,4') + '"' : '';
    let g = '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '"' + dash + fin + ini + '/>';
    const largo = []; let L = 0; for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); largo.push(l); L += l; }
    const enPunto = f => { let t = f * L; for (let i = 0; i < largo.length; i++) { if (t <= largo[i] || i === largo.length - 1) { const r = largo[i] ? t / largo[i] : 0; return [P[i][0] + (P[i + 1][0] - P[i][0]) * r, P[i][1] + (P[i + 1][1] - P[i][1]) * r]; } t -= largo[i]; } return P[0]; };
    const poner = (l, f, fs) => { textos.push(...l); const [px, py] = enPunto(f); const w = Math.max(...l.map(t => ancho(t, fs))) + 8, h = l.length * fs * 1.2 + 4;
      return '<rect x="' + (px - w / 2).toFixed(1) + '" y="' + (py - h / 2).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="#ffffff" opacity="0.9"/>' +
        '<text text-anchor="middle" font-size="' + fs + '" fill="' + col + '">' + l.map((t, i) => '<tspan x="' + px.toFixed(1) + '" y="' + (py - h / 2 + 2 + fs + i * fs * 1.2).toFixed(1) + '">' + esc(t) + '</tspan>').join('') + '</text>'; };
    if (e.lab.length) g += poner(e.lab, 0.5, +s.fontSize || 11);
    for (const x of e.extra) g += poner(x.l, Math.min(1, Math.max(0, (x.x + 1) / 2)), +x.s.fontSize || 11);
    const st = Math.max(paso(e.src) || 0, paso(e.tgt) || 0);
    o.push('<g' + item(st || null) + '>' + g + '</g>');
  }
  const defs = [...marcas].map(([col, id]) => '<marker id="' + id + '" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="userSpaceOnUse"><polygon points="0 0, 10 4, 0 8" fill="' + col + '"/></marker>' +
    '<marker id="' + id + 's" markerWidth="10" markerHeight="8" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse"><polygon points="10 0, 0 4, 10 8" fill="' + col + '"/></marker>').join('');
  const svg = '<svg viewBox="0 0 ' + VW + ' ' + VH + '" xmlns="http://www.w3.org/2000/svg" font-family="' + FONT.replace(/"/g, "'") + '" role="img" aria-label="' + esc(nombreArchivo) + '">' +
    '<defs>' + defs + '</defs><rect width="' + VW + '" height="' + VH + '" fill="#ffffff"/>' + o.join('') + '</svg>';
  return {svg, w: VW, h: VH, pasos, texto: textos.join(' ')};
}

// ------------------------------------------------------------------ HTML de la carpeta (recursos incrustados)
async function htmlConRecursos(txt, ruta, archivos) {
  const base = ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) : '';
  const buscar = async (desde, ref) => {
    if (/^(https?:|data:|#|mailto:|javascript:)/i.test(ref)) return null;
    let r; try { r = decodeURIComponent(ref.split('#')[0].split('?')[0]); } catch (e) { r = ref; }
    const f = archivos.get(unir(desde, r).toLowerCase()); if (!f) return null;
    const m = mimeImg(f.name) || MIME[ext(f.name)] || ({'.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'}[ext(f.name)]) || 'application/octet-stream';
    return 'data:' + m + ';base64,' + b64(new Uint8Array(await f.arrayBuffer()));
  };
  const reemplazar = async (s, re, fn) => { const partes = []; let last = 0; for (const m of s.matchAll(re)) { partes.push(s.slice(last, m.index), await fn(m)); last = m.index + m[0].length; } partes.push(s.slice(last)); return partes.join(''); };
  const cssInline = async (css, desde) => reemplazar(css, /url\((["']?)([^)"']+)\1\)/g, async m => { const u = await buscar(desde, m[2].trim()); return u ? 'url("' + u + '")' : m[0]; });
  const externos = (txt.match(/(?:src|href)=["']https?:\/\//gi) || []).length;
  let t = await reemplazar(txt, /<link\b[^>]*>/gi, async m => {
    const tag = m[0]; if (!/rel=["']?stylesheet/i.test(tag)) return tag; const h = tag.match(/href=["']([^"']+)/i); if (!h || /^https?:/i.test(h[1])) return tag;
    let r; try { r = decodeURIComponent(h[1]); } catch (e) { r = h[1]; } const f = archivos.get(unir(base, r).toLowerCase()); if (!f) return tag;
    const ruta2 = unir(base, r); return '<style>' + await cssInline(await f.text(), ruta2.includes('/') ? ruta2.slice(0, ruta2.lastIndexOf('/')) : '') + '</style>'; });
  t = await reemplazar(t, /<script\b([^>]*?)\ssrc=["'](?!https?:)([^"']+)["']([^>]*)>\s*<\/script>/gi, async m => {
    let r; try { r = decodeURIComponent(m[2]); } catch (e) { r = m[2]; } const f = archivos.get(unir(base, r).toLowerCase());
    return f ? '<script' + m[1] + '>' + (await f.text()).replace(/<\/script/gi, '<\\/script') + '<\/script>' : m[0]; });
  t = await reemplazar(t, /\b(src|poster)=(["'])([^"']+)\2/gi, async m => { const u = await buscar(base, m[3]); return u ? m[1] + '=' + m[2] + u + m[2] : m[0]; });
  t = await reemplazar(t, /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, async m => m[1] + await cssInline(m[2], base) + m[3]);
  if (externos) aviso(ruta + ': tiene ' + externos + ' recurso(s) en internet (fuentes, librerías o imágenes); sin conexión pueden no verse.');
  const texto = desHtml(t.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 60000);
  return {page: conFigtree(t), texto};
}

// ------------------------------------------------------------------ índice (csv / xlsx)
function leerCsv(t) {
  const primera = t.split(/\r?\n/)[0] || ''; const sep = [';', ',', '\t'].sort((a, b) => primera.split(b).length - primera.split(a).length)[0];
  const filas = []; let fila = [], cel = '', q = false;
  for (let i = 0; i < t.length; i++) { const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cel += '"'; i++; } else if (ch === '"') q = false; else cel += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { fila.push(cel); cel = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; fila.push(cel); filas.push(fila); fila = []; cel = ''; }
    else cel += ch; }
  if (cel || fila.length) { fila.push(cel); filas.push(fila); }
  return filas;
}
async function leerIndice(file) {
  let filas;
  if (ext(file.name) === '.xlsx') {
    const X = await leerXlsx(new Uint8Array(await file.arrayBuffer())); const h = X.hojas[0]; filas = [];
    for (const r of todos(h.doc, 'row')) { const f = []; for (const c of hijos(r, 'c')) { const [, cc] = colNum(at(c, 'r')); f[cc - 1] = valorCelda(c, X).txt; } filas.push([...f].map(v => v ?? '')); }
  } else {
    const u8 = new Uint8Array(await file.arrayBuffer()); let t;
    try { t = new TextDecoder('utf-8', {fatal: true}).decode(u8); } catch (e) { t = new TextDecoder('windows-1252').decode(u8); }
    filas = leerCsv(t.replace(/^﻿/, ''));
  }
  if (!filas.length) return [];
  const CAMPOS = ['archivo', 'titulo', 'seccion', 'orden', 'revision', 'responsable', 'fecha', 'estado', 'nota'];
  const cab = filas[0].map(clave);
  return filas.slice(1).filter(f => f.some(v => String(v || '').trim())).map(f => { const d = {}; cab.forEach((h, i) => { if (CAMPOS.includes(h)) d[h] = String(f[i] ?? '').trim(); }); return d; });
}
function plantillaCsv(rutas) {
  const q = v => /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  let t = '﻿Archivo;Titulo;Seccion;Orden;Revision;Responsable;Fecha;Estado;Nota\r\n';
  rutas.forEach((r, k) => { t += [r, tituloDe(r), r.includes('/') ? r.split('/')[0] : 'General', k + 1, '', '', '', '', ''].map(v => q(String(v))).join(';') + '\r\n'; });
  t += ';Ejemplo de documento pendiente;Documentos de gestión;99;;;;Pendiente;Fila sin archivo = aparece como pendiente\r\n';
  return t;
}

// ------------------------------------------------------------------ configuración («Configuracion html … .xlsx» en la misma carpeta)
const nrm = t => String(t ?? '').replace(/#U([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/…/g, '...').replace(/\s+/g, ' ').trim();
const esConfig = ruta => !ruta.includes('/') && /^configuracion ?html.*\.xlsx$/.test(nrm(ruta));
const esGenerador = ruta => /^generador de portal.*\.html?$/.test(nrm(ruta.split('/').pop()));
const EXT_EQ = {doc: ['doc', 'docx'], docx: ['docx', 'doc'], xls: ['xls', 'xlsx', 'xlsm'], xlsx: ['xlsx', 'xlsm', 'xls'], xlsm: ['xlsm', 'xlsx'], ppt: ['ppt', 'pptx'], pptx: ['pptx', 'ppt'], pdf: ['pdf'], drawio: ['drawio'], html: ['html', 'htm'], htm: ['htm', 'html']};
function nombreSeccion(t) {
  t = String(t || '').replace(/:\s*$/, '').trim();
  return t.replace(/\bpower ?point\b/i, 'PowerPoint').replace(/\bword\b/i, 'Word').replace(/\bexcel\b/i, 'Excel').replace(/^./, c => c.toUpperCase());
}
// patrón de la columna B: nombre exacto (con o sin extensión), «FG…» (empieza con), «…doc» (por extensión) o texto contenido
function coincide(patron, ruta, flexible) {
  const nombre = nrm(ruta.split('/').pop()), p = nrm(patron); const xt = ext(nombre).slice(1), stem = nombre.replace(/\.[^.]+$/, '');
  if (p.includes('...')) {
    const i = p.indexOf('...'), pre = p.slice(0, i).trim(), post = p.slice(i + 3).trim().replace(/^\.+/, '');
    if (pre && !nombre.startsWith(pre)) return false;
    if (post) { if (EXT_EQ[post]) return EXT_EQ[post].includes(xt); return nombre.endsWith(post) || stem.endsWith(post); }
    return true;
  }
  const pStem = p.replace(/\.(drawio|pdf|html?|docx?|xlsx?|xlsm|pptx?)$/, '');
  if (nombre === p || stem === pStem) return true;
  return !!flexible && pStem.length >= 3 && stem.includes(pStem);
}
// relación «título a mostrar» → archivo, aunque los nombres difieran («Gestión de RFI · Subcontratista» ↔ «FG_RFI SC revB.drawio»)
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'en', 'para', 'por', 'con', 'al', 'gestion', 'emision', 'flujo', 'proceso', 'documento', 'documentos', 'rev', 'fg']);
const SINONIMOS = {subcontratista: ['sc', 'subc'], supervision: ['sup', 'superv'], oficina: ['ot', 'of'], tecnica: ['ot'], cliente: ['cli'], informacion: ['info'], actualizacion: ['act', 'actualiz'], modelo: ['mod']};
const fichas = t => nrm(t).replace(/\.(drawio|pdf|html?|docx?|xlsx?|xlsm|pptx?)$/, '').split(/[^a-z0-9]+/).filter(Boolean);
function afinidad(titulo, ruta) {
  const tt = fichas(titulo).filter(t => !VACIAS.has(t) && !/^rev[a-z0-9]?$/.test(t) && t.length > 1);
  const ft = fichas(ruta.split('/').pop()), junto = ft.join('');
  const hits = tt.filter(t => [t, ...(SINONIMOS[t] || [])].some(v => ft.includes(v) || (v.length >= 4 && junto.includes(v)) || ft.some(f => f.length >= 3 && v.length > f.length && v.startsWith(f))));
  return {score: tt.length ? hits.length / tt.length : 0, hits, n: tt.length};
}
function porTitulo(titulo, candidatos, todosArch) {
  const r = candidatos.map(e => ({e, ...afinidad(titulo, e.ruta)})).filter(x => x.hits.length).sort((a, b) => b.score - a.score);
  if (!r.length) return null; const best = r[0];
  if (best.score === 1 && (!r[1] || r[1].score < 1)) return best.e;
  // palabra distintiva (≥ 6 letras) que solo aparece en un archivo de la carpeta
  const unica = best.hits.some(h => h.length >= 6 && todosArch.filter(e => afinidad(h, e.ruta).hits.length).length === 1);
  if (unica && (!r[1] || r[1].score < best.score)) return best.e;
  if (best.score >= 0.67 && (!r[1] || r[1].score < best.score)) return best.e;
  return null;
}
async function leerConfig(file) {
  const X = await leerXlsx(new Uint8Array(await file.arrayBuffer()));
  const h = X.hojas.find(x => x.estado === 'visible') || X.hojas[0]; if (!h) return null;
  const cfg = {titulo: '', subtitulo: '', buscador: true, reglas: [], excepciones: [], archivo: file.name}; let enDocs = false;
  for (const r of todos(h.doc, 'row')) {
    const v = {}; for (const c of hijos(r, 'c')) { const [, cc] = colNum(at(c, 'r')); v[cc] = valorCelda(c, X).txt.trim(); }
    const a = v[1] || '', b = v[2] || '', c = v[3] || '', k = nrm(a).replace(/:$/, '');
    if (!a && !b) continue;
    if (k.startsWith('excepcion')) { if (b) cfg.excepciones.push(b); continue; }
    if (k === 'titulo') { cfg.titulo = b; continue; }
    if (k === 'subtitulo') { cfg.subtitulo = b; continue; }
    if (k === 'buscador') { cfg.buscador = !!b && !/^(no|ninguno|sin|oculto|0)$/.test(nrm(b)); continue; }
    if (k.startsWith('documentos') && !b) { enDocs = true; continue; }
    if (k.startsWith('menu')) continue;
    // columna C (opcional): nombre del archivo; si está, manda sobre la búsqueda por título
    if (enDocs && a && (b || c)) cfg.reglas.push({seccion: nombreSeccion(a), patron: b || c, archivo: c});
  }
  return cfg;
}

// ------------------------------------------------------------------ armado del portal
async function esPortal(f) { if (!/\.html?$/i.test(f.name)) return false; return (await f.slice(0, 4000).text()).includes(GENERADOR); }
async function construir(entradas, nombreCarpeta, opciones) {
  AVISOS = [];
  const cfgE = entradas.find(e => esConfig(e.ruta)) || null; let cfg = null;
  if (cfgE) { try { cfg = await leerConfig(cfgE.file); log('Configuración: ' + cfgE.ruta + ' · ' + cfg.reglas.length + ' fila(s) de documentos, ' + cfg.excepciones.length + ' excepción(es)'); }
    catch (er) { aviso('No se pudo leer la configuración «' + cfgE.ruta + '» (' + er.message + '); se usa el orden por carpetas.'); } }
  const validas = [];
  for (const e of entradas) {
    const partes = e.ruta.split('/'); if (partes.some(p => p.startsWith('.') || p.startsWith('_')) || partes[partes.length - 1].startsWith('~$')) continue;
    if (!TIPOS[ext(e.ruta)] || esConfig(e.ruta) || esGenerador(e.ruta)) continue;
    if (cfg && cfg.excepciones.some(x => coincide(x, e.ruta, false))) continue;
    if (await esPortal(e.file)) continue; validas.push(e);
  }
  validas.sort((a, b) => a.ruta.toLowerCase().localeCompare(b.ruta.toLowerCase()));
  const todosArch = new Map(entradas.map(e => [e.ruta.toLowerCase(), e.file]));
  const idx = entradas.find(e => /^indice\.(xlsx|csv)$/i.test(e.ruta)) || null;
  let indice = [];
  if (idx) { try { indice = await leerIndice(idx.file); log('Índice: ' + idx.ruta + ' (' + indice.length + ' filas)'); } catch (er) { aviso('No se pudo leer el índice (' + er.message + ')'); } }
  const porRuta = new Map(validas.map(e => [e.ruta.toLowerCase(), e])), porNombre = new Map();
  for (const e of validas) { const n = e.ruta.split('/').pop().toLowerCase(); if (!porNombre.has(n)) porNombre.set(n, e); }
  if (cfg && cfg.reglas.length) {   // la configuración define secciones y orden; el índice (si existe) aporta la ficha
    const meta = new Map(); for (const f of indice) if (f.archivo) meta.set(nrm(f.archivo.split(/[\\/]/).pop()).replace(/\.[^.]+$/, ''), f);
    const filas = [], asignados = new Set(), vistos = new Set(); let orden = 0;
    for (const rg of cfg.reglas) {
      const clave = rg.seccion + '|' + nrm(rg.patron); if (vistos.has(clave)) continue; vistos.add(clave);
      if (rg.archivo) {                 // archivo indicado en la columna C
        let e = validas.find(e => !asignados.has(e) && coincide(rg.archivo, e.ruta, false)) || validas.find(e => !asignados.has(e) && coincide(rg.archivo, e.ruta, true));
        if (!e) { filas.push({archivo: '', titulo: rg.patron, seccion: rg.seccion, orden: String(++orden), estado: 'Pendiente'}); aviso('Configuración: el archivo «' + rg.archivo + '» (columna C) no está en la carpeta; «' + rg.patron + '» se muestra como pendiente.'); continue; }
        asignados.add(e); const m = meta.get(nrm(e.ruta.split('/').pop()).replace(/\.[^.]+$/, '')) || {};
        filas.push(Object.assign({}, m, {titulo: rg.patron !== rg.archivo ? rg.patron : (m.titulo || ''), archivo: e.ruta, seccion: rg.seccion, orden: String(++orden)})); continue;
      }
      let hits = validas.filter(e => !asignados.has(e) && coincide(rg.patron, e.ruta, false));
      if (!hits.length && !nrm(rg.patron).includes('...')) hits = validas.filter(e => !asignados.has(e) && coincide(rg.patron, e.ruta, true));
      let porNombre = true;
      if (!hits.length && !nrm(rg.patron).includes('...')) { const e = porTitulo(rg.patron, validas.filter(x => !asignados.has(x)), validas); if (e) { hits = [e]; porNombre = false; } }
      // marcador igual al nombre de la sección (p. ej. «Organigrama»): busca por las primeras letras («Org…»)
      if (!hits.length && nrm(rg.patron) === nrm(rg.seccion)) hits = validas.filter(e => !asignados.has(e) && coincide(nrm(rg.patron).slice(0, 3) + '...', e.ruta, false));
      if (!hits.length) { if (!nrm(rg.patron).includes('...')) { filas.push({archivo: '', titulo: rg.patron, seccion: rg.seccion, orden: String(++orden), estado: 'Pendiente'}); aviso('Configuración: «' + rg.patron + '» no se encontró en la carpeta; se muestra como pendiente.'); } continue; }
      for (const e of hits) { asignados.add(e); const m = meta.get(nrm(e.ruta.split('/').pop()).replace(/\.[^.]+$/, '')) || {};
        const tituloCfg = !nrm(rg.patron).includes('...') && nrm(rg.patron) !== nrm(rg.seccion) && hits.length === 1 ? rg.patron : '';
        filas.push(Object.assign({titulo: tituloCfg}, m, {archivo: e.ruta, seccion: rg.seccion, orden: String(++orden)})); }
    }
    for (const e of validas) if (!asignados.has(e)) filas.push({archivo: e.ruta, seccion: 'Otros documentos', orden: String(90000 + filas.length)});
    indice = filas;
  }
  const usados = new Set(), docs = [];
  indice.forEach((f, k) => {
    const arch = (f.archivo || '').replace(/\\/g, '/').trim(); let e = null;
    if (arch) { e = porRuta.get(arch.toLowerCase()) || porNombre.get(arch.split('/').pop().toLowerCase());
      if (!e && !ext(arch)) for (const x of Object.keys(TIPOS)) { e = porRuta.get((arch + x).toLowerCase()) || porNombre.get((arch.split('/').pop() + x).toLowerCase()); if (e) break; } }
    if (e && usados.has(e)) e = null; if (!e && arch) aviso('Índice: «' + arch + '» no se encontró en la carpeta; se muestra como pendiente.');
    if (e) usados.add(e);
    docs.push({e, rel: e ? e.ruta : '', titulo: f.titulo || (e ? tituloDe(e.ruta) : arch || 'Sin título'), seccion: f.seccion || (e && e.ruta.includes('/') ? e.ruta.split('/')[0] : 'General'),
      orden: f.orden || String(k + 1), revision: f.revision || '', responsable: f.responsable || '', fecha: f.fecha || '', estado: f.estado || (e ? '' : 'Pendiente'), nota: f.nota || ''});
  });
  for (const e of validas) if (!usados.has(e)) docs.push({e, rel: e.ruta, titulo: tituloDe(e.ruta), seccion: e.ruta.includes('/') ? e.ruta.split('/')[0] : 'General', orden: '9999',
    revision: '', responsable: '', fecha: fechaDe(e.file.lastModified), estado: '', nota: ''});
  const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isNaN(v) ? 9999 : v; };
  const secc = new Map(); for (const d of docs) { if (!secc.has(d.seccion)) secc.set(d.seccion, []); secc.get(d.seccion).push(d); }
  const ordSec = [...secc.keys()].sort((a, b) => Math.min(...secc.get(a).map(d => num(d.orden))) - Math.min(...secc.get(b).map(d => num(d.orden))) || a.toLowerCase().localeCompare(b.toLowerCase()));
  const meta = [], payload = []; let n = 0; const total = docs.filter(d => d.e).length; let hechos = 0;
  for (const sec of ordSec) for (const d of secc.get(sec).sort((a, b) => num(a.orden) - num(b.orden) || a.titulo.toLowerCase().localeCompare(b.titulo.toLowerCase()))) {
    n++; const id = 'd' + n; const e = d.e; let tipo = e ? TIPOS[ext(e.ruta)] : 'pendiente';
    const m = {id, titulo: d.titulo, seccion: sec, tipo, archivo: d.rel, nombre: e ? e.ruta.split('/').pop() : '', revision: d.revision, responsable: d.responsable,
      fecha: d.fecha, estado: d.estado, nota: d.nota, tam: e ? e.file.size : 0, mime: e ? (MIME[ext(e.ruta)] || 'application/octet-stream') : ''};
    if (e) {
      progreso(++hechos, total, e.ruta);
      try {
        const u8 = new Uint8Array(await e.file.arrayBuffer());
        if (tipo === 'drawio') {
          const pags = paginasDrawio(dec.decode(u8)); m.paginas = []; const tx = [];
          for (let k = 0; k < pags.length; k++) { try { const R = MD.render(await modeloDe(pags[k][1]), id + 'p' + k, pags[k][0]);
              m.paginas.push({nombre: pags[k][0], w: R.w, h: R.h, pasos: R.pasos}); payload.push('<template id="t-' + id + '-' + m.paginas.length + '">' + R.svg + '</template>'); tx.push(pags[k][0], R.texto);
              if (R.svg.includes('IMAGEN NO DISPONIBLE')) aviso(e.ruta + ' · «' + pags[k][0] + '»: hay imágenes enlazadas que no se pudieron incrustar.'); }
            catch (er) { aviso(e.ruta + ' · página «' + pags[k][0] + '»: no se pudo dibujar (' + er.message + ')'); } }
          // las plantillas se numeran desde 0 en el visor
          for (let k = 0; k < m.paginas.length; k++) { const i = payload.length - m.paginas.length + k; payload[i] = payload[i].replace('id="t-' + id + '-' + (k + 1) + '"', 'id="t-' + id + '-' + k + '"'); }
          if (!m.paginas.length) throw new Error('sin páginas legibles');
          m.texto = tx.join(' ').slice(0, 60000); payload.push('<script type="text/plain" id="o-' + id + '">' + b64(u8) + '<\/script>');
        } else if (tipo === 'pdf') {
          // PDF → HTML (texto real, vectores e imágenes reducidas). Si no se puede (p. ej. PDF protegido), queda el PDF incrustado.
          let R = null; try { R = await PDFX.pdfAHtml(u8, d.titulo, (i, n) => { $('#estado').textContent = 'Convirtiendo ' + e.ruta + ': página ' + i + ' de ' + n; }); }
          catch (er) { aviso(e.ruta + ': no se pudo convertir a HTML (' + er.message + '); se muestra como PDF.'); }
          if (R) { m.vista = 'html'; m.texto = R.texto.slice(0, 60000); payload.push(vistaTxt('v-' + id, conFigtree(R.page)));
            if (opciones.originales) payload.push('<script type="text/plain" id="o-' + id + '">' + b64(u8) + '<\/script>'); }
          else { m.texto = ''; payload.push('<script type="text/plain" id="o-' + id + '">' + b64(u8) + '<\/script>'); } }
        else if (tipo === 'html') { let t; try { t = new TextDecoder('utf-8', {fatal: true}).decode(u8); } catch (er) { t = new TextDecoder('windows-1252').decode(u8); }
          const R = await htmlConRecursos(t, e.ruta, todosArch); m.texto = R.texto; payload.push('<script type="text/plain" id="o-' + id + '">' + b64txt(R.page) + '<\/script>'); }
        else {
          const x = ext(e.ruta); let R = null;
          if (x === '.docx') R = await OX.docxAHtml(u8, d.titulo); else if (x === '.pptx') R = await OX.pptxAHtml(u8, d.titulo);
          if (R && R.avisos && R.avisos.emf) aviso(e.ruta + ': ' + R.avisos.emf + ' imagen(es) en formato EMF/WMF que el navegador no puede mostrar (se ven como recuadro gris).'); else if (x === '.xlsx' || x === '.xlsm') R = await xlsxAHtml(u8, d.titulo);
          // el original de Word/Excel/PowerPoint no se copia dentro del portal (lo haría muy pesado): «Descargar original»
          // abre el archivo de la misma carpeta. Solo se incrusta si se marca la opción, o si no hay vista.
          if (opciones.originales || !R) payload.push('<script type="text/plain" id="o-' + id + '">' + b64(u8) + '<\/script>');
          if (R) { m.vista = 'html'; m.texto = R.texto.slice(0, 60000); if (!m.nota) m.nota = NOTA[tipo]; payload.push(vistaTxt('v-' + id, conFigtree(R.page))); }
          else { m.vista = 'none'; aviso(e.ruta + ': los formatos antiguos (.doc, .xls, .ppt) no se pueden ver en el navegador; queda para descargar. Guárdalo como .docx/.xlsx/.pptx para verlo.'); }
        }
      } catch (er) { tipo = m.tipo = 'error'; aviso(e.ruta + ': no se pudo convertir (' + er.message + ')'); }
    }
    meta.push(m);
  }
  const ahora = new Date(); const gen = fechaDe(ahora) + ' ' + String(ahora.getHours()).padStart(2, '0') + ':' + String(ahora.getMinutes()).padStart(2, '0');
  const titulo = opciones.titulo || (cfg && cfg.titulo) || nombreCarpeta;
  const html = PLANTILLA.split('__TITULO__').join(esc(titulo)).split('__FONTFACE__').join(FONTFACE).split('__FONT__').join(FONT)
    .split('__GENERADO__').join(gen).split('__SUBTITULO__').join(cfg && cfg.subtitulo ? '<em>' + esc(cfg.subtitulo) + '</em>' : '').split('__BUSCADOR__').join(cfg && !cfg.buscador ? ' hidden' : '').replace('__META__', () => JSON.stringify(meta).replace(/<\//g, '<\\/')).replace('__PAYLOAD__', () => payload.join('\n'));
  return {html, meta};
}

// ------------------------------------------------------------------ interfaz
const $ = s => document.querySelector(s);
function log(t, cls) { const p = document.createElement('div'); p.textContent = t; if (cls) p.className = cls; $('#log').appendChild(p); $('#log').scrollTop = 1e9; }
function progreso(i, n, ruta) { $('#barra').style.width = (i / n * 100).toFixed(0) + '%'; $('#estado').textContent = 'Convirtiendo ' + i + ' de ' + n + ': ' + ruta; log('· ' + ruta); }
async function leerCarpeta(h, pre) {
  const out = [];
  for await (const [nombre, hd] of h.entries()) {
    if (hd.kind === 'directory') { if (!nombre.startsWith('.') && !nombre.startsWith('_')) out.push(...await leerCarpeta(hd, pre + nombre + '/')); }
    else out.push({ruta: pre + nombre, file: await hd.getFile()});
  }
  return out;
}
let CARPETA = null, ENTRADAS = null, NOMBRE = '';
async function elegirCarpeta() {
  if (window.showDirectoryPicker) {
    try { CARPETA = await window.showDirectoryPicker({id: 'portal-documentos', mode: 'readwrite'}); }
    catch (er) { if (er.name !== 'AbortError') log('No se pudo abrir la carpeta: ' + er.message, 'av'); return; }
    NOMBRE = CARPETA.name; $('#log').innerHTML = ''; log('Leyendo «' + NOMBRE + '»…'); ENTRADAS = await leerCarpeta(CARPETA, ''); listo();
  } else $('#entrada').click();
}
function listo() {
  const n = ENTRADAS.filter(e => TIPOS[ext(e.ruta)] && !esConfig(e.ruta) && !esGenerador(e.ruta)).length;
  $('#carpeta').textContent = NOMBRE; $('#resumen').textContent = n + ' documento(s) encontrados en ' + ENTRADAS.length + ' archivo(s)';
  $('#titulo').value = NOMBRE; $('#bGenerar').disabled = !n; $('#bPlantilla').disabled = !n; $('#paso2').hidden = false; $('#paso1').classList.add('listo'); $('#paso2').classList.remove('listo');
  const cf = ENTRADAS.find(e => esConfig(e.ruta));
  if (cf) leerConfig(cf.file).then(c => { if (c.titulo) $('#titulo').value = c.titulo; $('#resumen').textContent += ' · configuración: ' + cf.ruta; }).catch(() => {});
}
async function guardar(nombre, contenido, tipo) {
  if (CARPETA) {
    try { if ((await CARPETA.queryPermission({mode: 'readwrite'})) !== 'granted') await CARPETA.requestPermission({mode: 'readwrite'});
      const fh = await CARPETA.getFileHandle(nombre, {create: true}); const w = await fh.createWritable(); await w.write(new Blob([contenido], {type: tipo})); await w.close();
      return 'carpeta'; } catch (er) { log('No se pudo guardar en la carpeta (' + er.message + '); se descargará.', 'av'); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([contenido], {type: tipo})); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  return 'descarga';
}
async function generar() {
  $('#bGenerar').disabled = true; $('#bElegir').disabled = true; $('#fin').hidden = true; $('#log').innerHTML = ''; const t0 = performance.now();
  try {
    const {html, meta} = await construir(ENTRADAS, NOMBRE, {titulo: $('#titulo').value.trim(), originales: $('#originales').checked});
    const nombre = NOMBRE + ' - Portal.html'; const donde = await guardar(nombre, html, 'text/html');
    const mb = new Blob([html]).size / 1e6; const disp = meta.filter(m => !['pendiente', 'error'].includes(m.tipo)).length;
    $('#estado').textContent = 'Listo en ' + ((performance.now() - t0) / 1000).toFixed(1) + ' s';
    $('#finTxt').innerHTML = '<b>' + esc(nombre) + '</b> ' + (donde === 'carpeta' ? 'se guardó en la carpeta «' + esc(NOMBRE) + '»' : 'se descargó (muévelo a la carpeta)') +
      '.<br>' + disp + ' documentos · ' + meta.filter(m => m.tipo === 'pendiente').length + ' pendientes · ' + mb.toFixed(1) + ' MB' + (AVISOS.length ? ' · <span class="av">' + AVISOS.length + ' aviso(s) en el registro</span>' : '');
    if (mb > 50) aviso('El portal pesa ' + mb.toFixed(0) + ' MB: puede tardar en abrir o no pasar por correo. Conviene dividir la carpeta.');
    $('#bAbrir').onclick = () => window.open(URL.createObjectURL(new Blob([html], {type: 'text/html'})), '_blank');
    $('#fin').hidden = false; $('#paso2').classList.add('listo'); window.__resultado = {html, meta, avisos: AVISOS};
  } catch (er) { log('Error: ' + er.message, 'av'); $('#estado').textContent = 'Hubo un error'; console.error(er); }
  $('#bGenerar').disabled = false; $('#bElegir').disabled = false;
}
async function plantilla() {
  const rutas = ENTRADAS.filter(e => TIPOS[ext(e.ruta)] && !e.ruta.split('/').some(p => p.startsWith('_') || p.startsWith('.'))).map(e => e.ruta).sort();
  const donde = await guardar('indice_plantilla.csv', plantillaCsv(rutas), 'text/csv');
  log('Plantilla del índice ' + (donde === 'carpeta' ? 'guardada en la carpeta' : 'descargada') + ': indice_plantilla.csv. Complétala en Excel y guárdala como indice.csv (o indice.xlsx) en la carpeta.');
}
window.addEventListener('DOMContentLoaded', () => {
  if (!('DecompressionStream' in window)) { $('#compat').hidden = false; }
  if (!window.showDirectoryPicker) $('#nota').textContent = 'Este navegador no permite guardar directamente en la carpeta: el portal se descargará y tendrás que moverlo. Usa Microsoft Edge o Google Chrome para guardarlo en la misma carpeta.';
  $('#bElegir').onclick = elegirCarpeta; $('#bGenerar').onclick = generar; $('#bPlantilla').onclick = plantilla;
  $('#entrada').onchange = ev => { const fs = [...ev.target.files]; if (!fs.length) return; CARPETA = null;
    NOMBRE = (fs[0].webkitRelativePath || fs[0].name).split('/')[0];
    ENTRADAS = fs.map(f => ({ruta: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, file: f})); $('#log').innerHTML = ''; listo(); };
});
window.__portal = {construir, MD, OX, modeloDe, paginasDrawio, drawioSvg, xlsxAHtml, leerXlsx, abrirZip};
