#!/usr/bin/env python3
"""Arma «Generador de portal.html»: un solo archivo para abrir en Edge/Chrome que convierte una carpeta
de documentos en un portal HTML, sin Python ni instalación. Une web/generador_base.html + web/generador.js
+ la plantilla del visor (la misma de generar_portal.py) + la fuente Figtree.
Uso (solo para quien mantiene la herramienta): python construir_generador.py"""
import base64, json, pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from generar_portal import PLANTILLA  # noqa: E402

ttf = (HERE / 'fuentes' / 'Figtree-VariableFont_wght.ttf').read_bytes()
base = (HERE / 'web' / 'generador_base.html').read_text(encoding='utf-8')
js = '\n'.join((HERE / 'web' / n).read_text(encoding='utf-8') for n in ('motor_drawio.js', 'office.js', 'pdf_html.js', 'generador.js'))
datos = ('const FIGTREE_B64 = "' + base64.b64encode(ttf).decode() + '";\n'
         'const PLANTILLA = ' + json.dumps(PLANTILLA, ensure_ascii=False).replace('</', '<\\/') + ';\n'
         "document.head.insertAdjacentHTML('beforeend', '<style>@font-face{font-family:\\'Figtree\\';font-weight:300 900;"
         "src:url(data:font/ttf;base64,' + FIGTREE_B64 + ') format(\\'truetype\\')}</style>');")
out = HERE / 'Generador de portal.html'
# PDF.js (Apache-2.0) solo para leer PDF; el lector va como texto y se arranca como Worker desde un blob
pdfjs = (HERE / 'web' / 'vendor' / 'pdf.min.js').read_text(encoding='utf-8')
worker = (HERE / 'web' / 'vendor' / 'pdf.worker.min.js').read_text(encoding='utf-8')
assert '</script' not in (pdfjs + worker).lower()
pre, resto = base.split('/*__PDFJS__*/'); medio, resto = resto.split('/*__PDFWORKER__*/')
html = (pre + pdfjs + medio + worker + resto.replace('/*__DATOS__*/', datos).replace('/*__JS__*/', js)).replace('/*__FONTFACE__*/', '', 1)
out.write_text(html, encoding='utf-8')
print(out, f'{out.stat().st_size / 1024:.0f} KB')
