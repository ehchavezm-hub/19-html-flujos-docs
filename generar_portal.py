#!/usr/bin/env python3
r"""Portal de documentos: convierte TODOS los archivos de una carpeta en UN SOLO archivo HTML, que se guarda
en esa misma carpeta y funciona sin internet (fuente Figtree incrustada).

Formatos: .drawio, .pdf, .html, Word (.docx/.doc), Excel (.xlsx/.xlsm/.xls) y PowerPoint (.pptx/.ppt).
  - Menú por carpetas: cada subcarpeta es una sección; los archivos sueltos van a «General».
  - Índice opcional (indice.xlsx o indice.csv en la carpeta): título, sección, orden, revisión, responsable,
    fecha, estado y nota. Las filas sin archivo aparecen como «Pendiente».
  - drawio: motor propio (motor_drawio.py) con páginas, zoom, arrastre y paso a paso.
  - Word y PowerPoint: a PDF con Microsoft Office o LibreOffice si están instalados; si no, vista HTML propia.
  - Excel: tablas por hoja (openpyxl). PDF: visor del navegador. HTML: aislado, con sus recursos incrustados.
  - Cada documento se puede descargar en su formato original desde el portal.

Uso (Windows): doble clic en generar_portal.bat y elegir la carpeta, o arrastrar la carpeta sobre el .bat.
    python generar_portal.py "C:\ruta\carpeta" [--titulo "..."] [--abrir]
    python generar_portal.py "C:\ruta\carpeta" --plantilla     # crea indice_plantilla.csv
Requiere Python 3. Opcional: openpyxl (Excel e indice.xlsx), pypdf (buscar dentro de PDF), xlrd (.xls sin Office).
"""
import argparse, base64, csv, datetime as dt, html, io, json, mimetypes, pathlib, re, sys, unicodedata

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import motor_drawio as MD  # noqa: E402
import conversores_office as CO  # noqa: E402

TIPOS = {'.drawio': 'drawio', '.pdf': 'pdf', '.html': 'html', '.htm': 'html',
         '.docx': 'word', '.doc': 'word', '.pptx': 'ppt', '.ppt': 'ppt', '.xlsx': 'excel', '.xlsm': 'excel', '.xls': 'excel'}
MIME_EXT = {'.drawio': 'application/xml', '.pdf': 'application/pdf', '.html': 'text/html', '.htm': 'text/html',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt': 'application/vnd.ms-powerpoint',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12', '.xls': 'application/vnd.ms-excel'}
NOTA_EXCEL = 'Vista simplificada del Excel: valores, colores y celdas combinadas; no incluye formato condicional ni gráficos. Descarga el original para verlo completo.'
CAMPOS = ['archivo', 'titulo', 'seccion', 'orden', 'revision', 'responsable', 'fecha', 'estado', 'nota']
FONT = "Figtree, 'Segoe UI', system-ui, -apple-system, sans-serif"
esc = html.escape
AVISOS = []
GENERADOR = 'portal-documentos'
_TTF = HERE / 'fuentes' / 'Figtree-VariableFont_wght.ttf'
FONTFACE = ("@font-face{font-family:'Figtree';font-style:normal;font-weight:300 900;font-display:swap;"
            f"src:url(data:font/ttf;base64,{base64.b64encode(_TTF.read_bytes()).decode()}) format('truetype')}}") if _TTF.exists() else ''

def con_figtree(page, forzar=True):
    """Incrusta Figtree en un HTML (vista dentro del portal) para que se vea sin internet."""
    if not FONTFACE: return page
    css = '<style>' + FONTFACE + ("html,body{font-family:Figtree,'Segoe UI',system-ui,sans-serif}" if forzar else '') + '</style>'
    m = re.search(r'(?i)<head[^>]*>', page)
    return page[:m.end()] + css + page[m.end():] if m else css + page

def aviso(msg):
    AVISOS.append(msg); print('  ! ' + msg)

def clave(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '', s)

def titulo_de(nombre):
    t = re.sub(r'[_]+', ' ', pathlib.Path(nombre).stem)
    return re.sub(r'\s+', ' ', t).strip()

# ------------------------------------------------------------------ índice opcional
def leer_indice(ruta):
    filas = []
    if ruta.suffix.lower() == '.xlsx':
        try:
            from openpyxl import load_workbook
        except ImportError:
            aviso(f'Para leer {ruta.name} hace falta openpyxl (pip install openpyxl). Guarda el índice como CSV o instálalo.')
            return []
        ws = load_workbook(ruta, data_only=True).active
        datos = [[c for c in fila] for fila in ws.iter_rows(values_only=True)]
    else:
        crudo = ruta.read_bytes()
        for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
            try:
                texto = crudo.decode(enc); break
            except UnicodeDecodeError:
                continue
        try:
            dialecto = csv.Sniffer().sniff(texto.splitlines()[0], delimiters=';,\t')
        except Exception:
            dialecto = csv.excel; dialecto.delimiter = ';'
        datos = list(csv.reader(io.StringIO(texto), dialecto))
    if not datos: return []
    cab = [clave(h) for h in datos[0]]
    for fila in datos[1:]:
        if not any(v not in (None, '') for v in fila): continue
        d = {}
        for h, v in zip(cab, fila):
            if h in CAMPOS:
                if isinstance(v, (dt.datetime, dt.date)): v = v.strftime('%d-%m-%Y')
                d[h] = '' if v is None else str(v).strip()
        filas.append(d)
    return filas

def escribir_plantilla(docs_dir, archivos):
    out = docs_dir / 'indice_plantilla.csv'
    with out.open('w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(['Archivo', 'Titulo', 'Seccion', 'Orden', 'Revision', 'Responsable', 'Fecha', 'Estado', 'Nota'])
        for k, p in enumerate(archivos, 1):
            rel = p.relative_to(docs_dir).as_posix()
            sec = rel.split('/')[0] if '/' in rel else 'General'
            w.writerow([rel, titulo_de(p.name), sec, k, '', '', '', '', ''])
        w.writerow(['', 'Ejemplo de documento pendiente', 'Documentos de gestión', 99, '', '', '', 'Pendiente', 'Fila sin archivo = aparece como pendiente'])
    print(f'Plantilla creada: {out}\nRenómbrala a indice.csv (o pásala a indice.xlsx), complétala y vuelve a generar el portal.')

# ------------------------------------------------------------------ contenido por tipo
def b64(data):
    return base64.b64encode(data).decode()

def texto_de_svg(svg):
    return ' '.join(html.unescape(t) for t in re.findall(r'<text\b[^>]*>([^<]*)</text>', svg))

def preparar_drawio(p, n):
    paginas, textos = [], []
    try:
        lista = MD.leer_paginas(p)
    except Exception as e:
        aviso(f'{p.name}: no se pudo leer ({e})'); return None
    for k, (nombre, xml) in enumerate(lista, 1):
        try:
            R = MD.svg_de_pagina(p, nombre, xml, f'd{n}p{k}')
        except Exception as e:
            aviso(f'{p.name} · página «{nombre}»: no se pudo dibujar ({e})'); continue
        svg = re.sub(r'font-family="[^"]*"', f'font-family="{FONT}"', R['svg'])
        svg = re.sub(r"font-family='[^']*'", f"font-family=\"{FONT}\"", svg)
        if 'IMAGEN NO DISPONIBLE' in svg:
            aviso(f'{p.name} · «{nombre}»: hay imágenes enlazadas que no se pudieron incrustar (URL externa o archivo no encontrado)')
        paginas.append(dict(nombre=nombre, svg=svg, w=R['VW'], h=R['VH'], pasos=R['steps']))
        textos.append(nombre + ' ' + texto_de_svg(svg))
    if not paginas: return None
    return dict(paginas=paginas, texto=' '.join(textos))

def preparar_pdf(p):
    data = p.read_bytes(); texto = ''
    try:
        from pypdf import PdfReader
        r = PdfReader(io.BytesIO(data))
        texto = ' '.join((pg.extract_text() or '') for pg in r.pages[:60])
    except Exception:
        pass
    return dict(datos=b64(data), texto=texto[:60000])

def _data_uri(base, ref):
    if re.match(r'(?i)(https?:|data:|#|mailto:|javascript:)', ref): return None
    f = (base / ref.split('#')[0].split('?')[0]).resolve()
    if not f.is_file(): return None
    mime = mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
    return f'data:{mime};base64,' + b64(f.read_bytes())

def _css_inline(css, base):
    def rep(m):
        ref = m.group(2).strip()
        u = _data_uri(base, ref)
        return f'url("{u}")' if u else m.group(0)
    return re.sub(r'url\((["\']?)([^)"\']+)\1\)', rep, css)

def preparar_html(p):
    crudo = p.read_bytes()
    for enc in ('utf-8', 'cp1252', 'latin-1'):
        try:
            t = crudo.decode(enc); break
        except UnicodeDecodeError:
            continue
    base = p.parent
    externos = len(re.findall(r'(?i)(?:src|href)=["\']https?://', t))
    def css_link(m):
        tag = m.group(0)
        if not re.search(r'(?i)rel=["\']?stylesheet', tag): return tag
        h = re.search(r'(?i)href=["\']([^"\']+)', tag)
        if not h or re.match(r'(?i)https?:', h.group(1)): return tag
        f = (base / h.group(1)).resolve()
        return f'<style>{_css_inline(f.read_text(errors="replace"), f.parent)}</style>' if f.is_file() else tag
    t = re.sub(r'(?i)<link\b[^>]*>', css_link, t)
    def js(m):
        f = (base / m.group(2)).resolve()
        return f'<script{m.group(1)}>{f.read_text(errors="replace")}</script>' if f.is_file() else m.group(0)
    t = re.sub(r'(?is)<script\b([^>]*?)\ssrc=["\'](?!https?:)([^"\']+)["\']([^>]*)>\s*</script>', lambda m: js(m) if True else m.group(0), t)
    def attr(m):
        u = _data_uri(base, m.group(3))
        return f'{m.group(1)}={m.group(2)}{u}{m.group(2)}' if u else m.group(0)
    t = re.sub(r'(?i)\b(src|poster)=(["\'])([^"\']+)\2', attr, t)
    t = re.sub(r'(?is)(<style\b[^>]*>)(.*?)(</style>)', lambda m: m.group(1) + _css_inline(m.group(2), base) + m.group(3), t)
    t = re.sub(r'(?i)style=(["\'])(.*?)\1', lambda m: f'style={m.group(1)}{_css_inline(m.group(2), base)}{m.group(1)}', t)
    if externos:
        aviso(f'{p.name}: tiene {externos} recurso(s) en internet (fuentes, librerías o imágenes); sin conexión pueden no verse.')
    cuerpo = re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', t)
    texto = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', cuerpo)))[:60000]
    return dict(datos=b64(con_figtree(t).encode('utf-8')), texto=texto)

def _texto_pdf(data):
    try:
        from pypdf import PdfReader
        return ' '.join((pg.extract_text() or '') for pg in PdfReader(io.BytesIO(data)).pages[:60])[:60000]
    except Exception:
        return ''

def preparar_word(p, conv, modo):
    ext = p.suffix.lower()
    if modo in ('auto', 'pdf') or ext == '.doc':
        pdf = conv.a_pdf(p, 'Word')
        if pdf: return dict(vista='pdf', vdatos=b64(pdf), texto=_texto_pdf(pdf))
    if ext == '.docx':
        try:
            page, texto = CO.docx_a_html(p, titulo_de(p.name))
            return dict(vista='html', vdatos=b64(con_figtree(page).encode('utf-8')), texto=texto,
                        nota='Vista del Word convertida a HTML (sin Office/LibreOffice): el formato puede variar. Descarga el original para verlo exacto.')
        except Exception as e:
            aviso(f'{p.name}: no se pudo convertir ({e}); solo quedará para descargar.')
    else:
        aviso(f'{p.name}: los .doc antiguos necesitan Microsoft Word o LibreOffice para verse; solo quedará para descargar.')
    return dict(vista='none', texto='')

def preparar_ppt(p, conv, modo):
    if modo in ('auto', 'pdf') or p.suffix.lower() == '.ppt':
        pdf = conv.a_pdf(p, 'PowerPoint')
        if pdf: return dict(vista='pdf', vdatos=b64(pdf), texto=_texto_pdf(pdf))
    if p.suffix.lower() == '.pptx':
        try:
            page, texto = CO.pptx_a_html(p, titulo_de(p.name))
            return dict(vista='html', vdatos=b64(con_figtree(page).encode('utf-8')), texto=texto,
                        nota='Vista de la presentación convertida a HTML (sin Office/LibreOffice): textos, imágenes y tablas en su posición; el diseño puede variar. Descarga el original para verla exacta.')
        except Exception as e:
            aviso(f'{p.name}: no se pudo convertir ({e}); solo quedará para descargar.')
    else:
        aviso(f'{p.name}: los .ppt antiguos necesitan PowerPoint o LibreOffice para verse; solo quedará para descargar.')
    return dict(vista='none', texto='')

def preparar_excel(p, conv, modo):
    ext = p.suffix.lower()
    if modo == 'pdf':
        pdf = conv.a_pdf(p, 'Excel')
        if pdf: return dict(vista='pdf', vdatos=b64(pdf), texto=_texto_pdf(pdf))
    fuente = p if ext in ('.xlsx', '.xlsm') else conv.xls_a_xlsx(p)
    if fuente:
        try:
            page, texto, av = CO.xlsx_a_html(fuente, titulo_de(p.name))
            if av: aviso(f'{p.name}: {av}')
            return dict(vista='html', vdatos=b64(con_figtree(page).encode('utf-8')), texto=texto, nota=NOTA_EXCEL)
        except ImportError:
            aviso(f'{p.name}: para ver Excel hace falta openpyxl (instalar_opcionales.bat).')
        except Exception as e:
            aviso(f'{p.name}: no se pudo leer ({e}).')
    elif ext == '.xls':
        try:
            page, texto = CO.xls_con_xlrd(p, titulo_de(p.name))
            return dict(vista='html', vdatos=b64(con_figtree(page).encode('utf-8')), texto=texto, nota='Vista básica del .xls (solo valores). ' + NOTA_EXCEL)
        except ImportError:
            pass
        except Exception as e:
            aviso(f'{p.name}: no se pudo leer ({e}).')
    if modo != 'pdf':
        pdf = conv.a_pdf(p, 'Excel')
        if pdf: return dict(vista='pdf', vdatos=b64(pdf), texto=_texto_pdf(pdf))
    aviso(f'{p.name}: no se pudo generar vista (instala openpyxl, o Excel/LibreOffice para .xls); solo quedará para descargar.')
    return dict(vista='none', texto='')

# ------------------------------------------------------------------ armado
def es_portal(p):
    if p.suffix.lower() not in ('.html', '.htm'): return False
    try:
        with p.open('rb') as f: cab = f.read(4000)
    except OSError:
        return False
    return GENERADOR.encode() in cab

def recolectar(docs_dir, indice):
    archivos = sorted([p for p in docs_dir.rglob('*') if p.is_file() and p.suffix.lower() in TIPOS
                       and not p.name.startswith('~$') and not es_portal(p)
                       and not any(part.startswith(('.', '_')) for part in p.relative_to(docs_dir).parts)],
                      key=lambda p: p.relative_to(docs_dir).as_posix().lower())
    por_ruta = {p.relative_to(docs_dir).as_posix().lower(): p for p in archivos}
    por_nombre = {}
    for p in archivos: por_nombre.setdefault(p.name.lower(), p)
    usados, docs = set(), []
    for k, fila in enumerate(indice):
        arch = (fila.get('archivo') or '').replace('\\', '/').strip()
        p = por_ruta.get(arch.lower()) or por_nombre.get(pathlib.Path(arch).name.lower()) if arch else None
        if p is None and arch and not pathlib.Path(arch).suffix:
            for ext in TIPOS:
                p = por_ruta.get((arch + ext).lower()) or por_nombre.get((pathlib.Path(arch).name + ext).lower())
                if p: break
        if p is not None and p in usados: p = None
        if p is None and arch:
            aviso(f'Índice: «{arch}» no se encontró en la carpeta; se muestra como pendiente.')
        if p is not None: usados.add(p)
        rel = p.relative_to(docs_dir).as_posix() if p else ''
        docs.append(dict(ruta=p, rel=rel, titulo=fila.get('titulo') or (titulo_de(p.name) if p else arch or 'Sin título'),
                         seccion=fila.get('seccion') or (rel.split('/')[0] if '/' in rel else 'General'),
                         orden=fila.get('orden') or str(k + 1), revision=fila.get('revision', ''), responsable=fila.get('responsable', ''),
                         fecha=fila.get('fecha', ''), estado=fila.get('estado', '') or ('' if p else 'Pendiente'), nota=fila.get('nota', '')))
    for p in archivos:
        if p in usados: continue
        rel = p.relative_to(docs_dir).as_posix()
        docs.append(dict(ruta=p, rel=rel, titulo=titulo_de(p.name), seccion=rel.split('/')[0] if '/' in rel else 'General',
                         orden='9999', revision='', responsable='', fecha=dt.date.fromtimestamp(p.stat().st_mtime).strftime('%d-%m-%Y'),
                         estado='', nota=''))
    return archivos, docs

def orden_num(s):
    try: return float(str(s).replace(',', '.'))
    except ValueError: return 9999.0

def generar(docs_dir, salida, titulo, indice_path, modo_word='auto', modo_excel='html', conversor='auto'):
    conv = CO.Conversor(conversor)
    indice = leer_indice(indice_path) if indice_path and indice_path.exists() else []
    if indice: print(f'Índice: {indice_path.name} ({len(indice)} filas)')
    archivos, docs = recolectar(docs_dir, indice)
    secciones = {}
    for d in docs:
        secciones.setdefault(d['seccion'], []).append(d)
    orden_sec = sorted(secciones, key=lambda s: (min(orden_num(d['orden']) for d in secciones[s]), s.lower()))
    meta, payload, n = [], [], 0
    for sec in orden_sec:
        for d in sorted(secciones[sec], key=lambda d: (orden_num(d['orden']), d['titulo'].lower())):
            n += 1; did = f'd{n}'
            p = d['ruta']; tipo = TIPOS.get(p.suffix.lower()) if p else 'pendiente'
            info = None
            if p:
                print(f'  [{tipo:6}] {d["rel"]}')
                if tipo == 'drawio': info = preparar_drawio(p, n)
                elif tipo == 'pdf': info = preparar_pdf(p)
                elif tipo == 'word': info = preparar_word(p, conv, modo_word)
                elif tipo == 'excel': info = preparar_excel(p, conv, modo_excel)
                elif tipo == 'ppt': info = preparar_ppt(p, conv, modo_word)
                else: info = preparar_html(p)
                if info is None: tipo = 'error'
            m = dict(id=did, titulo=d['titulo'], seccion=sec, tipo=tipo, archivo=d['rel'], nombre=p.name if p else '',
                     revision=d['revision'], responsable=d['responsable'], fecha=d['fecha'], estado=d['estado'], nota=d['nota'],
                     tam=p.stat().st_size if p else 0, mime=MIME_EXT.get(p.suffix.lower(), 'application/octet-stream') if p else '')
            if info:
                m['texto'] = re.sub(r'\s+', ' ', info.get('texto', ''))[:60000]
                if tipo == 'drawio':
                    m['paginas'] = [dict(nombre=pg['nombre'], w=pg['w'], h=pg['h'], pasos=pg['pasos']) for pg in info['paginas']]
                    for k, pg in enumerate(info['paginas']):
                        payload.append(f'<template id="t-{did}-{k}">{pg["svg"]}</template>')
                    payload.append(f'<script type="text/plain" id="o-{did}">{b64(p.read_bytes())}</script>')
                elif tipo in ('word', 'excel', 'ppt'):
                    m['vista'] = info['vista']
                    if info.get('nota') and not m['nota']: m['nota'] = info['nota']
                    payload.append(f'<script type="text/plain" id="o-{did}">{b64(p.read_bytes())}</script>')
                    if info['vista'] != 'none':
                        payload.append(f'<script type="text/plain" id="v-{did}">{info["vdatos"]}</script>')
                else:
                    payload.append(f'<script type="text/plain" id="o-{did}">{info["datos"]}</script>')
            meta.append(m)
    pagina = PLANTILLA.replace('__TITULO__', esc(titulo)).replace('__FONT__', FONT).replace('__FONTFACE__', FONTFACE).replace('__SUBTITULO__', '').replace('__BUSCADOR__', '') \
        .replace('__GENERADO__', dt.datetime.now().strftime('%d-%m-%Y %H:%M')) \
        .replace('__META__', json.dumps(meta, ensure_ascii=False).replace('</', '<\\/')) \
        .replace('__PAYLOAD__', '\n'.join(payload))
    salida.write_text(pagina, encoding='utf-8')
    mb = salida.stat().st_size / 1e6
    disp = sum(1 for m in meta if m['tipo'] in set(TIPOS.values()))
    print(f'\nPortal generado: {salida}\n  {disp} documentos disponibles · {sum(1 for m in meta if m["tipo"] == "pendiente")} pendientes · {mb:.1f} MB')
    if mb > 50: aviso(f'El portal pesa {mb:.0f} MB: puede tardar en abrir o no pasar por correo. Considera dividirlo por secciones.')
    if AVISOS: print(f'  {len(AVISOS)} aviso(s): revisar arriba.')
    return meta

# ------------------------------------------------------------------ plantilla HTML (sin dependencias externas)
PLANTILLA = r'''<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITULO__</title>
<meta name="generator" content="portal-documentos">
<style>__FONTFACE__

:root{--side:#16213b;--side2:#1e2b4a;--side-ink:#e8ecf5;--side-mut:#9aa7c4;--ink:#1b2132;--mut:#5b6478;--line:#e1e5ec;--line2:#eef1f5;--bg:#f3f5f9;--surf:#fff;
--acc:#2e5aa8;--acc-soft:#e8eef9;--warn:#b45309;--hl:#bf4520;--r:10px;--ease:cubic-bezier(.2,.7,.2,1);
--drawio:#2e5aa8;--pdf:#c0392b;--html:#2f7d32;--word:#2b579a;--excel:#217346;--ppt:#c43e1c;--pend:#a1670f;--err:#8f1d1d}
*{box-sizing:border-box}[hidden]{display:none!important}html,body{height:100%;margin:0}
body{font-family:__FONT__;color:var(--ink);background:var(--bg);display:grid;grid-template-columns:304px 1fr;overflow:hidden;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 0}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
aside{background:var(--side);color:var(--side-ink);display:flex;flex-direction:column;min-height:0}
.brand{padding:20px 20px 14px}.brand b{display:block;font-size:17px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
.brand em{display:block;font-style:normal;font-size:13px;color:#c9d2e6;margin:4px 0 0}
.brand span{display:block;font-size:11px;color:var(--side-mut);margin-top:10px}
.search{padding:0 16px 12px;position:relative}
.search svg{position:absolute;left:28px;top:11px;width:15px;height:15px;color:var(--side-mut);pointer-events:none}
.search input{width:100%;padding:9px 12px 9px 34px;border-radius:8px;border:1px solid #ffffff24;background:#ffffff12;color:#fff;font:inherit;font-size:13px;transition:border-color .15s,background .15s}
.search input:focus{outline:none;border-color:#8fb0ec;background:#ffffff1c}.search input::placeholder{color:var(--side-mut)}
nav{overflow:auto;padding:4px 10px 18px;flex:1;scrollbar-width:thin;scrollbar-color:#ffffff30 transparent}
.sec{display:flex;align-items:center;justify-content:space-between;margin:16px 10px 6px;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--side-mut);font-weight:700}
.sec i{font-style:normal;letter-spacing:0;font-weight:600;font-size:10.5px;color:#7f8db0;background:#ffffff10;border-radius:10px;padding:1px 7px}
nav a{position:relative;display:flex;gap:10px;align-items:flex-start;padding:7px 10px 7px 12px;border-radius:7px;color:var(--side-ink);text-decoration:none;font-size:13.25px;line-height:1.35;transition:background .15s}
nav a:hover{background:#ffffff10}
nav a.on{background:#ffffff1f;color:#fff;font-weight:600}nav a.on::before{content:"";position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:3px;background:#8fb0ec}
.dot{flex:none;width:8px;height:8px;border-radius:2px;margin-top:5px;background:var(--c,#8fa0c6)}
nav a.pend{color:var(--side-mut)}nav a.pend .dot{background:transparent;box-shadow:inset 0 0 0 1.5px #7f8db0}
nav a .sub{display:block;font-size:11px;color:var(--side-mut);font-weight:400;margin-top:1px}
.foot{display:flex;gap:14px;font-size:11px;color:var(--side-mut);padding:11px 20px;border-top:1px solid #ffffff14}.foot b{color:var(--side-ink);font-weight:600}
main{display:flex;flex-direction:column;min-width:0;min-height:0}
header.vh{background:var(--surf);border-bottom:1px solid var(--line);padding:14px 24px 14px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.vt{flex:1;min-width:260px}.crumb{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);font-weight:600;margin-bottom:3px}
.vt h1{font-size:20px;line-height:1.25;letter-spacing:-.01em;margin:0 0 8px;text-wrap:balance}
.ficha{display:flex;flex-wrap:wrap;gap:6px}.ficha span{font-size:12px;color:var(--mut);background:var(--line2);border-radius:6px;padding:3px 8px}.ficha b{color:var(--ink);font-weight:600}
.tg{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:5px;color:var(--c);background:color-mix(in srgb,var(--c) 11%,#fff)}
.tg::before{content:"";width:6px;height:6px;border-radius:2px;background:var(--c)}
.est{font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--acc-soft);color:var(--acc)}
.est.p{background:#fdf2e2;color:var(--pend)}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
button,.btn{font:inherit;font-size:13px;font-weight:500;padding:7px 13px;border-radius:8px;border:1px solid var(--line);background:var(--surf);color:var(--ink);cursor:pointer;text-decoration:none;transition:border-color .15s,background .15s}
button:hover,.btn:hover{border-color:#b7c3d9;background:#fafbfd}button:active{transform:translateY(.5px)}
button[aria-pressed=true]{background:var(--acc);color:#fff;border-color:var(--acc)}
.bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 24px;background:#fbfcfd;border-bottom:1px solid var(--line);font-size:12px;color:var(--mut)}
.bar .grp{display:flex;gap:3px;align-items:center;padding-right:12px;border-right:1px solid var(--line)}.bar .grp:last-of-type{border-right:0}
.bar button{padding:5px 10px;font-size:12px}#zl{min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
.tabs button[aria-selected=true]{background:var(--acc);color:#fff;border-color:var(--acc)}
.note{margin:12px 24px 0;padding:9px 12px;background:#fff8e6;border:1px solid #f0dca0;border-radius:8px;font-size:12.5px;color:#5c4a17}
.canvas{flex:1;overflow:auto;margin:14px 24px 22px;background:var(--surf);border:1px solid var(--line);border-radius:var(--r);cursor:grab;position:relative;min-height:0}
.canvas.drag{cursor:grabbing}.stage{transform-origin:0 0;width:max-content}.stage svg{display:block}
.frame{flex:1;margin:14px 24px 22px;border:1px solid var(--line);border-radius:var(--r);overflow:auto;background:var(--surf);min-height:0}
.frame iframe{border:0;width:100%;height:100%;display:block;background:#fff}.frame .zoomwrap{transform-origin:0 0;height:100%}
.home{padding:30px 32px 40px;overflow:auto}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:8px}
.hero h1{margin:0;font-size:26px;letter-spacing:-.02em;line-height:1.15}.hero p{margin:6px 0 0;color:var(--mut);font-size:14px}
.stats{display:flex;gap:8px}.stats span{background:var(--surf);border:1px solid var(--line);border-radius:9px;padding:8px 12px;font-size:12px;color:var(--mut)}.stats b{display:block;font-size:18px;color:var(--ink);font-variant-numeric:tabular-nums}
.grupo{margin-top:26px}.grupo h2{display:flex;align-items:center;gap:10px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin:0 0 10px}
.grupo h2::after{content:"";flex:1;height:1px;background:var(--line)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{display:flex;flex-direction:column;gap:10px;padding:14px 15px 13px;border-radius:var(--r);background:var(--surf);border:1px solid var(--line);color:var(--ink);text-decoration:none;
transition:border-color .16s var(--ease),box-shadow .16s var(--ease),transform .16s var(--ease)}
.card:hover{border-color:#bccadf;box-shadow:0 4px 14px -6px #1b213229;transform:translateY(-1px)}
.card .top{display:flex;justify-content:space-between;align-items:center;gap:8px}.card .ct{font-weight:600;font-size:14.5px;line-height:1.35;text-wrap:pretty}
.card .mt{font-size:11.5px;color:var(--mut);margin-top:auto}
.card.pend{background:transparent;border-style:dashed}.card.pend .ct{color:var(--mut);font-weight:500}
.pendbox{margin:56px auto;max-width:480px;text-align:center;color:var(--mut)}.pendbox h2{color:var(--ink);font-size:18px}
.empty{padding:22px 12px;color:var(--side-mut);font-size:13px}
mark{background:#ffe08a;padding:0 1px}
[data-motion-item].fut{opacity:0;transition:opacity .25s}[data-motion-item]{transition:opacity .25s}
[data-motion-item].cur .nb{stroke:var(--hl)!important;stroke-width:2.6!important}
input[type=range]{accent-color:var(--acc);min-width:160px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}.card:hover{transform:none}}
@media (max-width:820px){body{grid-template-columns:1fr;overflow:auto}aside{max-height:48vh}.home{padding:20px 16px}}
@media print{aside,.bar,.actions{display:none}body{display:block;overflow:visible}.canvas{overflow:visible;border:0}}
</style></head>
<body>
<aside>
  <div class="brand"><b>__TITULO__</b>__SUBTITULO__<span>Generado el __GENERADO__ · funciona sin internet</span></div>
  <div class="search"__BUSCADOR__><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Buscar documentos…" aria-label="Buscar"></div>
  <nav id="nav" aria-label="Documentos"></nav>
  <div class="foot" id="foot"></div>
</aside>
<main id="main"></main>
<script type="application/json" id="meta">__META__</script>
__PAYLOAD__
<script>
(function(){
const META=JSON.parse(document.getElementById('meta').textContent);
const byId=Object.fromEntries(META.map(m=>[m.id,m]));
const $=s=>document.querySelector(s), main=$('#main'), nav=$('#nav');
const NOM={drawio:'Diagrama',pdf:'PDF',html:'HTML',word:'Word',excel:'Excel',ppt:'PowerPoint',pendiente:'Pendiente',error:'Error'};
const OK={drawio:1,pdf:1,html:1,word:1,excel:1,ppt:1};
const norm=s=>(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const e=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const disp=META.filter(m=>m.tipo in OK).length;
const npend=META.filter(m=>m.tipo==='pendiente').length;
$('#foot').innerHTML='<span><b>'+disp+'</b> disponibles</span>'+(npend?'<span><b>'+npend+'</b> pendientes</span>':'');
const COL={drawio:'var(--drawio)',pdf:'var(--pdf)',html:'var(--html)',word:'var(--word)',excel:'var(--excel)',ppt:'var(--ppt)',pendiente:'var(--pend)',error:'var(--err)'};
const tag=m=>'<span class="tg" style="--c:'+COL[m.tipo]+'">'+NOM[m.tipo]+'</span>';
const est=m=>m.estado&&!(m.tipo==='pendiente'&&/^pendiente$/i.test(m.estado))?'<span class="est'+(m.tipo==='pendiente'?' p':'')+'">'+e(m.estado)+'</span>':'';
const blobs={};
function bytes(id){const el=document.getElementById(id);if(el.hasAttribute('data-t'))return new TextEncoder().encode(el.textContent.replace(/<\\\/(script)/gi,'</$1'));const b=atob(document.getElementById(id).textContent.trim());const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function blobUrl(id,mime){return blobs[id]||(blobs[id]=URL.createObjectURL(new Blob([bytes(id)],{type:mime})))}
function vista(m){return document.getElementById('v-'+m.id)?'v-'+m.id:'o-'+m.id}
function descargar(m){const a=document.createElement('a');
  if(document.getElementById('o-'+m.id)){a.href=blobUrl('o-'+m.id,m.mime);a.download=m.nombre}
  else{if(location.protocol==='blob:'){alert('Para descargar el original, abre el portal desde su carpeta (doble clic en el archivo del portal). Esta vista previa del generador no tiene acceso a la carpeta.');return}
    a.href=m.archivo.split('/').map(encodeURIComponent).join('/');a.target='_blank';a.rel='noopener'}
  document.body.appendChild(a);a.click();a.remove()}
function menu(q){
  const nq=norm(q.trim()); const grupos=new Map();
  for(const m of META){
    const hay=norm([m.titulo,m.seccion,m.archivo,m.responsable,m.estado,m.revision,m.nota,m.texto].join(' '));
    if(nq && !nq.split(/\s+/).every(w=>hay.includes(w))) continue;
    if(!grupos.has(m.seccion))grupos.set(m.seccion,[]); grupos.get(m.seccion).push(m);
  }
  let html='';
  for(const [sec,ms] of grupos){
    html+='<p class="sec"><span>'+e(sec)+'</span><i>'+ms.length+'</i></p>';
    for(const m of ms) html+='<a href="#'+m.id+'" data-id="'+m.id+'" class="'+(m.tipo==='pendiente'?'pend':'')+'" title="'+e(NOM[m.tipo]+' · '+m.titulo)+'"><span class="dot" style="--c:'+COL[m.tipo]+'"></span><span>'+e(m.titulo)+(m.tipo==='pendiente'?'<span class="sub">Pendiente</span>':'')+'</span></a>';
  }
  nav.innerHTML=html||'<p class="empty">Sin resultados para «'+e(q.trim())+'».</p>';marcar();
}
let ACTUAL=location.hash.slice(1);
function marcar(){nav.querySelectorAll('a').forEach(a=>a.classList.toggle('on',a.dataset.id===ACTUAL))}
$('#q').addEventListener('input',ev=>menu(ev.target.value));
function ficha(m){
  const f=[['Revisión',m.revision],['Responsable',m.responsable],['Fecha',m.fecha],['Archivo',m.nombre||m.archivo]];
  return '<div class="ficha">'+(m.tipo in OK?tag(m):'')+f.filter(x=>x[1]).map(x=>'<span>'+x[0]+' <b>'+e(x[1])+'</b></span>').join('')+est(m)+'</div>';
}
function inicio(){
  const sub=document.querySelector('.brand em');
  const secs=[...new Set(META.map(m=>m.seccion))];
  let h='<div class="home"><div class="hero"><div><h1>'+e(document.title)+'</h1><p>'+(sub?e(sub.textContent)+' · ':'')+'elige un documento en el menú o en las tarjetas.</p></div>'+
    '<div class="stats"><span><b>'+disp+'</b>disponibles</span>'+(npend?'<span><b>'+npend+'</b>pendientes</span>':'')+'<span><b>'+secs.length+'</b>secciones</span></div></div>';
  for(const sec of secs){
    h+='<section class="grupo"><h2>'+e(sec)+'</h2><div class="cards">';
    for(const m of META.filter(x=>x.seccion===sec)){
      const meta=[m.revision?'Rev. '+m.revision:'',m.fecha].filter(Boolean).join(' · ');
      h+='<a class="card'+(m.tipo==='pendiente'?' pend':'')+'" href="#'+m.id+'"><span class="top">'+tag(m)+est(m)+'</span><span class="ct">'+e(m.titulo)+'</span>'+(meta?'<span class="mt">'+e(meta)+'</span>':'')+'</a>';
    }
    h+='</div></section>';
  }
  main.innerHTML=h+'</div>';
}
let Z=null;
function ver(id){
  const m=byId[id]; if(!m){inicio();return}
  Z=null;
  let h='<header class="vh"><div class="vt"><div class="crumb">'+e(m.seccion)+'</div><h1>'+e(m.titulo)+'</h1>'+ficha(m)+'</div><div class="actions">';
  if(m.tipo==='drawio'&&m.paginas.some(p=>p.pasos>1)) h+='<button type="button" id="bPasos" aria-pressed="false">Paso a paso</button>';
  if(m.tipo in OK) h+='<button type="button" id="bDesc">Descargar original</button><button type="button" id="bFull">Pantalla completa</button>';
  h+='</div></header>';
  if(m.nota) h+='<p class="note">'+e(m.nota)+'</p>';
  if(m.tipo==='pendiente'||m.tipo==='error'){
    main.innerHTML=h+'<div class="pendbox"><h2>'+(m.tipo==='error'?'No se pudo convertir':'Documento pendiente')+'</h2><p>'+(m.tipo==='error'?'Revisa el archivo «'+e(m.archivo)+'» (los avisos aparecen al generar el portal).':'Aún no hay archivo para este documento. Cuando exista, colócalo en la carpeta y vuelve a generar el portal.')+'</p></div>';return;
  }
  if(m.tipo==='drawio'){
    h+='<div class="bar">'+(m.paginas.length>1?'<span class="grp tabs" role="tablist">'+m.paginas.map((p,k)=>'<button role="tab" data-pg="'+k+'" aria-selected="'+(k===0)+'">'+e(p.nombre)+'</button>').join('')+'</span>':'')
      +'<span class="grp"><button data-z="fit" title="Ver el diagrama completo">Ajustar</button><button data-z="ancho" title="Ajustar al ancho">Ancho</button><button data-z="out" aria-label="Alejar">−</button><span id="zl">100%</span><button data-z="in" aria-label="Acercar">+</button><button data-z="1">100%</button></span>'
      +'<span class="grp" id="steps" hidden><button data-s="first" aria-label="Inicio">⏮</button><button data-s="prev" aria-label="Anterior">◀</button><button data-s="play" aria-label="Reproducir">▶</button><button data-s="next" aria-label="Siguiente">▶▶</button><input type="range" id="sr" min="0" value="0" aria-label="Paso"><span id="sl"></span></span>'
      +'<span style="margin-left:auto">Arrastra para moverte · Ctrl + rueda para zoom</span></div>';
    h+='<div class="canvas" id="cv" tabindex="0"><div class="stage" id="st"></div></div>';
    main.innerHTML=h; pagina(m,0);
    main.querySelectorAll('[data-pg]').forEach(b=>b.onclick=()=>{main.querySelectorAll('[data-pg]').forEach(x=>x.setAttribute('aria-selected',x===b));pagina(m,+b.dataset.pg)});
    zoomCtl(); arrastre($('#cv'));
  } else if((m.tipo==='word'||m.tipo==='excel'||m.tipo==='ppt')&&m.vista==='none'){
    main.innerHTML=h+'<div class="pendbox"><h2>Vista no disponible</h2><p>Este archivo no se pudo convertir en esta PC (falta Microsoft Office, LibreOffice u openpyxl). Puedes descargarlo y abrirlo con su programa.</p><p><button type="button" id="bDesc2">Descargar «'+e(m.nombre)+'»</button></p></div>';
    $('#bDesc2').onclick=()=>descargar(m);
  } else if((m.tipo==='pdf'&&m.vista!=='html')||m.vista==='pdf'){
    h+='<div class="bar"><span>El zoom, la búsqueda y la impresión del PDF están en la barra del visor.'+(m.vista==='pdf'?' Vista en PDF del archivo original; «Descargar original» baja el '+({word:'Word',excel:'Excel',ppt:'PowerPoint'}[m.tipo])+'.':'')+'</span></div><div class="frame"><iframe title="'+e(m.titulo)+'" src="'+blobUrl(vista(m),'application/pdf')+'"></iframe></div>';
    main.innerHTML=h;
  } else {
    h+='<div class="bar"><span class="grp"><button data-z="out" aria-label="Alejar">−</button><span id="zl">100%</span><button data-z="in" aria-label="Acercar">+</button><button data-z="1">100%</button></span></div>'
      +'<div class="frame" id="fr"><div class="zoomwrap" id="zw"><iframe title="'+e(m.titulo)+'" sandbox="allow-scripts allow-popups allow-modals allow-forms allow-downloads" src="'+blobUrl(vista(m),'text/html')+'"></iframe></div></div>';
    main.innerHTML=h; zoomHtml();
  }
  const bd=$('#bDesc'); if(bd) bd.onclick=()=>descargar(m);
  const bf=$('#bFull'); if(bf) bf.onclick=()=>{const el=$('.canvas')||$('.frame'); if(el&&el.requestFullscreen) el.requestFullscreen()};
}
// ---- drawio: páginas, zoom, arrastre, paso a paso
let PG=null, step=0, timer=null;
function pagina(m,k){
  const st=$('#st'); st.innerHTML=''; st.appendChild(document.getElementById('t-'+m.id+'-'+k).content.cloneNode(true));
  PG=m.paginas[k]; const svg=st.querySelector('svg'); svg.setAttribute('width',PG.w); svg.setAttribute('height',PG.h);
  Z={s:1}; ajustarAncho();
  const bp=$('#bPasos'), sp=$('#steps');
  if(bp){bp.setAttribute('aria-pressed','false'); bp.hidden=PG.pasos<2; sp.hidden=true; bp.onclick=()=>{const on=bp.getAttribute('aria-pressed')!=='true';bp.setAttribute('aria-pressed',on);sp.hidden=!on;pasos(on?1:PG.pasos,!on)}}
  const sr=$('#sr'); if(sr){sr.max=PG.pasos; sr.oninput=()=>pasos(+sr.value)}
  main.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{const a=b.dataset.s;
    if(a==='play'){ if(timer){stop()} else { if(step>=PG.pasos)pasos(1); timer=setInterval(()=>{if(step>=PG.pasos)stop();else pasos(step+1)},900); b.textContent='⏸'; b.setAttribute('aria-label','Pausa') } return }
    stop(); if(a==='first')pasos(1); if(a==='prev')pasos(step-1); if(a==='next')pasos(step+1)});
  pasos(PG.pasos,true);
}
function stop(){if(timer){clearInterval(timer);timer=null} main.querySelectorAll('[data-s=play]').forEach(b=>{b.textContent='▶';b.setAttribute('aria-label','Reproducir')})}
function pasos(n,todo){
  if(!PG)return; step=Math.max(1,Math.min(PG.pasos,n));
  $('#st').querySelectorAll('[data-motion-item]').forEach(g=>{const s=+g.dataset.step;g.classList.toggle('fut',!todo&&s>step);g.classList.toggle('cur',!todo&&s===step)});
  const sr=$('#sr'), sl=$('#sl'); if(sr)sr.value=step; if(sl)sl.textContent='Paso '+step+' de '+PG.pasos;
}
function aplicar(){const st=$('#st'); if(!st||!Z)return; st.style.transform='scale('+Z.s+')'; st.style.width=(PG.w*Z.s)+'px'; st.style.height=(PG.h*Z.s)+'px'; $('#zl').textContent=Math.round(Z.s*100)+'%'}
function ajustarAncho(){const cv=$('#cv'); Z.s=Math.min(1.5,Math.max(0.2,(cv.clientWidth-24)/PG.w)); aplicar()}
function ajustar(){const cv=$('#cv'); Z.s=Math.min(1.5,Math.max(0.1,Math.min((cv.clientWidth-24)/PG.w,(cv.clientHeight-24)/PG.h))); aplicar()}
function zoomCtl(){main.querySelectorAll('[data-z]').forEach(b=>b.onclick=()=>{const a=b.dataset.z; if(a==='fit')ajustar(); else if(a==='ancho')ajustarAncho(); else {Z.s=a==='1'?1:Math.min(4,Math.max(0.1,Z.s*(a==='in'?1.25:0.8)));aplicar()}});
  $('#cv').addEventListener('wheel',ev=>{if(!ev.ctrlKey)return;ev.preventDefault();Z.s=Math.min(4,Math.max(0.1,Z.s*(ev.deltaY<0?1.1:0.9)));aplicar()},{passive:false});
  $('#cv').addEventListener('keydown',ev=>{const cv=$('#cv');if(ev.key==='+'){Z.s*=1.2;aplicar()}if(ev.key==='-'){Z.s/=1.2;aplicar()}if(ev.key==='ArrowRight'&&!$('#steps').hidden){pasos(step+1);ev.preventDefault()}if(ev.key==='ArrowLeft'&&!$('#steps').hidden){pasos(step-1);ev.preventDefault()}});
}
function arrastre(el){let d=null;el.addEventListener('pointerdown',ev=>{if(ev.button)return;d={x:ev.clientX,y:ev.clientY,l:el.scrollLeft,t:el.scrollTop};el.classList.add('drag');el.setPointerCapture(ev.pointerId)});
  el.addEventListener('pointermove',ev=>{if(!d)return;el.scrollLeft=d.l-(ev.clientX-d.x);el.scrollTop=d.t-(ev.clientY-d.y)});
  ['pointerup','pointercancel'].forEach(t=>el.addEventListener(t,()=>{d=null;el.classList.remove('drag')}))}
function zoomHtml(){let s=1;const zw=$('#zw');const ap=()=>{zw.style.transform='scale('+s+')';zw.style.width=(100/s)+'%';zw.style.height=(100/s)+'%';$('#zl').textContent=Math.round(s*100)+'%'};
  main.querySelectorAll('[data-z]').forEach(b=>b.onclick=()=>{const a=b.dataset.z;s=a==='1'?1:Math.min(3,Math.max(0.3,s*(a==='in'?1.2:1/1.2)));ap()})}
function ruta(){marcar(); stop(); const id=ACTUAL; if(id&&byId[id]) ver(id); else inicio(); main.scrollTop=0}
// navegación interna: funciona igual abierto desde la carpeta (file://) o desde el generador (blob:, que no admite #)
function ir(id){ACTUAL=id; if(location.protocol!=='blob:'){try{history.pushState(null,'','#'+id)}catch(e){}} ruta()}
document.addEventListener('click',ev=>{const a=ev.target.closest('a[href^="#"]'); if(!a)return; ev.preventDefault(); ir(a.getAttribute('href').slice(1))});
window.addEventListener('popstate',()=>{ACTUAL=location.hash.slice(1); ruta()});
window.addEventListener('hashchange',()=>{ACTUAL=location.hash.slice(1); ruta()}); window.addEventListener('resize',()=>{if(Z&&PG&&$('#cv'))aplicar()});
menu(''); ruta();
})();
</script>
</body></html>
'''

def elegir_carpeta():
    """Ventana para elegir la carpeta (si no se pasó por línea de comandos o arrastrando sobre el .bat)."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
        c = filedialog.askdirectory(title='Elige la carpeta con los documentos del portal')
        root.destroy()
        return c or None
    except Exception:
        try:
            return input('Ruta de la carpeta con los documentos: ').strip().strip('"') or None
        except EOFError:
            return None

def abrir(ruta):
    try:
        import os, subprocess
        if sys.platform == 'win32': os.startfile(str(ruta))
        elif sys.platform == 'darwin': subprocess.Popen(['open', str(ruta)])
        else: subprocess.Popen(['xdg-open', str(ruta)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

def main():
    ap = argparse.ArgumentParser(description='Convierte todos los documentos de una carpeta (drawio, PDF, HTML, Word, Excel, PowerPoint) '
                                             'en un solo HTML autónomo que se guarda en la misma carpeta.')
    ap.add_argument('carpeta', nargs='?', help='carpeta con los documentos (subcarpetas = secciones). Sin ella se abre una ventana para elegirla')
    ap.add_argument('--docs', help=argparse.SUPPRESS)
    ap.add_argument('--salida', help='archivo HTML de salida (por defecto: <carpeta>/<nombre de la carpeta> - Portal.html)')
    ap.add_argument('--titulo', help='título del portal (por defecto: nombre de la carpeta)')
    ap.add_argument('--indice', default=None, help='índice opcional (.xlsx o .csv); por defecto <carpeta>/indice.xlsx o indice.csv')
    ap.add_argument('--word', choices=['auto', 'pdf', 'html'], default='auto', help='Word y PowerPoint: auto = PDF con Office/LibreOffice si hay, si no HTML propio')
    ap.add_argument('--excel', choices=['html', 'pdf'], default='html', help='Excel: html = tablas por hoja; pdf = con Office/LibreOffice')
    ap.add_argument('--conversor', choices=['auto', 'office', 'libreoffice', 'ninguno'], default='auto', help='programa para convertir Word/Excel/PowerPoint')
    ap.add_argument('--plantilla', action='store_true', help='crea indice_plantilla.csv con los archivos encontrados y termina')
    ap.add_argument('--abrir', action='store_true', help='abre el portal al terminar')
    a = ap.parse_args()
    carpeta = a.carpeta or a.docs or elegir_carpeta()
    if not carpeta:
        print('No se eligió ninguna carpeta.'); return 1
    docs_dir = pathlib.Path(carpeta.strip('"')).resolve()
    if not docs_dir.is_dir():
        print(f'No existe la carpeta: {docs_dir}'); return 1
    if a.plantilla:
        archivos, _ = recolectar(docs_dir, [])
        escribir_plantilla(docs_dir, archivos)
        if a.abrir: abrir(docs_dir)
        return 0
    titulo = a.titulo or docs_dir.name
    salida = pathlib.Path(a.salida).resolve() if a.salida else docs_dir / f'{docs_dir.name} - Portal.html'
    indice = pathlib.Path(a.indice) if a.indice else next((docs_dir / n for n in ('indice.xlsx', 'indice.csv') if (docs_dir / n).exists()), None)
    print(f'Carpeta: {docs_dir}')
    generar(docs_dir, salida, titulo, indice, a.word, a.excel, a.conversor)
    if a.abrir: abrir(salida)
    return 0

if __name__ == '__main__':
    sys.exit(main())
