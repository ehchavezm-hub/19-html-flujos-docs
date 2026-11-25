#!/usr/bin/env python3
"""Motor de dibujo de .drawio para el portal de documentos (copia del conversor de flujogramas,
ampliada con páginas múltiples, diagramas comprimidos e imágenes incrustadas: ver leer_paginas()).

Convierte flujogramas .drawio a HTML con el sistema visual de diagram-design.

Uso: python3 flujogramas/html/drawio_a_html.py <carpeta_o_archivos.drawio> [--out DIR]

Por cada diagrama genera:
  <nombre>.html          animado con «diagram-design · Paso a Paso» (un paso por etapa del flujo)
  <nombre>_estatico.html sin animación, listo para imprimir
y un index.html con todos. Conserva la distribución, los textos y las conexiones del
original (no elimina contenido); cambia la piel: carriles con color por organización,
actividades con borde del color de su área, decisiones en ámbar, flechas ortogonales
redondeadas con saltos en los cruces.
"""
import argparse, base64, html, math, mimetypes, pathlib, re, sys, tempfile, unicodedata, urllib.parse, zlib
import xml.etree.ElementTree as ET
from collections import defaultdict, deque

HERE = pathlib.Path(__file__).resolve().parent
SKILL = HERE.parents[1] / '.claude/skills/diagram-design'
S = 1.5                       # escala respecto al draw.io original
PAPER, INK, MUTED, SOFT, ACCENT = '#f5f5f5', '#2d3142', '#4f5d75', '#5a6580', '#bf4520'
F_SANS = "Geist, system-ui, sans-serif"; F_MONO = "'Geist Mono', ui-monospace, monospace"
SANS, MONO = 0.60, 0.62
PALETTE = [  # (clave en el nombre del grupo, colores)
    ('SUPERVIS', dict(band='#f3dedb', lane='#fcf4f3', lane2='#f9eeec', ink='#9a3a32')),
    ('CLIENTE', dict(band='#e9def3', lane='#f8f4fb', lane2='#f3edf8', ink='#6b4c9a')),
    ('OFICINA', dict(band='#dae6f5', lane='#f3f7fc', lane2='#ebf1f9', ink='#2e5aa8')),
    ('SUBCONTRAT', dict(band='#dcebd2', lane='#f3f9ef', lane2='#ebf4e5', ink='#3f7a2c')),
    ('CONSTRUC', dict(band='#f1e4c6', lane='#fcf7ec', lane2='#f8f0de', ink='#8a6210')),
    ('PRODUC', dict(band='#f1e4c6', lane='#fcf7ec', lane2='#f8f0de', ink='#8a6210')),
    ('CALIDAD', dict(band='#d6ecec', lane='#f1f8f8', lane2='#e8f3f3', ink='#2a7373')),
    ('', dict(band='#e4e7ee', lane='#f6f7f9', lane2='#eef0f4', ink='#4f5d75')),
]
NOTE_FILL = {'#fff2cc': ('#fff6d6', '#c9a227'), '#dae8fc': ('#e9f0fa', '#6c8ebf')}
esc = html.escape

def norm(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().upper()

def palette(name):
    n = norm(name)
    for key, pal in PALETTE:
        if key in n: return pal
    return PALETTE[-1][1]

def sty(c):
    d = {}
    for part in (c.get('style') or '').split(';'):
        if '=' in part:
            k, v = part.split('=', 1); d[k] = v
        elif part: d[part] = '1'
    return d

def label_lines(v):
    v = v or ''
    v = re.sub(r'<br\s*/?>|</div>|</p>|</li>|<div[^>]*>|<p[^>]*>|<li[^>]*>', '\n', v, flags=re.I)
    v = re.sub(r'<[^>]+>', '', v)
    v = html.unescape(html.unescape(v)).replace('\xa0', ' ')
    # contenido de draw.io pegado por error dentro de una etiqueta (XML codificado): se descarta
    v = re.split(r'%3CmxGraphModel|<mxGraphModel', v)[0]
    return [re.sub(r'\s+', ' ', l).strip() for l in v.split('\n') if l.strip()]

def wrap(text, size, width, em=SANS):
    out = []
    for para in text:
        words, cur = para.split(), ''
        for w in words:
            t = (cur + ' ' + w).strip()
            if len(t) * size * em <= width or not cur: cur = t
            else: out.append(cur); cur = w
        if cur: out.append(cur)
    return out

def fit(lines, w, h, size0, smin=8.0, lh=1.18, em=SANS):
    size = size0
    while True:
        wl = wrap(lines, size, max(w, 10), em)
        widest = max([len(l) * size * em for l in wl] or [0])
        if (len(wl) * size * lh <= h and widest <= w) or size <= smin:
            return wl, size
        size -= 0.5

# --------------------------------------------------------------------------- lectura
class Diagram:
    def __init__(self, path):
        self.path = path
        root = ET.parse(path).getroot()
        model = root.find('.//mxGraphModel')
        self.cells = {c.get('id'): c for c in model.iter('mxCell')}
        self.st = {i: sty(c) for i, c in self.cells.items()}
        self._abs = {}
        self.title = None

    def geo(self, i):
        g = self.cells[i].find('mxGeometry')
        if g is None: return (0, 0, 0, 0)
        f = lambda k: float(g.get(k) or 0)
        return f('x'), f('y'), f('width'), f('height')

    def origin(self, i):
        """Origen absoluto (sin escalar) del contenedor i."""
        if i in self._abs: return self._abs[i]
        c = self.cells.get(i)
        if c is None or not c.get('vertex'):
            self._abs[i] = (0.0, 0.0); return self._abs[i]
        x, y, _, _ = self.geo(i)
        px, py = self.origin(c.get('parent'))
        self._abs[i] = (px + x, py + y)
        return self._abs[i]

    def box(self, i):
        x, y = self.origin(i); _, _, w, h = self.geo(i)
        return x, y, w, h

# --------------------------------------------------------------------------- modelo de dibujo
def classify(D, i):
    c, s = D.cells[i], D.st[i]
    txt = ' '.join(label_lines(c.get('value')))
    if s.get('shape') == 'image' or ('image' in s and s.get('image') not in (None, '', '1')): return 'image'
    if 'swimlane' in s: return 'lane'
    if s.get('shape') == 'ext': return 'band'
    if 'rhombus' in s or s.get('shape') == 'mxgraph.flowchart.decision': return 'gw'
    if s.get('shape') == 'note': return 'note'
    if s.get('shape') == 'mxgraph.basic.document' or s.get('shape') == 'document': return 'doc'
    if s.get('shape') == 'mxgraph.flowchart.database' or 'cylinder' in (s.get('shape') or ''): return 'db'
    if 'ellipse' in s: return 'ellipse'
    if 'text' in s or s.get('strokeColor') == 'none' and s.get('fillColor') in (None, 'none'):
        return 'text'
    if norm(txt) in ('INICIO', 'FIN', 'INICIO DEL PROCESO', 'FIN DEL PROCESO'): return 'term'
    return 'task'

def build(D):
    verts = [i for i, c in D.cells.items() if c.get('vertex') and D.cells[c.get('parent')].get('edge') is None]
    edge_labels = defaultdict(list)
    for i, c in D.cells.items():
        p = D.cells.get(c.get('parent'))
        if c.get('vertex') and p is not None and p.get('edge'):
            edge_labels[c.get('parent')] += label_lines(c.get('value'))
    kinds = {i: classify(D, i) for i in verts}
    # título: texto grande fuera de carriles
    for i in verts:
        if kinds[i] == 'text' and float(D.st[i].get('fontSize', 11)) >= 14:
            D.title = ' '.join(label_lines(D.cells[i].get('value'))); kinds[i] = 'title'
    # grupo (para color): carril de nivel superior que contiene al nodo
    def top_lane(i):
        cur, top = i, None
        while cur in D.cells and D.cells[cur].get('vertex'):
            if kinds.get(cur) == 'lane': top = cur
            cur = D.cells[cur].get('parent')
        return top
    group = {}
    lane_boxes = [(i, D.box(i)) for i in verts if kinds[i] == 'lane' and D.cells[D.cells[i].get('parent')].get('vertex') is None]
    for i in verts:
        g = top_lane(i)
        if g is None and kinds[i] not in ('lane', 'title'):
            x, y, w, h = D.box(i); cx, cy = x + w / 2, y + h / 2
            for li, (lx, ly, lw, lh) in lane_boxes:
                if lx <= cx <= lx + lw and ly <= cy <= ly + lh: g = li
        group[i] = g
    return verts, kinds, group, edge_labels

# --------------------------------------------------------------------------- rutas
def side_point(b, side, along=None):
    x, y, w, h = b
    if side == 'L': return (x, along if along is not None else y + h / 2)
    if side == 'R': return (x + w, along if along is not None else y + h / 2)
    if side == 'T': return (along if along is not None else x + w / 2, y)
    return (along if along is not None else x + w / 2, y + h)

def facing(b, p):
    x, y, w, h = b
    if x + 6 <= p[0] <= x + w - 6:
        return ('T' if p[1] < y else 'B'), min(max(p[0], x + 8), x + w - 8)
    if y + 6 <= p[1] <= y + h - 6:
        return ('L' if p[0] < x else 'R'), min(max(p[1], y + 8), y + h - 8)
    cx, cy = x + w / 2, y + h / 2
    dx, dy = (p[0] - cx) / max(w, 1), (p[1] - cy) / max(h, 1)
    if abs(dx) >= abs(dy): return ('L' if dx < 0 else 'R'), None
    return ('T' if dy < 0 else 'B'), None

def constrained(b, s, pre):
    if pre + 'X' in s and pre + 'Y' in s:
        fx, fy = float(s[pre + 'X']), float(s[pre + 'Y'])
        x, y, w, h = b
        p = (x + fx * w, y + fy * h)
        side = 'L' if fx <= 0.001 else 'R' if fx >= 0.999 else 'T' if fy <= 0.001 else 'B' if fy >= 0.999 else None
        if side is None:
            side = min((('L', fx), ('R', 1 - fx), ('T', fy), ('B', 1 - fy)), key=lambda t: t[1])[0]
            p = side_point(b, side, p[1] if side in 'LR' else p[0])
        return side, p
    return None, None

def route(sb, tb, wps, s, sp=None, tp=None):
    ss, p0 = constrained(sb, s, 'exit') if sb else (None, None)
    ts, pn = constrained(tb, s, 'entry') if tb else (None, None)
    if sb is None: p0, ss = sp, None
    if tb is None: pn, ts = tp, None
    if sb is not None and p0 is None:
        ref = wps[0] if wps else (tb[0] + tb[2] / 2, tb[1] + tb[3] / 2) if tb else pn
        if not wps and tb:
            ss, along = auto_side(sb, tb)
        else:
            ss, along = facing(sb, ref)
        p0 = side_point(sb, ss, along)
    if tb is not None and pn is None:
        ref = wps[-1] if wps else p0
        if not wps and sb:
            ts, along = auto_side(tb, sb)
            if ss in 'LR' and ts in 'LR' or ss in 'TB' and ts in 'TB':
                along = None
            if along is not None:
                pass
        else:
            ts, along = facing(tb, ref)
        pn = side_point(tb, ts, along)
    pts = [p0] + list(wps) + [pn]
    # alinear casi-alineados moviendo puntos intermedios
    for k in range(1, len(pts) - 1):
        for j in (k - 1, k + 1):
            a = pts[j]; b = list(pts[k])
            if abs(a[0] - b[0]) < 4: b[0] = a[0]
            if abs(a[1] - b[1]) < 4: b[1] = a[1]
            pts[k] = tuple(b)
    if len(pts) == 2:
        a, b = pts
        if abs(a[0] - b[0]) < 4 and (ss in ('T', 'B') or ss is None): pts[1] = (a[0], b[1])
        elif abs(a[1] - b[1]) < 4 and (ss in ('L', 'R') or ss is None): pts[1] = (b[0], a[1])
    out = [pts[0]]
    ori = 'h' if ss in ('L', 'R') else 'v'
    for k in range(1, len(pts)):
        prev, q = out[-1], pts[k]
        if prev[0] == q[0] or prev[1] == q[1]:
            out.append(q); ori = 'v' if prev[0] == q[0] else 'h'; continue
        last = k == len(pts) - 1
        if last and ts:
            need = 'h' if ts in ('L', 'R') else 'v'
            if need == 'h' and ori == 'h':
                mx = (prev[0] + q[0]) / 2; out += [(mx, prev[1]), (mx, q[1]), q]
            elif need == 'v' and ori == 'v':
                my = (prev[1] + q[1]) / 2; out += [(prev[0], my), (q[0], my), q]
            else:
                out += [(q[0], prev[1]) if need == 'v' else (prev[0], q[1]), q]
            ori = need
        else:
            if ori == 'h': out += [(q[0], prev[1]), q]; ori = 'v'
            else: out += [(prev[0], q[1]), q]; ori = 'h'
    clean = [out[0]]
    for p in out[1:]:
        if abs(p[0] - clean[-1][0]) < 0.01 and abs(p[1] - clean[-1][1]) < 0.01: continue
        clean.append(p)
    k = 1
    while k < len(clean) - 1:
        a, b, c = clean[k - 1], clean[k], clean[k + 1]
        if (a[0] == b[0] == c[0]) or (a[1] == b[1] == c[1]):
            # elimina punto colineal solo si no invierte el sentido
            if (a[0] == b[0] == c[0] and (b[1] - a[1]) * (c[1] - b[1]) >= 0) or (a[1] == b[1] == c[1] and (b[0] - a[0]) * (c[0] - b[0]) >= 0):
                clean.pop(k); continue
        k += 1
    return clean

def auto_side(a, b):
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    ox = min(ax + aw, bx + bw) - max(ax, bx)
    oy = min(ay + ah, by + bh) - max(ay, by)
    if ox > 16:
        x = (max(ax, bx) + min(ax + aw, bx + bw)) / 2
        return ('B' if by > ay else 'T'), x
    if oy > 16:
        y = (max(ay, by) + min(ay + ah, by + bh)) / 2
        return ('R' if bx > ax else 'L'), y
    dx = (bx + bw / 2) - (ax + aw / 2); dy = (by + bh / 2) - (ay + ah / 2)
    if abs(dx) >= abs(dy): return ('R' if dx > 0 else 'L'), None
    return ('B' if dy > 0 else 'T'), None

def path_d(pts, hops, r=7, hr=4.5):
    d = f'M{pts[0][0]:.1f} {pts[0][1]:.1f}'
    for k in range(1, len(pts)):
        a, b = pts[k - 1], pts[k]
        if (k - 1) in hops:
            sgn = 1 if b[0] > a[0] else -1
            for hx in hops[k - 1]:
                d += f' H{hx - sgn * hr:.1f} A{hr} {hr} 0 0 {1 if sgn > 0 else 0} {hx + sgn * hr:.1f} {a[1]:.1f}'
        if k == len(pts) - 1:
            d += f' L{b[0]:.1f} {b[1]:.1f}'; break
        c = pts[k + 1]
        l1 = abs(b[0] - a[0]) + abs(b[1] - a[1]); l2 = abs(c[0] - b[0]) + abs(c[1] - b[1])
        rr = min(r, l1 / 2, l2 / 2)
        if rr < 0.5 or l1 == 0 or l2 == 0:
            d += f' L{b[0]:.1f} {b[1]:.1f}'; continue
        ux, uy = (b[0] - a[0]) / l1, (b[1] - a[1]) / l1
        vx, vy = (c[0] - b[0]) / l2, (c[1] - b[1]) / l2
        p1 = (b[0] - ux * rr, b[1] - uy * rr); p2 = (b[0] + vx * rr, b[1] + vy * rr)
        d += f' L{p1[0]:.1f} {p1[1]:.1f} A{rr:.1f} {rr:.1f} 0 0 {1 if ux * vy - uy * vx > 0 else 0} {p2[0]:.1f} {p2[1]:.1f}'
    return d

# --------------------------------------------------------------------------- render
def render(path, slug):
    D = Diagram(path)
    verts, kinds, group, elabels = build(D)
    # caja absoluta escalada
    B = {}
    for i in verts:
        x, y, w, h = D.box(i); B[i] = (x * S, y * S, w * S, h * S)
    content = [i for i in verts if kinds[i] != 'title']
    xs = [B[i][0] for i in content] + [B[i][0] + B[i][2] for i in content]
    ys = [B[i][1] for i in content] + [B[i][1] + B[i][3] for i in content]
    edges = [i for i, c in D.cells.items() if c.get('edge')]
    # puntos de aristas (absolutos escalados)
    E = []
    for i in edges:
        c, s = D.cells[i], D.st[i]
        src, tgt = c.get('source'), c.get('target')
        if src in D.cells and D.cells[src].get('edge') or tgt in D.cells and D.cells[tgt].get('edge'):
            src = src if src in B else None; tgt = tgt if tgt in B else None
        ox, oy = D.origin(c.get('parent'))
        g = c.find('mxGeometry')
        wps, sp, tp = [], None, None
        if g is not None:
            arr = g.find('Array')
            if arr is not None:
                wps = [((float(p.get('x') or 0) + ox) * S, (float(p.get('y') or 0) + oy) * S) for p in arr.findall('mxPoint')]
            for p in g.findall('mxPoint'):
                pt = ((float(p.get('x') or 0) + ox) * S, (float(p.get('y') or 0) + oy) * S)
                if p.get('as') == 'sourcePoint': sp = pt
                if p.get('as') == 'targetPoint': tp = pt
        sb = B.get(src) if src in B else None
        tb = B.get(tgt) if tgt in B else None
        if sb is None and sp is None or tb is None and tp is None: continue
        pts = route(sb, tb, wps, s, sp, tp)
        lab = label_lines(c.get('value')) + elabels.get(i, [])
        E.append(dict(id=i, s=src if sb else None, t=tgt if tb else None, pts=pts,
                      dash=s.get('dashed') == '1', arrow=s.get('endArrow', 'classic') != 'none',
                      start_arrow=s.get('startArrow', 'none') not in ('none', ''),
                      label=' '.join(lab), lx=float(g.get('x') or 0) if g is not None else 0.0))
        for p in pts: xs.append(p[0]); ys.append(p[1])
    minx, miny = min(xs) - 40, min(ys) - 40
    dx, dy = -minx, -miny
    for i in B: x, y, w, h = B[i]; B[i] = (x + dx, y + dy, w, h)
    for e in E: e['pts'] = [(round(p[0] + dx, 1), round(p[1] + dy, 1)) for p in e['pts']]
    VW = int(math.ceil((max(xs) + dx + 40) / 4) * 4)
    LEG_Y = max(ys) + dy + 36
    VH = int(math.ceil((LEG_Y + 50) / 4) * 4)
    # saltos en cruces
    vert = [(k, a[0], min(a[1], b[1]), max(a[1], b[1])) for k, e in enumerate(E) for a, b in zip(e['pts'], e['pts'][1:]) if a[0] == b[0]]
    for k, e in enumerate(E):
        e['hops'] = {}
        for j, (a, b) in enumerate(zip(e['pts'], e['pts'][1:])):
            if a[1] != b[1]: continue
            lo, hi = sorted((a[0], b[0]))
            hs = sorted({round(x, 1) for (m, x, y1, y2) in vert if m != k and lo + 9 < x < hi - 9 and y1 + 4 < a[1] < y2 - 4})
            if hs: e['hops'][j] = hs if b[0] > a[0] else hs[::-1]

    # ------------------------------------------------ pasos (Paso a Paso)
    nodes = [i for i in content if kinds[i] in ('task', 'term', 'gw', 'doc', 'db', 'ellipse')]
    flow = [e for e in E if e['arrow'] and e['s'] in B and e['t'] in B]
    out = defaultdict(list); indeg = defaultdict(int)
    for e in flow:
        out[e['s']].append(e['t']); indeg[e['t']] += 1
    starts = [i for i in nodes if norm(' '.join(label_lines(D.cells[i].get('value')))).startswith('INICIO')]
    if not starts: starts = [i for i in nodes if indeg[i] == 0 and out[i]] or nodes[:1]
    level = {}
    q = deque()
    for s0 in sorted(starts, key=lambda i: (B[i][1], B[i][0])):
        level[s0] = 0; q.append(s0)
    while q:
        u = q.popleft()
        for v in sorted(out[u], key=lambda i: (B[i][1], B[i][0])):
            if v not in level:
                level[v] = level[u] + 1; q.append(v)
    rest = [i for i in nodes if i not in level]
    mx = max(level.values(), default=0)
    for i in sorted(rest, key=lambda i: (B[i][0], B[i][1])):
        mx += 1; level[i] = mx
    # adjuntos (notas, documentos sin flujo, textos ligados) toman el nivel de su vecino
    attached = defaultdict(list)
    for e in E:
        a, b = e['s'], e['t']
        for x_, y_ in ((a, b), (b, a)):
            if x_ in B and y_ in level and x_ not in level and kinds.get(x_) in ('note', 'doc', 'db', 'task', 'gw', 'band', 'text'):
                attached[y_].append(x_)
    step_of = {}
    step = 0
    for lv in sorted(set(level.values())):
        members = sorted([i for i in level if level[i] == lv], key=lambda i: (B[i][1], B[i][0]))
        budget = 0; step += 1
        for i in members:
            # cuenta los conectores que aparecerán en este mismo paso (el otro extremo ya asignado o sin paso propio)
            cost = 1 + len(attached[i]) + sum(1 for e in E if (e['t'] == i and (e['s'] in step_of or e['s'] not in level))
                                               or (e['s'] == i and (e['t'] in step_of or e['t'] not in level)))
            if budget and budget + cost > 12:
                step += 1; budget = 0
            step_of[i] = step; budget += cost
            for a in attached[i]: step_of.setdefault(a, step)
    for e in E:
        ss = [step_of.get(e['s'], 0), step_of.get(e['t'], 0)]
        e['step'] = max(ss) if max(ss) else None
    STEPS = max([v for v in step_of.values()] + [1])

    # ------------------------------------------------ SVG
    o = [f'<svg viewBox="0 0 {VW} {VH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">']
    title = D.title or path.stem
    o.append(f'<title id="{slug}-title">{esc(title[:90])}</title>')
    o.append(f'<desc id="{slug}-desc">Flujograma convertido desde draw.io ({esc(path.name)}): carriles por responsable, actividades, decisiones y conexiones del proceso.</desc>')
    o.append(f'<defs><marker id="{slug}-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{MUTED}"/></marker>'
             f'<marker id="{slug}-arrow-start" markerWidth="8" markerHeight="6" refX="1" refY="3" orient="auto"><polygon points="8 0, 0 3, 8 6" fill="{MUTED}"/></marker></defs>')
    o.append(f'<rect width="{VW}" height="{VH}" fill="{PAPER}"/>')
    # carriles (de afuera hacia adentro)
    lanes = [i for i in content if kinds[i] == 'lane']
    depth = lambda i: 0 if kinds.get(D.cells[i].get('parent')) != 'lane' else 1 + depth(D.cells[i].get('parent'))
    lane_count = defaultdict(int)
    for i in sorted(lanes, key=lambda i: (depth(i), B[i][1], B[i][0])):
        x, y, w, h = B[i]; s = D.st[i]
        top = group[i] or i
        pal = palette(' '.join(label_lines(D.cells[top].get('value'))))
        par = D.cells[i].get('parent')
        lane_count[par] += 1
        fill = pal['lane'] if lane_count[par] % 2 else pal['lane2']
        ss = float(s.get('startSize', 23)) * S
        horiz = s.get('horizontal', '1') != '0'
        o.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="{fill}" stroke="{pal["ink"]}" stroke-opacity="{0.45 if depth(i) == 0 else 0.18}"/>')
        t = ' '.join(label_lines(D.cells[i].get('value')))
        if horiz:
            o.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{ss:.1f}" fill="{pal["band"]}" fill-opacity="{1 if depth(i) == 0 else 0.6}" stroke="{pal["ink"]}" stroke-opacity="0.25"/>')
            lines, fs = fit([t], w - 12, ss - 4, 9, 7, em=MONO)
            ty = y + ss / 2 + fs * 0.35 - (len(lines) - 1) * fs * 0.6
            for ln in lines:
                o.append(f'<text x="{x + w / 2:.1f}" y="{ty:.1f}" text-anchor="middle" font-family="{F_MONO}" font-size="{fs:g}" font-weight="{600 if depth(i) == 0 else 500}" fill="{pal["ink"] if depth(i) == 0 else MUTED}" letter-spacing="0.04em">{esc(ln)}</text>'); ty += fs * 1.2
        else:
            o.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{ss:.1f}" height="{h:.1f}" fill="{pal["band"]}" fill-opacity="{1 if depth(i) == 0 else 0.6}" stroke="{pal["ink"]}" stroke-opacity="0.25"/>')
            lines, fs = fit([t], h - 12, ss - 4, 9, 7, em=MONO)
            cx = x + ss / 2; cy = y + h / 2
            off = -(len(lines) - 1) * fs * 0.6
            for k, ln in enumerate(lines):
                xx = cx + fs * 0.35 + off + k * fs * 1.2
                o.append(f'<text x="{xx:.1f}" y="{cy:.1f}" transform="rotate(-90 {xx:.1f} {cy:.1f})" text-anchor="middle" font-family="{F_MONO}" font-size="{fs:g}" font-weight="{600 if depth(i) == 0 else 500}" fill="{pal["ink"] if depth(i) == 0 else MUTED}" letter-spacing="0.04em">{esc(ln)}</text>')
    # bandas transversales (estáticas)
    for i in content:
        if kinds[i] != 'band': continue
        x, y, w, h = B[i]
        o.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="4" fill="#fdf5dc" stroke="#d6b656"/>')
        t = label_lines(D.cells[i].get('value'))
        if h > w * 1.6:
            lines, fs = fit(t, h - 16, w - 8, 10, 7, em=MONO)
            cx, cy = x + w / 2, y + h / 2; off = -(len(lines) - 1) * fs * 0.6
            for k, ln in enumerate(lines):
                xx = cx + fs * 0.35 + off + k * fs * 1.2
                o.append(f'<text x="{xx:.1f}" y="{cy:.1f}" transform="rotate(-90 {xx:.1f} {cy:.1f})" text-anchor="middle" font-family="{F_MONO}" font-size="{fs:g}" fill="#7a5c0a" letter-spacing="0.06em">{esc(ln)}</text>')
        else:
            lines, fs = fit(t, w - 12, h - 6, 10, 7, em=MONO)
            ty = y + h / 2 + fs * 0.35 - (len(lines) - 1) * fs * 0.6
            for ln in lines:
                o.append(f'<text x="{x + w / 2:.1f}" y="{ty:.1f}" text-anchor="middle" font-family="{F_MONO}" font-size="{fs:g}" fill="#7a5c0a">{esc(ln)}</text>'); ty += fs * 1.2
    # conectores
    def item(stp):
        return f' data-motion-item data-step="{stp}"' if stp else ''
    for e in E:
        lab = f' ({e["label"]})' if e['label'] else ''
        nm = lambda i: ' '.join(label_lines(D.cells[i].get('value')))[:60] if i in D.cells else 'punto'
        o.append(f'<g{item(e["step"])} aria-label="{esc(nm(e["s"]) if e["s"] else "inicio")} → {esc(nm(e["t"]) if e["t"] else "fin")}{esc(lab)}">')
        col = '#7ea6e0' if e['dash'] and not e['arrow'] else MUTED
        mk = (f' marker-end="url(#{slug}-arrow)"' if e['arrow'] else '') + (f' marker-start="url(#{slug}-arrow-start)"' if e['start_arrow'] else '')
        dash = ' stroke-dasharray="5,4"' if e['dash'] else ''
        o.append(f'<path d="{path_d(e["pts"], e["hops"])}" fill="none" stroke="{col}" stroke-width="1.2"{dash}{mk}/>')
        if e['label']:
            # punto sobre la ruta según la posición relativa de draw.io (-1..1)
            pts = e['pts']; segl = [abs(b[0] - a[0]) + abs(b[1] - a[1]) for a, b in zip(pts, pts[1:])]
            tot = sum(segl) or 1; t = (min(max(e['lx'], -1), 1) + 1) / 2 * tot
            for (a, b), L in zip(zip(pts, pts[1:]), segl):
                if t <= L or (a, b) == (pts[-2], pts[-1]): break
                t -= L
            f_ = t / L if L else 0
            px, py = a[0] + (b[0] - a[0]) * f_, a[1] + (b[1] - a[1]) * f_
            txt = e['label']; w = len(txt) * 8 * MONO + 10; h = 12
            if a[1] == b[1]: rx, ry = px - w / 2, py - 8 - h
            else: rx, ry = px + 8, py - h / 2
            o.append(f'<rect x="{rx:.1f}" y="{ry:.1f}" width="{w:.1f}" height="{h}" rx="2" fill="{PAPER}"/><text x="{rx + w / 2:.1f}" y="{ry + 9:.1f}" text-anchor="middle" font-family="{F_MONO}" font-size="8" fill="{SOFT}" letter-spacing="0.04em">{esc(txt.upper())}</text>')
        o.append('</g>')
    # nodos
    for i in sorted(content, key=lambda i: (B[i][1], B[i][0])):
        k = kinds[i]
        if k in ('lane', 'band'): continue
        x, y, w, h = B[i]; s = D.st[i]; cx, cy = x + w / 2, y + h / 2
        lines = label_lines(D.cells[i].get('value'))
        pal = palette(' '.join(label_lines(D.cells[group[i]].get('value')))) if group.get(i) else None
        stp = step_of.get(i)
        g = []
        if k == 'text':
            long_ = sum(len(l) for l in lines) > 40
            em = SANS if long_ else MONO
            wl, fs = fit(lines, max(w - 4, 20), max(h, 12), 10 if long_ else 8.5, 7, em=em)
            left = s.get('align') == 'left'
            ty = (y + fs + 2) if left or long_ and s.get('verticalAlign') == 'top' else cy + fs * 0.35 - (len(wl) - 1) * fs * 0.6
            for ln in wl:
                t_ = ln if long_ else ln.upper()
                fam = F_SANS if long_ else F_MONO
                if left:
                    g.append(f'<text x="{x + 2:.1f}" y="{ty:.1f}" font-family="{fam}" font-size="{fs:g}" fill="{INK if long_ else SOFT}">{esc(t_)}</text>')
                else:
                    g.append(f'<text x="{cx:.1f}" y="{ty:.1f}" text-anchor="middle" font-family="{fam}" font-size="{fs:g}" fill="{INK if long_ else SOFT}">{esc(t_)}</text>')
                ty += fs * 1.2
            o.append(''.join(g)); continue
        if k == 'image':
            href = imagen_href(s.get('image', ''), D.path)
            if href:
                g.append(f'<image x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" href="{esc(href, quote=True)}" preserveAspectRatio="xMidYMid meet"/>')
            else:
                g.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#eef0f4" stroke="{MUTED}" stroke-dasharray="4,3"/>')
                g.append(f'<text x="{cx:.1f}" y="{cy + 3:.1f}" text-anchor="middle" font-family="{F_MONO}" font-size="8" fill="{MUTED}">IMAGEN NO DISPONIBLE</text>')
            ty = y + h + 12
            for ln in lines:
                g.append(f'<text x="{cx:.1f}" y="{ty:.1f}" text-anchor="middle" font-family="{F_SANS}" font-size="10" fill="{INK}">{esc(ln)}</text>'); ty += 12
            o.append(f'<g{item(stp)} aria-label="{esc(" ".join(lines) or "imagen")}">' + ''.join(g) + '</g>'); continue
        if k == 'term':
            end = norm(' '.join(lines)).startswith('FIN')
            r = min(h / 2, 18)
            g.append(f'<rect class="nb" x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{r:.1f}" fill="{INK if end else "#e3f1dc"}" stroke="{INK if end else "#3f7a2c"}" stroke-width="1.2"/>')
            wl, fs = fit(lines, w - 8, h - 2, 11, 7)
            g.append(f'<text x="{cx:.1f}" y="{cy + fs * 0.35:.1f}" text-anchor="middle" font-family="{F_SANS}" font-size="{fs:g}" font-weight="600" fill="{PAPER if end else INK}">{esc(" ".join(wl))}</text>')
        elif k == 'gw':
            g.append(f'<polygon class="nb" points="{cx:.1f},{y:.1f} {x + w:.1f},{cy:.1f} {cx:.1f},{y + h:.1f} {x:.1f},{cy:.1f}" fill="#fcefc7" stroke="{INK}" stroke-width="1.2"/>')
            wl, fs = fit(lines, w * 0.62, h * 0.62, 9.5, 7)
            ty = cy + fs * 0.35 - (len(wl) - 1) * fs * 0.6
            for ln in wl:
                g.append(f'<text x="{cx:.1f}" y="{ty:.1f}" text-anchor="middle" font-family="{F_SANS}" font-size="{fs:g}" font-weight="500" fill="{INK}">{esc(ln)}</text>'); ty += fs * 1.2
        elif k in ('note', 'doc', 'db'):
            fill0 = (s.get('fillColor') or '#dae8fc').lower()
            fill, stroke = NOTE_FILL.get(fill0, ('#e9f0fa', '#6c8ebf'))
            if k == 'note':
                f = 10
                g.append(f'<path class="nb" d="M{x:.1f} {y:.1f} H{x + w - f:.1f} L{x + w:.1f} {y + f:.1f} V{y + h:.1f} H{x:.1f} Z" fill="{fill}" stroke="{stroke}"/><path d="M{x + w - f:.1f} {y:.1f} V{y + f:.1f} H{x + w:.1f}" fill="none" stroke="{stroke}"/>')
            elif k == 'doc':
                g.append(f'<path class="nb" d="M{x:.1f} {y:.1f} H{x + w:.1f} V{y + h - 6:.1f} Q{x + w * 0.75:.1f} {y + h - 14:.1f} {cx:.1f} {y + h - 6:.1f} T{x:.1f} {y + h - 6:.1f} Z" fill="{fill}" stroke="{stroke}"/>')
            else:
                e_ = min(10, h / 6)
                g.append(f'<path class="nb" d="M{x:.1f} {y + e_:.1f} A{w / 2:.1f} {e_:.1f} 0 0 1 {x + w:.1f} {y + e_:.1f} V{y + h - e_:.1f} A{w / 2:.1f} {e_:.1f} 0 0 1 {x:.1f} {y + h - e_:.1f} Z" fill="{fill}" stroke="{stroke}"/><path d="M{x:.1f} {y + e_:.1f} A{w / 2:.1f} {e_:.1f} 0 0 0 {x + w:.1f} {y + e_:.1f}" fill="none" stroke="{stroke}"/>')
            top_pad = 2 * e_ + 4 if k == 'db' else 6
            wl, fs = fit(lines, w - 14, h - top_pad - (12 if k == 'doc' else 6), 8.5, 6.5, lh=1.2, em=MONO)
            align_left = s.get('align') == 'left' or k == 'doc' or len(wl) > 2
            ty = (y + top_pad + fs) if align_left else (cy + fs * 0.35 - (len(wl) - 1) * fs * 0.6)
            for ln in wl:
                bold = ' font-weight="600"' if ln.isupper() and len(ln) > 3 and align_left else ''
                if align_left:
                    g.append(f'<text x="{x + 7:.1f}" y="{ty:.1f}" font-family="{F_MONO}" font-size="{fs:g}"{bold} fill="{INK}">{esc(ln)}</text>')
                else:
                    g.append(f'<text x="{cx:.1f}" y="{ty:.1f}" text-anchor="middle" font-family="{F_MONO}" font-size="{fs:g}"{bold} fill="{INK}">{esc(ln)}</text>')
                ty += fs * 1.2
        else:  # task / ellipse
            fill0 = (s.get('fillColor') or 'none').lower()
            if pal:   # dentro de carriles: piel del sistema, borde del color del área
                ink, fill, sw, tcol, dash = pal['ink'], '#ffffff', 1.1, INK, ''
            else:     # fuera de carriles (p. ej. organigrama): el color codifica información, se conserva
                st0 = (s.get('strokeColor') or 'default').lower()
                ink = INK if st0 in ('default', 'none', '#000000') else st0
                fill = '#ffffff' if fill0 in ('none', 'default') else fill0
                sw = min(max(float(s.get('strokeWidth') or 1), 1), 3)
                tcol = (s.get('fontColor') or INK)
                if fill0 not in ('none', 'default') and int(fill0[1:3], 16) + int(fill0[3:5], 16) + int(fill0[5:7], 16) < 200:
                    tcol = '#ffffff'
                dash = ' stroke-dasharray="5,4"' if s.get('dashed') == '1' else ''
                if s.get('strokeColor') == 'none': ink = 'none'
            if k == 'ellipse':
                g.append(f'<ellipse class="nb" cx="{cx:.1f}" cy="{cy:.1f}" rx="{w / 2:.1f}" ry="{h / 2:.1f}" fill="{fill}" stroke="{ink}" stroke-width="{sw:g}"{dash}/>')
            else:
                g.append(f'<rect class="nb" x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{6 if s.get("rounded") == "1" or pal else 0}" fill="{fill}" stroke="{ink}" stroke-width="{sw:g}"{dash}/>')
            left = s.get('align') == 'left'
            wl, fs = fit(lines, w - 14, h - 6, 11.5, 7)
            ty = (y + 8 + fs) if left and s.get('verticalAlign', 'middle') == 'top' else cy + fs * 0.35 - (len(wl) - 1) * fs * 0.6
            for ln in wl:
                if left:
                    g.append(f'<text x="{x + 8:.1f}" y="{ty:.1f}" font-family="{F_SANS}" font-size="{fs:g}" font-weight="500" fill="{tcol}">{esc(ln)}</text>')
                else:
                    g.append(f'<text x="{cx:.1f}" y="{ty:.1f}" text-anchor="middle" font-family="{F_SANS}" font-size="{fs:g}" font-weight="600" fill="{tcol}">{esc(ln)}</text>')
                ty += fs * 1.2
        lab = ' '.join(lines)[:80] or k
        o.append(f'<g{item(stp)} aria-label="{esc(lab)}">' + ''.join(g) + '</g>')
    # leyenda
    lx, ly = 40, LEG_Y
    o.append(f'<line x1="40" y1="{ly - 16:.1f}" x2="{VW - 40}" y2="{ly - 16:.1f}" stroke="{INK}" stroke-opacity="0.10"/>')
    o.append(f'<text x="40" y="{ly + 3:.1f}" font-family="{F_MONO}" font-size="8" fill="{MUTED}" letter-spacing="0.14em">LEYENDA</text>')
    present = set(kinds[i] for i in content)
    items = [('task', 'Actividad'), ('term', 'Inicio / fin'), ('gw', 'Decisión'), ('note', 'Nota'), ('doc', 'Documento'),
             ('db', 'Base de datos'), ('flow', 'Flujo'), ('assoc', 'Asociación'), ('hop', 'Cruce sin conexión')]
    has_assoc = any(not e['arrow'] for e in E); has_hop = any(e['hops'] for e in E)
    lx = 110
    for k, t in items:
        if k in ('task', 'term', 'gw', 'note', 'doc', 'db') and k not in present: continue
        if k == 'assoc' and not has_assoc or k == 'hop' and not has_hop: continue
        if lx + 40 + len(t) * 8 * MONO > VW - 40: lx = 110; ly += 18
        if k == 'task': o.append(f'<rect x="{lx}" y="{ly - 6:.1f}" width="20" height="12" rx="3" fill="#fff" stroke="{INK}"/>')
        elif k == 'term': o.append(f'<rect x="{lx}" y="{ly - 6:.1f}" width="20" height="12" rx="6" fill="#e3f1dc" stroke="#3f7a2c"/>')
        elif k == 'gw': o.append(f'<polygon points="{lx + 10},{ly - 7:.1f} {lx + 18},{ly:.1f} {lx + 10},{ly + 7:.1f} {lx + 2},{ly:.1f}" fill="#fcefc7" stroke="{INK}"/>')
        elif k in ('note', 'doc', 'db'): o.append(f'<rect x="{lx}" y="{ly - 6:.1f}" width="20" height="12" fill="#e9f0fa" stroke="#6c8ebf"/>')
        elif k == 'flow': o.append(f'<path d="M{lx} {ly:.1f} H{lx + 18}" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#{slug}-arrow)"/>')
        elif k == 'assoc': o.append(f'<path d="M{lx} {ly:.1f} H{lx + 20}" stroke="#7ea6e0" stroke-width="1.2" stroke-dasharray="5,4"/>')
        elif k == 'hop': o.append(f'<path d="M{lx} {ly + 2:.1f} H{lx + 6} A4 4 0 0 1 {lx + 14} {ly + 2:.1f} H{lx + 20}" fill="none" stroke="{MUTED}" stroke-width="1.2"/><path d="M{lx + 10} {ly - 6:.1f} V{ly + 8:.1f}" stroke="{MUTED}" stroke-width="1.2"/>')
        o.append(f'<text x="{lx + 28}" y="{ly + 3:.1f}" font-family="{F_MONO}" font-size="8" fill="{MUTED}">{esc(t.upper())}</text>')
        lx += 40 + int(len(t) * 8 * MONO) + 24
    o.append('</svg>')
    VH = max(VH, int(math.ceil((ly + 30) / 4) * 4))
    o[0] = f'<svg viewBox="0 0 {VW} {VH}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">'
    o[4] = f'<rect width="{VW}" height="{VH}" fill="{PAPER}"/>'
    return dict(svg='\n'.join(o), VW=VW, VH=VH, steps=STEPS, title=title, nodes=len(nodes), edges=len(E),
                hops=sum(len(v) for e in E for v in e['hops'].values()))

# --------------------------------------------------------------------------- páginas
def page_static(R, name, slug):
    tpl = (SKILL / 'assets/template.html').read_text()
    head = tpl[:tpl.index('<body>')].replace('<html lang="en">', '<html lang="es">').replace('<title>Diagram</title>', f'<title>{esc(name)}</title>')
    head = head.replace('.frame { max-width: 1200px; width: 100%; }', '.frame { width: 100%; max-width: 100%; min-width: 0; }')
    head = head.replace('svg { width: 100%; min-width: 960px; display: block; }', f'svg {{ width: 100%; max-width: {R["VW"]}px; min-width: {R["VW"]}px; display: block; margin: 0 auto; }}')
    head = head.replace('align-items: center;', 'align-items: flex-start;')
    orient = 'portrait' if R['VH'] >= R['VW'] * 0.8 else 'landscape'
    head = head.replace('  </style>', f'    @page {{ size: A4 {orient}; margin: 8mm; }}\n'
                        '    @media print { body { padding: 0; min-height: 0; } h1 { margin-bottom: 6px; } svg { width: auto !important; min-width: 0 !important; max-width: 100%; height: auto; max-height: 86vh; } }\n'
                        '    .back { font: 500 12px/1.4 var(--font-mono); color: var(--color-muted); }\n  </style>')
    svg = R['svg'].replace(' data-motion-item', '').replace(f'{slug}-', f'{slug}-st-')
    svg = re_step.sub('', svg)
    return (head + f'<body>\n  <div class="frame">\n    <p class="eyebrow">Flujograma · {esc(name)}</p>\n    <h1>{esc(R["title"])}</h1>\n'
            f'    <div class="diagram-container">\n{svg}\n    </div>\n    <p class="back"><a href="index.html">← Índice</a> · <a href="{esc(name)}.html">Versión animada</a></p>\n  </div>\n</body>\n</html>\n'), orient

re_step = re.compile(r' data-step="\d+"')

def page_motion(R, name):
    tpl = (SKILL / 'assets/template-motion.html').read_text()
    css = tpl[tpl.index('<style>') + 7: tpl.index('</style>')]
    script = tpl[tpl.index('<script data-diagram-controls>'): tpl.index('</script>') + 9]
    css = css.replace('--motion-total: 3600ms;', '--motion-total: 8000ms;').replace('--motion-hold: 720ms;', '--motion-hold: 480ms;')
    css = css.replace('[data-motion-root] { width: min(100%, 1000px); }', '[data-motion-root] { width: 100%; }')
    css = css.replace('svg { display: block; width: 100%; min-width: 960px; }', f'svg {{ display: block; width: 100%; max-width: {R["VW"]}px; min-width: {R["VW"]}px; margin: 0 auto; }}')
    css = css.replace('place-items: center;', 'place-items: start center;')
    css += f'''
    .motion-ready[data-frame="step"] [data-motion-item].is-current .nb {{ stroke: {ACCENT}; stroke-width: 2.4; }}
    [data-motion-scrubber] {{ flex: 1 1 240px; min-width: 160px; accent-color: {ACCENT}; min-height: 44px; }}
    .lede {{ margin: -12px 0 20px; max-width: 72ch; color: var(--color-muted); font: 400 14px/1.5 var(--font-sans); }}
    .keyboard-help {{ color: var(--color-muted); font: 500 11px/1.4 var(--font-mono); }}
    .back {{ font: 500 12px/1.4 var(--font-mono); color: var(--color-muted); }}
'''
    n = R['steps']
    body = f'''<main data-motion-root data-motion-mode="step" data-motion-budget="extended" data-step-count="{n}" data-step-current="{n}" data-frame="static" data-static-frame="complete">
    <p class="eyebrow">Flujograma · {esc(name)} · Paso a Paso</p>
    <h1>{esc(R["title"])}</h1>
    <p class="lede">Recorre el proceso por etapas con los botones, la barra o las flechas del teclado. La etapa actual se resalta en naranja.</p>
    <div class="diagram-container">
{R["svg"]}
    </div>
    <div data-motion-controls role="group" aria-label="Controles de reproducción">
      <button type="button" data-motion-action="prev">Anterior</button>
      <button type="button" data-motion-action="play" aria-pressed="false">Reproducir</button>
      <button type="button" data-motion-action="pause" aria-pressed="true">Pausa</button>
      <button type="button" data-motion-action="next">Siguiente</button>
      <button type="button" data-motion-action="replay">Reiniciar</button>
      <input type="range" data-motion-scrubber aria-label="Paso">
      <span class="keyboard-help">←/→ paso · RePág/AvPág saltar · Espacio reproducir · R reiniciar · Inicio/Fin</span>
      <span data-motion-status-visible aria-hidden="true">Paso <span data-motion-step-label>{n}</span> de {n}</span>
    </div>
    <p class="sr-only" data-motion-status role="status" aria-live="polite" aria-atomic="true"></p>
    <noscript><p>La animación requiere JavaScript. Arriba se muestra el diagrama completo.</p></noscript>
    <p class="back"><a href="index.html">← Índice</a> · <a href="{esc(name)}_estatico.html">Versión estática</a></p>
  </main>'''
    head = tpl[:tpl.index('<style>')].replace('<html lang="en">', '<html lang="es">').replace('<title>Motion diagram template</title>', f'<title>{esc(name)}</title>')
    return f'{head}<style>{css}</style>\n</head>\n<body>\n  {body}\n\n  {script}\n</body>\n</html>\n'

def clean_name(stem):
    stem = re.sub(r'#U([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), stem)
    return stem

def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='+')
    ap.add_argument('--out', default=str(HERE))
    a = ap.parse_args()
    files = []
    for s in a.src:
        p = pathlib.Path(s)
        files += sorted(p.glob('*.drawio')) if p.is_dir() else [p]
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    rows = []
    for f in files:
        name = clean_name(f.stem); slug = 'fg-' + slugify(name)
        R = render(f, slug)
        (out / f'{name}.html').write_text(page_motion(R, name))
        st, orient = page_static(R, name, slug)
        (out / f'{name}_estatico.html').write_text(st)
        rows.append((name, R, orient))
        print(f'{name:38s} {R["VW"]}x{R["VH"]} nodos={R["nodes"]} conectores={R["edges"]} cruces={R["hops"]} pasos={R["steps"]} A4 {orient}')
    idx = ['<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
           '<title>Flujogramas · Oficina Técnica</title>',
           '<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Geist:wght@400;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">',
           '<style>:root{--paper:#f5f5f5;--ink:#2d3142;--muted:#4f5d75;--accent:#bf4520}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.5 Geist,system-ui,sans-serif;padding:40px 16px}'
           'main{max-width:980px;margin:0 auto}h1{font:400 34px/1.1 "Instrument Serif",serif;margin:0 0 6px}.eyebrow{font:500 11px "Geist Mono",monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}'
           'table{width:100%;border-collapse:collapse;margin-top:24px;background:#fff;border:1px solid #d9dbe1}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e6e8ee;vertical-align:top}'
           'th{font:600 11px "Geist Mono",monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:#f0f1f4}td.n{font-family:"Geist Mono",monospace;color:var(--muted);white-space:nowrap}'
           'a{color:#2e5aa8}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.wrap{overflow-x:auto}</style></head><body><main>',
           '<p class="eyebrow">Oficina Técnica · Flujogramas</p><h1>Flujogramas de procesos</h1>',
           '<p style="color:#4f5d75;max-width:70ch">Cada flujograma tiene una versión animada (Paso a Paso) y una estática para imprimir en A4.</p>',
           '<div class="wrap"><table><thead><tr><th>Archivo</th><th>Título</th><th>Elementos</th><th>Ver</th></tr></thead><tbody>']
    for name, R, orient in rows:
        idx.append(f'<tr><td class="n">{esc(name)}</td><td>{esc(R["title"])}</td><td class="n">{R["nodes"]} act. · {R["edges"]} con. · {R["steps"]} pasos</td>'
                   f'<td><a href="{esc(name)}.html">Animado</a> · <a href="{esc(name)}_estatico.html">Estático</a> · <a href="pdf/{esc(name)}_A4.pdf">PDF A4</a></td></tr>')
    idx.append('</tbody></table></div></main></body></html>')
    (out / 'index.html').write_text('\n'.join(idx))
    (out / 'manifest.txt').write_text('\n'.join(f'{n}\t{o}' for n, _, o in rows))

if __name__ == '__main__':
    main()


# --------------------------------------------------------------------------- portal: páginas, compresión, imágenes
def imagen_href(ref, origen):
    """Devuelve un data URI usable sin internet, o None si la imagen no se puede incrustar."""
    ref = (ref or '').strip()
    if not ref: return None
    if ref.startswith('data:'):
        # draw.io guarda «data:image/png,AAAA» (sin ;base64)
        head, _, data = ref.partition(',')
        if ';base64' not in head and not head.startswith('data:image/svg+xml'):
            head += ';base64'
        return head + ',' + data
    if re.match(r'https?://', ref):
        return None                      # sin internet: no se descarga
    p = (pathlib.Path(origen).parent / urllib.parse.unquote(ref)).resolve()
    if p.exists():
        mime = mimetypes.guess_type(p.name)[0] or 'image/png'
        return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()
    return None

def _descomprimir(texto):
    data = base64.b64decode(texto.strip())
    try:
        xml = zlib.decompress(data, -15).decode('utf-8')
    except zlib.error:
        xml = zlib.decompress(data).decode('utf-8')
    return urllib.parse.unquote(xml)

def leer_paginas(ruta):
    """Lista de (nombre_de_página, xml_del_mxGraphModel) de un .drawio (comprimido o no, una o varias páginas)."""
    ruta = pathlib.Path(ruta)
    raiz = ET.fromstring(ruta.read_bytes())
    if raiz.tag == 'mxGraphModel':
        return [(ruta.stem, ET.tostring(raiz, encoding='unicode'))]
    paginas = []
    for k, dg in enumerate(raiz.iter('diagram'), 1):
        nombre = dg.get('name') or f'Página {k}'
        modelo = dg.find('mxGraphModel')
        if modelo is not None:
            xml = ET.tostring(modelo, encoding='unicode')
        elif (dg.text or '').strip():
            xml = _descomprimir(dg.text)
        else:
            continue
        paginas.append((nombre, xml))
    return paginas

def svg_de_pagina(ruta, nombre, xml, slug):
    """Dibuja una página con el motor (render) y devuelve su resultado (svg, VW, VH, steps...)."""
    ruta = pathlib.Path(ruta)
    tmpdir = pathlib.Path(tempfile.mkdtemp())
    # el archivo temporal queda junto a un enlace lógico a la carpeta original (para imágenes relativas)
    tmp = tmpdir / (re.sub(r'[\\/:*?"<>|]', '_', nombre) + '.drawio')
    tmp.write_text(f'<mxfile><diagram name="{esc(nombre, quote=True)}">{xml}</diagram></mxfile>', encoding='utf-8')
    _ORIGEN[str(tmp)] = str(ruta)
    try:
        return render(tmp, slug)
    finally:
        _ORIGEN.pop(str(tmp), None)
        import shutil; shutil.rmtree(tmpdir, ignore_errors=True)

_ORIGEN = {}
_imagen_href_base = imagen_href
def imagen_href(ref, origen):  # noqa: F811  (resuelve rutas relativas contra el .drawio original)
    return _imagen_href_base(ref, _ORIGEN.get(str(origen), origen))
