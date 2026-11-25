"""Conversores de Word y Excel para el portal de documentos (sin internet).

Estrategia:
  - Word (.docx/.doc): a PDF con Microsoft Office (Windows) o LibreOffice si están instalados (formato exacto);
    si no, .docx a HTML con un conversor propio (texto, títulos, listas, tablas e imágenes). Un .doc sin
    conversor solo queda para descargar.
  - PowerPoint (.pptx/.ppt): a PDF con Office o LibreOffice; si no, .pptx a HTML propio (diapositivas con
    textos, imágenes, formas con relleno y tablas en su posición). Un .ppt sin conversor solo queda para descargar.
  - Excel (.xlsx/.xlsm/.xls): a HTML con una pestaña por hoja (valores, combinadas, colores, anchos), con openpyxl.
    Opción --excel pdf: a PDF con Office o LibreOffice (incluye formato condicional y gráficos).
    Un .xls se pasa antes a .xlsx con Office/LibreOffice (o se lee con xlrd si está instalado).
"""
import base64, datetime as dt, html, mimetypes, os, pathlib, re, shutil, subprocess, sys, tempfile, zipfile
import xml.etree.ElementTree as ET

esc = html.escape
MAX_FILAS, MAX_COLS = 3000, 150

# ------------------------------------------------------------------ conversores externos
def _soffice():
    for c in ('soffice', 'libreoffice'):
        p = shutil.which(c)
        if p: return p
    for base in (os.environ.get('ProgramFiles', r'C:\Program Files'), os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')):
        p = pathlib.Path(base) / 'LibreOffice' / 'program' / 'soffice.exe'
        if p.exists(): return str(p)
    return None

def _ps(script, timeout=300):
    r = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
                       capture_output=True, text=True, timeout=timeout)
    return r.returncode == 0

def _office_disponible(app):
    if sys.platform != 'win32' or not shutil.which('powershell'): return False
    try:
        return _ps(f"$o=New-Object -ComObject {app}.Application; $o.Quit()", timeout=60)
    except Exception:
        return False

class Conversor:
    """Detecta (una sola vez) qué conversor externo hay: 'office', 'libreoffice' o None."""
    def __init__(self, preferencia='auto'):
        self.pref = preferencia; self._cache = {}
    def _tiene(self, cual):
        if cual not in self._cache:
            if cual == 'libreoffice': self._cache[cual] = _soffice()
            else: self._cache[cual] = _office_disponible(cual)   # 'Word' o 'Excel'
        return self._cache[cual]
    def nombre(self, app):
        if self.pref in ('ninguno', 'none'): return None
        if self.pref in ('auto', 'office') and self._tiene(app): return 'office'
        if self.pref in ('auto', 'libreoffice') and self._tiene('libreoffice'): return 'libreoffice'
        return None

    def a_pdf(self, ruta, app):
        """Devuelve los bytes del PDF o None."""
        quien = self.nombre(app)
        if not quien: return None
        tmp = pathlib.Path(tempfile.mkdtemp())
        out = tmp / (ruta.stem + '.pdf')
        try:
            if quien == 'office':
                src, dst = str(ruta.resolve()).replace("'", "''"), str(out).replace("'", "''")
                if app == 'PowerPoint':
                    ok = _ps(f"$p=New-Object -ComObject PowerPoint.Application; "
                             f"try {{ $d=$p.Presentations.Open('{src}', -1, 0, 0); $d.SaveAs('{dst}', 32); $d.Close() }} finally {{ $p.Quit() }}")
                elif app == 'Word':
                    ok = _ps(f"$w=New-Object -ComObject Word.Application; $w.Visible=$false; $w.DisplayAlerts=0; "
                             f"try {{ $d=$w.Documents.Open('{src}', $false, $true); $d.ExportAsFixedFormat('{dst}', 17); $d.Close(0) }} finally {{ $w.Quit() }}")
                else:
                    ok = _ps(f"$x=New-Object -ComObject Excel.Application; $x.Visible=$false; $x.DisplayAlerts=$false; "
                             f"try {{ $b=$x.Workbooks.Open('{src}', 0, $true); $b.ExportAsFixedFormat(0, '{dst}'); $b.Close($false) }} finally {{ $x.Quit() }}")
            else:
                r = subprocess.run([self._tiene('libreoffice'), '--headless', '--convert-to', 'pdf', '--outdir', str(tmp), str(ruta)],
                                   capture_output=True, timeout=300)
                ok = r.returncode == 0
            return out.read_bytes() if ok and out.exists() else None
        except Exception:
            return None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def xls_a_xlsx(self, ruta):
        """Convierte un .xls antiguo a .xlsx temporal; devuelve la ruta o None."""
        quien = self.nombre('Excel')
        if not quien: return None
        tmp = pathlib.Path(tempfile.mkdtemp())
        out = tmp / (ruta.stem + '.xlsx')
        try:
            if quien == 'office':
                src, dst = str(ruta.resolve()).replace("'", "''"), str(out).replace("'", "''")
                _ps(f"$x=New-Object -ComObject Excel.Application; $x.Visible=$false; $x.DisplayAlerts=$false; "
                    f"try {{ $b=$x.Workbooks.Open('{src}', 0, $true); $b.SaveAs('{dst}', 51); $b.Close($false) }} finally {{ $x.Quit() }}")
            else:
                subprocess.run([self._tiene('libreoffice'), '--headless', '--convert-to', 'xlsx', '--outdir', str(tmp), str(ruta)],
                               capture_output=True, timeout=300)
            return out if out.exists() else None
        except Exception:
            return None

# ------------------------------------------------------------------ Word (.docx) → HTML propio
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
PR = '{http://schemas.openxmlformats.org/package/2006/relationships}'

def docx_a_html(ruta, titulo):
    z = zipfile.ZipFile(ruta)
    doc = ET.fromstring(z.read('word/document.xml'))
    rels = {}
    if 'word/_rels/document.xml.rels' in z.namelist():
        for r in ET.fromstring(z.read('word/_rels/document.xml.rels')).iter(PR + 'Relationship'):
            rels[r.get('Id')] = r.get('Target')
    nombres = {}
    if 'word/styles.xml' in z.namelist():
        for s in ET.fromstring(z.read('word/styles.xml')).iter(W + 'style'):
            n = s.find(W + 'name')
            nombres[s.get(W + 'styleId')] = (n.get(W + 'val') if n is not None else '').lower()
    textos = []

    def imagen(rid):
        t = rels.get(rid)
        if not t: return ''
        p = ('word/' + t) if not t.startswith('/') else t[1:]
        p = os.path.normpath(p).replace('\\', '/')
        if p not in z.namelist(): return ''
        mime = mimetypes.guess_type(p)[0] or 'image/png'
        return f'<img src="data:{mime};base64,{base64.b64encode(z.read(p)).decode()}" alt="">'

    def runs(el):
        out = []
        for r in el.iter():
            if r.tag == W + 'r':
                pr = r.find(W + 'rPr'); st = []
                if pr is not None:
                    if pr.find(W + 'b') is not None and pr.find(W + 'b').get(W + 'val') not in ('0', 'false'): st.append('font-weight:700')
                    if pr.find(W + 'i') is not None and pr.find(W + 'i').get(W + 'val') not in ('0', 'false'): st.append('font-style:italic')
                    if pr.find(W + 'u') is not None and pr.find(W + 'u').get(W + 'val') not in ('none', None): st.append('text-decoration:underline')
                    c = pr.find(W + 'color')
                    if c is not None and re.fullmatch(r'[0-9A-Fa-f]{6}', c.get(W + 'val') or ''): st.append('color:#' + c.get(W + 'val'))
                    hl = pr.find(W + 'highlight')
                    if hl is not None and hl.get(W + 'val') not in (None, 'none'): st.append('background:#fff3a0')
                parts = []
                for ch in r:
                    if ch.tag == W + 't': parts.append(esc(ch.text or '')); textos.append(ch.text or '')
                    elif ch.tag == W + 'tab': parts.append('&emsp;')
                    elif ch.tag in (W + 'br', W + 'cr'): parts.append('<br>')
                    elif ch.tag == W + 'drawing' or ch.tag.endswith('pict'):
                        for b in ch.iter(A + 'blip'):
                            parts.append(imagen(b.get(R + 'embed')))
                        for b in ch.iter():
                            if b.tag.endswith('imagedata') and b.get(R + 'id'): parts.append(imagen(b.get(R + 'id')))
                s = ''.join(parts)
                if s: out.append(f'<span style="{";".join(st)}">{s}</span>' if st else s)
        return ''.join(out)

    def parrafo(p):
        pr = p.find(W + 'pPr'); tag, st, lista = 'p', [], False
        if pr is not None:
            ps = pr.find(W + 'pStyle')
            if ps is not None:
                nm = nombres.get(ps.get(W + 'val'), ps.get(W + 'val', '').lower())
                m = re.search(r'(?:heading|t[ií]tulo)\s*(\d)', nm)
                if m: tag = 'h' + str(min(int(m.group(1)) + 1, 6))
                elif nm in ('title', 'título', 'titulo'): tag = 'h1'
                elif 'list' in nm or 'lista' in nm: lista = True
            jc = pr.find(W + 'jc')
            if jc is not None and jc.get(W + 'val') in ('center', 'right', 'both'):
                st.append('text-align:' + {'both': 'justify'}.get(jc.get(W + 'val'), jc.get(W + 'val')))
            if pr.find(W + 'numPr') is not None: lista = True
            sh = pr.find(W + 'shd')
            if sh is not None and re.fullmatch(r'[0-9A-Fa-f]{6}', sh.get(W + 'fill') or ''): st.append('background:#' + sh.get(W + 'fill'))
        cont = runs(p)
        if not cont.strip() and tag == 'p': cont = '&nbsp;'
        sty = f' style="{";".join(st)}"' if st else ''
        return ('li', f'<li{sty}>{cont}</li>') if lista else (tag, f'<{tag}{sty}>{cont}</{tag}>')

    def tabla(t):
        filas = t.findall(W + 'tr'); grid = []
        for tr in filas:
            fila, col = [], 0
            for tc in tr.findall(W + 'tc'):
                pr = tc.find(W + 'tcPr'); span, vm, bg = 1, None, ''
                if pr is not None:
                    gs = pr.find(W + 'gridSpan'); span = int(gs.get(W + 'val')) if gs is not None else 1
                    v = pr.find(W + 'vMerge')
                    if v is not None: vm = v.get(W + 'val') or 'continue'
                    sh = pr.find(W + 'shd')
                    if sh is not None and re.fullmatch(r'[0-9A-Fa-f]{6}', sh.get(W + 'fill') or ''): bg = sh.get(W + 'fill')
                fila.append(dict(col=col, span=span, vm=vm, bg=bg, html=cuerpo(tc), rows=1)); col += span
            grid.append(fila)
        for i, fila in enumerate(grid):   # rowspan de celdas combinadas verticalmente
            for c in fila:
                if c['vm'] == 'restart':
                    k = i + 1
                    while k < len(grid) and any(x['col'] == c['col'] and x['vm'] == 'continue' for x in grid[k]):
                        c['rows'] += 1; k += 1
        out = ['<table>']
        for fila in grid:
            out.append('<tr>')
            for c in fila:
                if c['vm'] == 'continue': continue
                a = (f' colspan="{c["span"]}"' if c['span'] > 1 else '') + (f' rowspan="{c["rows"]}"' if c['rows'] > 1 else '') + (f' style="background:#{c["bg"]}"' if c['bg'] else '')
                out.append(f'<td{a}>{c["html"]}</td>')
            out.append('</tr>')
        return ''.join(out) + '</table>'

    def cuerpo(el):
        out, en_lista = [], False
        for ch in el:
            if ch.tag == W + 'p':
                tag, h = parrafo(ch)
                if tag == 'li' and not en_lista: out.append('<ul>'); en_lista = True
                if tag != 'li' and en_lista: out.append('</ul>'); en_lista = False
                out.append(h)
            elif ch.tag == W + 'tbl':
                if en_lista: out.append('</ul>'); en_lista = False
                out.append(tabla(ch))
            elif ch.tag == W + 'sdt':
                c = ch.find(W + 'sdtContent')
                if c is not None: out.append(cuerpo(c))
        if en_lista: out.append('</ul>')
        return ''.join(out)

    body = cuerpo(doc.find(W + 'body'))
    page = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{esc(titulo)}</title><style>'
            "body{margin:0;background:#e9ecf2;font-family:Figtree,Calibri,'Segoe UI',system-ui,sans-serif;color:#1f2433;font-size:11pt;line-height:1.45}"
            '.hoja{max-width:820px;margin:24px auto;background:#fff;padding:56px 64px;box-shadow:0 1px 4px #0002}'
            'h1,h2,h3,h4{color:#1d2a4a;line-height:1.25;margin:1.1em 0 .4em}p{margin:0 0 .5em}'
            'table{border-collapse:collapse;width:100%;margin:.6em 0 1em}td{border:1px solid #c9cdd6;padding:4px 7px;vertical-align:top}'
            'td p{margin:0}img{max-width:100%;height:auto}ul{margin:0 0 .6em 1.2em;padding:0}'
            f'</style></head><body><div class="hoja">{body}</div></body></html>')
    return page, ' '.join(textos)

# ------------------------------------------------------------------ Excel → HTML (una pestaña por hoja)
def _color(c):
    try:
        if c is not None and c.type == 'rgb' and isinstance(c.rgb, str) and len(c.rgb) == 8 and c.rgb not in ('00000000',):
            return '#' + c.rgb[2:]
    except Exception:
        pass
    return None

def _valor(v, fmt):
    if v is None: return ''
    if fmt == ';;;': return ''
    if isinstance(v, dt.datetime):
        return v.strftime('%d-%m-%Y %H:%M') if (v.hour or v.minute) else v.strftime('%d-%m-%Y')
    if isinstance(v, (dt.date, dt.time)): return v.strftime('%d-%m-%Y') if isinstance(v, dt.date) else v.strftime('%H:%M')
    if isinstance(v, bool): return 'VERDADERO' if v else 'FALSO'
    if isinstance(v, (int, float)):
        f = fmt or 'General'
        dec = len(re.search(r'0\.(0+)', f).group(1)) if re.search(r'0\.(0+)', f) else None
        if '%' in f:
            return f'{v * 100:,.{dec or 0}f}%'.replace(',', ' ')
        if dec is not None or '#,##0' in f or f in ('0', '#,##0'):
            s = f'{v:,.{dec or 0}f}'
            return s.replace(',', ' ') if '#,##0' in f else s.replace(',', '')
        if float(v).is_integer(): return str(int(v))
        return f'{v:.6g}'
    return str(v)

def xlsx_a_html(ruta, titulo):
    """Devuelve (html, texto, aviso) o lanza ImportError si falta openpyxl."""
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter
    wb = load_workbook(ruta, data_only=True)
    hojas, textos, cortes = [], [], []
    for ws in wb.worksheets:
        if ws.sheet_state != 'visible': continue
        mr, mc = min(ws.max_row, MAX_FILAS), min(ws.max_column, MAX_COLS)
        if ws.max_row > MAX_FILAS or ws.max_column > MAX_COLS: cortes.append(ws.title)
        span, oculto = {}, set()
        for rg in ws.merged_cells.ranges:
            span[(rg.min_row, rg.min_col)] = (rg.max_row - rg.min_row + 1, rg.max_col - rg.min_col + 1)
            for r in range(rg.min_row, rg.max_row + 1):
                for c in range(rg.min_col, rg.max_col + 1):
                    if (r, c) != (rg.min_row, rg.min_col): oculto.add((r, c))
        cols_vis = [c for c in range(1, mc + 1) if not ws.column_dimensions[get_column_letter(c)].hidden]
        filas_vis = [r for r in range(1, mr + 1) if not ws.row_dimensions[r].hidden]
        o = ['<table><colgroup><col style="width:38px">']
        for c in cols_vis:
            w = ws.column_dimensions[get_column_letter(c)].width or 8.43
            o.append(f'<col style="width:{int(w * 7 + 5)}px">')
        o.append('</colgroup><thead><tr><th></th>' + ''.join(f'<th>{get_column_letter(c)}</th>' for c in cols_vis) + '</tr></thead><tbody>')
        for r in filas_vis:
            h = ws.row_dimensions[r].height
            o.append(f'<tr{f" style=\"height:{h * 1.33:.0f}px\"" if h else ""}><th>{r}</th>')
            for c in cols_vis:
                if (r, c) in oculto: continue
                cell = ws.cell(r, c)
                txt = _valor(cell.value, cell.number_format)
                if txt: textos.append(txt)
                st = []
                f = cell.font
                if f is not None:
                    if f.b: st.append('font-weight:700')
                    if f.i: st.append('font-style:italic')
                    col = _color(f.color)
                    if col and col.lower() != '#000000': st.append('color:' + col)
                    if f.sz and abs(f.sz - 11) > 0.5: st.append(f'font-size:{f.sz:g}pt')
                fl = cell.fill
                if fl is not None and fl.fill_type == 'solid':
                    bg = _color(fl.fgColor) or _color(fl.start_color)
                    if bg: st.append('background:' + bg)
                al = cell.alignment
                if al is not None:
                    if al.horizontal in ('center', 'right', 'left', 'centerContinuous'): st.append('text-align:' + ('center' if al.horizontal == 'centerContinuous' else al.horizontal))
                    elif isinstance(cell.value, (int, float)) and not isinstance(cell.value, bool): st.append('text-align:right')
                    if al.wrap_text: st.append('white-space:normal')
                    if al.vertical in ('top', 'center'): st.append('vertical-align:' + ('middle' if al.vertical == 'center' else 'top'))
                rs, cs = span.get((r, c), (1, 1))
                cs_v = sum(1 for k in range(c, c + cs) if k in cols_vis) if cs > 1 else 1
                rs_v = sum(1 for k in range(r, r + rs) if k in filas_vis) if rs > 1 else 1
                a = (f' rowspan="{rs_v}"' if rs_v > 1 else '') + (f' colspan="{cs_v}"' if cs_v > 1 else '') + (f' style="{";".join(st)}"' if st else '')
                o.append(f'<td{a}>{esc(txt)}</td>')
            o.append('</tr>')
        o.append('</tbody></table>')
        hojas.append((ws.title, ''.join(o)))
    tabs = ''.join(f'<button data-h="{k}"{" aria-selected=true" if k == 0 else ""}>{esc(n)}</button>' for k, (n, _) in enumerate(hojas))
    cuerpos = ''.join(f'<div class="h" id="h{k}"{"" if k == 0 else " hidden"}>{t}</div>' for k, (_, t) in enumerate(hojas))
    page = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{esc(titulo)}</title><style>'
            "body{margin:0;font-family:Figtree,Calibri,'Segoe UI',system-ui,sans-serif;font-size:11pt;color:#1f2433;background:#fff}"
            '.tabs{position:sticky;top:0;z-index:3;display:flex;gap:2px;flex-wrap:wrap;background:#e9ecf2;padding:6px 6px 0;border-bottom:1px solid #c9cdd6}'
            '.tabs button{font:inherit;font-size:12px;border:1px solid #c9cdd6;border-bottom:0;background:#f6f7f9;padding:5px 12px;border-radius:6px 6px 0 0;cursor:pointer}'
            '.tabs button[aria-selected=true]{background:#fff;color:#217346;font-weight:700}'
            '[hidden]{display:none!important}.h{overflow:auto}'
            'table{border-collapse:collapse;table-layout:fixed;width:max-content}'
            'td,th{border:1px solid #dde1e7;padding:1px 4px;white-space:nowrap;overflow:hidden;text-overflow:clip;vertical-align:bottom;height:20px}'
            'th{background:#f3f4f6;color:#6b7280;font-weight:400;font-size:10px;text-align:center;position:sticky;top:0}'
            'tbody th{position:sticky;left:0;z-index:1}'
            f'</style></head><body><div class="tabs">{tabs}</div>{cuerpos}'
            '<script>document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.removeAttribute("aria-selected"));'
            'b.setAttribute("aria-selected","true");document.querySelectorAll(".h").forEach((h,i)=>h.hidden=i!=+b.dataset.h)})</script></body></html>')
    aviso = f'hojas recortadas a {MAX_FILAS} filas × {MAX_COLS} columnas: {", ".join(cortes)}' if cortes else ''
    return page, ' '.join(textos), aviso

def xls_con_xlrd(ruta, titulo):
    """Lectura básica de .xls antiguo con xlrd (solo valores)."""
    import xlrd
    bk = xlrd.open_workbook(str(ruta))
    hojas, textos = [], []
    for sh in bk.sheets():
        o = ['<table>']
        for r in range(min(sh.nrows, MAX_FILAS)):
            o.append('<tr>' + ''.join(f'<td>{esc(str(v))}</td>' for v in sh.row_values(r)[:MAX_COLS]) + '</tr>')
            textos += [str(v) for v in sh.row_values(r) if v not in ('', None)]
        hojas.append((sh.name, ''.join(o) + '</table>'))
    tabs = ''.join(f'<h3>{esc(n)}</h3>{t}' for n, t in hojas)
    page = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{esc(titulo)}</title><style>'
            "body{font-family:Figtree,Calibri,'Segoe UI',system-ui,sans-serif;font-size:11pt;margin:12px}table{border-collapse:collapse}td{border:1px solid #dde1e7;padding:2px 5px;white-space:nowrap}"
            f'</style></head><body>{tabs}</body></html>')
    return page, ' '.join(textos)


# ------------------------------------------------------------------ PowerPoint (.pptx) → HTML propio
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'

def _rels(z, parte):
    d = os.path.dirname(parte); rp = f'{d}/_rels/{os.path.basename(parte)}.rels'
    out = {}
    if rp in z.namelist():
        for r in ET.fromstring(z.read(rp)).iter(PR + 'Relationship'):
            t = r.get('Target')
            out[r.get('Id')] = t if r.get('TargetMode') == 'External' else os.path.normpath(os.path.join(d, t)).replace('\\', '/')
    return out

def _xfrm(el):
    x = el.find('.//' + A + 'xfrm')
    if x is None:
        x = el.find('.//' + P + 'xfrm')
    if x is None: return None
    off, ext = x.find(A + 'off'), x.find(A + 'ext')
    if off is None or ext is None: return None
    r = [int(off.get('x')), int(off.get('y')), int(ext.get('cx')), int(ext.get('cy'))]
    co, ce = x.find(A + 'chOff'), x.find(A + 'chExt')
    if co is not None and ce is not None:
        r += [int(co.get('x')), int(co.get('y')), int(ce.get('cx')) or 1, int(ce.get('cy')) or 1]
    return r

def _rgb(el):
    if el is None: return None
    c = el.find(A + 'srgbClr')
    return '#' + c.get('val') if c is not None and re.fullmatch(r'[0-9A-Fa-f]{6}', c.get('val') or '') else None

def pptx_a_html(ruta, titulo):
    z = zipfile.ZipFile(ruta); textos = []
    pres = ET.fromstring(z.read('ppt/presentation.xml'))
    sz = pres.find(P + 'sldSz'); W_, H_ = (int(sz.get('cx')), int(sz.get('cy'))) if sz is not None else (12192000, 6858000)
    prels = _rels(z, 'ppt/presentation.xml')
    orden = [prels[s_.get(R + 'id')] for s_ in pres.iter(P + 'sldId') if s_.get(R + 'id') in prels]

    def img(rels, rid):
        t = rels.get(rid)
        if not t or t not in z.namelist(): return None
        mime = mimetypes.guess_type(t)[0] or 'image/png'
        if mime in ('image/x-emf', 'image/x-wmf', 'image/emf', 'image/wmf'): return None
        return f'data:{mime};base64,' + base64.b64encode(z.read(t)).decode()

    def texto(tx):
        out = []
        for p_ in tx.findall(A + 'p'):
            al = p_.find(A + 'pPr'); algn = {'ctr': 'center', 'r': 'right', 'just': 'justify'}.get(al.get('algn') if al is not None else None, 'left')
            bullet = al is not None and al.find(A + 'buNone') is None and (al.get('lvl') is not None or al.find(A + 'buChar') is not None)
            runs = []
            for r_ in p_:
                if r_.tag == A + 'br': runs.append('<br>'); continue
                if r_.tag not in (A + 'r', A + 'fld'): continue
                t = ''.join(x.text or '' for x in r_.iter(A + 't'))
                if not t: continue
                textos.append(t)
                pr = r_.find(A + 'rPr'); st = []
                if pr is not None:
                    if pr.get('b') == '1': st.append('font-weight:700')
                    if pr.get('i') == '1': st.append('font-style:italic')
                    if pr.get('sz'): st.append(f'font-size:{int(pr.get("sz")) / 100 * 1.333:.1f}px')
                    c = _rgb(pr.find(A + 'solidFill'))
                    if c: st.append('color:' + c)
                runs.append(f'<span style="{";".join(st)}">{esc(t)}</span>' if st else esc(t))
            cont = ''.join(runs)
            out.append(f'<p style="text-align:{algn}">{"• " if bullet and cont else ""}{cont or "&nbsp;"}</p>')
        return ''.join(out)

    def tabla(tbl):
        o = ['<table>']
        for tr in tbl.iter(A + 'tr'):
            o.append('<tr>')
            for tc in tr.findall(A + 'tc'):
                if tc.get('hMerge') == '1' or tc.get('vMerge') == '1': continue
                a = (f' colspan="{tc.get("gridSpan")}"' if tc.get('gridSpan') else '') + (f' rowspan="{tc.get("rowSpan")}"' if tc.get('rowSpan') else '')
                bg = _rgb(tc.find(A + 'tcPr/' + A + 'solidFill')) if tc.find(A + 'tcPr') is not None else None
                tx = tc.find(A + 'txBody')
                o.append(f'<td{a}{f" style=\"background:{bg}\"" if bg else ""}>{texto(tx) if tx is not None else ""}</td>')
            o.append('</tr>')
        return ''.join(o) + '</table>'

    def formas(arbol, rels, tr, sin_pos):
        out = []
        for el in arbol:
            tag = el.tag.split('}')[1]
            if tag not in ('sp', 'pic', 'grpSp', 'graphicFrame', 'cxnSp'): continue
            xf = _xfrm(el)
            if xf:
                x, y, w, h = tr(*xf[:4])
            else:   # marcador sin posición propia (hereda del diseño): se apila
                x, y, w, h = 0.06 * W_, sin_pos[0], 0.88 * W_, 0.14 * H_; sin_pos[0] += 0.16 * H_
            box = f'left:{x / W_ * 100:.3f}%;top:{y / H_ * 100:.3f}%;width:{w / W_ * 100:.3f}%;height:{h / H_ * 100:.3f}%'
            if tag == 'grpSp' and xf and len(xf) == 8:
                gx, gy, gw, gh, cx0, cy0, cw, ch = xf
                X, Y, Wg, Hg = tr(gx, gy, gw, gh)
                sub = lambda a, b, c, d, X=X, Y=Y, Wg=Wg, Hg=Hg: (X + (a - cx0) * Wg / cw, Y + (b - cy0) * Hg / ch, c * Wg / cw, d * Hg / ch)
                out.append(formas(el, rels, sub, sin_pos))
            elif tag == 'pic':
                b = el.find('.//' + A + 'blip'); u = img(rels, b.get(R + 'embed')) if b is not None else None
                out.append(f'<img class="f" style="{box}" src="{u}" alt="">' if u else f'<div class="f nd" style="{box}">imagen</div>')
            elif tag == 'graphicFrame':
                t = el.find('.//' + A + 'tbl')
                if t is not None: out.append(f'<div class="f" style="{box}">{tabla(t)}</div>')
            elif tag == 'sp':
                sp = el.find(P + 'spPr'); st = []
                if sp is not None:
                    bg = _rgb(sp.find(A + 'solidFill'))
                    if bg: st.append('background:' + bg)
                    ln = sp.find(A + 'ln')
                    lc = _rgb(ln.find(A + 'solidFill')) if ln is not None else None
                    if lc: st.append('border:1px solid ' + lc)
                    geo = sp.find(A + 'prstGeom')
                    if geo is not None and geo.get('prst') == 'ellipse': st.append('border-radius:50%')
                    if geo is not None and geo.get('prst') == 'roundRect': st.append('border-radius:8px')
                tx = el.find(P + 'txBody')
                anc = tx.find(A + 'bodyPr').get('anchor') if tx is not None and tx.find(A + 'bodyPr') is not None else None
                st.append('justify-content:' + {'ctr': 'center', 'b': 'flex-end'}.get(anc, 'flex-start'))
                ph = el.find('.//' + P + 'ph')
                cls = ' tit' if ph is not None and ph.get('type') in ('title', 'ctrTitle') else ''
                out.append(f'<div class="f t{cls}" style="{box};{";".join(st)}">{texto(tx) if tx is not None else ""}</div>')
        return ''.join(out)

    slides = []
    for k, parte in enumerate(orden, 1):
        sx = ET.fromstring(z.read(parte)); rels = _rels(z, parte)
        tree = sx.find(f'{P}cSld/{P}spTree')
        bg = _rgb(sx.find(f'.//{P}bg//{A}solidFill')) if sx.find(f'.//{P}bg') is not None else None
        cont = formas(tree, rels, lambda a, b, c, d: (a, b, c, d), [0.05 * H_]) if tree is not None else ''
        slides.append(f'<section class="s" style="aspect-ratio:{W_}/{H_};{f"background:{bg}" if bg else ""}"><span class="n">{k}</span>{cont}</section>')
    page = (f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{esc(titulo)}</title><style>'
            "body{margin:0;background:#3a3f4b;font-family:Figtree,Calibri,'Segoe UI',system-ui,sans-serif;color:#1f2433;padding:20px}"
            '.s{position:relative;max-width:1100px;margin:0 auto 22px;background:#fff;box-shadow:0 2px 10px #0006;overflow:hidden;container-type:inline-size}'
            '.n{position:absolute;right:10px;bottom:6px;font-size:11px;color:#8a90a0;z-index:5}'
            '.f{position:absolute;box-sizing:border-box;overflow:hidden}.f.t{display:flex;flex-direction:column;padding:.4cqw .8cqw;font-size:1.5cqw;line-height:1.2}'
            '.f.t p{margin:0 0 .3em}.f.tit{font-size:2.8cqw;font-weight:700;color:#1d2a4a}img.f{object-fit:contain}'
            '.nd{border:1px dashed #9aa1ae;color:#9aa1ae;display:flex;align-items:center;justify-content:center;font-size:1cqw}'
            'table{border-collapse:collapse;width:100%;font-size:1.2cqw}td{border:1px solid #c9cdd6;padding:.3cqw .5cqw;vertical-align:top}td p{margin:0}'
            f'</style></head><body>{"".join(slides)}</body></html>')
    return page, ' '.join(textos)
