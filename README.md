# Portal de documentos (HTML sin internet)

Convierte **todos los archivos de una carpeta** (flujogramas, PDF, Word, Excel, PowerPoint, HTML) en
**un solo archivo HTML** con menú lateral, buscador y visor, que se guarda **en la misma carpeta** y se abre
sin internet. Usa la fuente **Figtree** (incrustada).

> Este repositorio guarda solo la **herramienta**. Los documentos viven en Google Drive o en la laptop;
> el portal generado (`<carpeta> - Portal.html`) queda junto a ellos.

## Para cualquier usuario (sin instalar nada)

1. Descarga **`Generador de portal.html`** y ábrelo con **Microsoft Edge** o **Google Chrome**.
2. Clic en **«Elegir carpeta…»** y elige la carpeta con los documentos. El navegador pide permiso para leer y guardar en ella: acéptalo.
3. Escribe el título (opcional) y clic en **«Generar portal»**.
4. El portal queda guardado en la misma carpeta como `<nombre de la carpeta> - Portal.html`. Clic en **«Abrir el portal»** para verlo.

No usa Python, ni programas `.exe`, ni internet: todo ocurre dentro del navegador.
Si la carpeta está en Google Drive, usa la carpeta sincronizada en la PC (Google Drive para escritorio).

### Qué hay en el portal

| Formato | Vista |
|---|---|
| `.drawio` | Dibujo con sus colores y formas originales; varias páginas, zoom, arrastre y **paso a paso** |
| `.pdf` | Cada página se revisa: las de texto y tablas (Word/Excel exportados) se reconstruyen como **HTML real**; las gráficas (diapositivas, degradados, fotos grandes, gráficos, diagramas o diseño libre) se muestran **idénticas al PDF** (imagen nítida) con el texto encima, seleccionable y buscable. Ninguna página sale desordenada |
| `.html` | Aislado, con sus imágenes y estilos incrustados |
| Word `.docx` | Textos, títulos, listas, tablas e imágenes (las EMF/WMF que llevan dentro una imagen común se muestran; las solo vectoriales quedan como recuadro) |
| Excel `.xlsx` / `.xlsm` | Tablas por hoja: valores, colores, celdas combinadas (sin formato condicional ni gráficos) |
| PowerPoint `.pptx` | Diapositivas con textos, imágenes y tablas en su posición |
| Libros `.epub` | El libro completo en HTML: capítulos en orden, índice con enlaces, estilos e imágenes (reducidas); buscable |
| `.doc` / `.xls` / `.ppt` antiguos | Solo para descargar (guárdalos como `.docx` / `.xlsx` / `.pptx` para verlos) |

Todos los documentos tienen **Descargar original** y **Pantalla completa**. Para que el portal sea liviano, los PDF, Word, Excel y PowerPoint no se copian dentro: «Descargar original» abre el archivo de la carpeta (el portal debe quedar junto a los documentos). Si vas a enviar el portal solo, marca «Incluir una copia de los originales». Las fotos grandes se reducen a 1600 px; el **buscador** encuentra títulos,
datos de la ficha y el texto de los documentos (incluido el de los PDF).

### Vista fiel de Word, Excel y PowerPoint

Si junto a un `.docx`, `.xlsx` o `.pptx` hay un **PDF con el mismo nombre** (exportado desde Office), el portal usa ese PDF como vista (fiel al original), no lo lista aparte, y «Descargar original» baja el archivo de Office. Sin PDF gemelo se usa la conversión propia, que puede variar.

### Configuración del portal (`Configuracion html … .xlsx`)

Si en la carpeta hay un Excel cuyo nombre empieza con **«Configuracion html»** (por ejemplo
`Configuracion html rev0.xlsx`, plantilla en `plantilla/`), el generador lo usa para organizar el portal:

| Columna A | Columna B | Columna C | Efecto |
|---|---|---|---|
| Título: | texto | — | Título del menú y del portal |
| Subtitulo: | texto | — | Línea bajo el título |
| Buscador: | cualquier texto (vacío o «No» lo oculta) | — | Muestra u oculta el buscador |
| Documentos: | — | — | Desde aquí, cada fila es un documento |
| Sección (Organigrama, Flujograma, Documentos en word…) | título a mostrar (o patrón) | **nombre del archivo** (opcional) | La fila define la sección, el orden y el título; si la columna C tiene el archivo, se usa ese archivo exacto |
| Excepciones para no colocar en el html: | nombre del archivo | — | Archivo que no entra al portal |

La columna B puede ser el **título a mostrar** (por ejemplo «Gestión de RFI · Subcontratista»): el generador lo relaciona con el archivo aunque el nombre difiera («FG_RFI SC revB.drawio»), usando las palabras clave y abreviaturas habituales (SC = Subcontratista, Sup = Supervisión, Act = Actualización…), y muestra ese título en el portal. También acepta **nombre exacto** (con o sin extensión); **«FG…»** = todos los que empiezan con FG;
**«…doc»**, **«… xls»**, **«…ppt»** = todos los de ese tipo. Un nombre exacto que no esté en la carpeta aparece
como «Pendiente»; los archivos que no coinciden con ninguna fila van a «Otros documentos». El Excel de
configuración y el generador nunca entran al portal.

### Menú, ficha y pendientes

- Cada **subcarpeta** es una sección del menú; los archivos sueltos van a «General».
- Opcional: en el generador, «Crear plantilla del índice». Complétala en Excel y guárdala en la carpeta como
  **`indice.csv`** o **`indice.xlsx`** con las columnas: Archivo · Titulo · Seccion · Orden · Revision · Responsable · Fecha · Estado · Nota.
  Las filas **sin archivo** aparecen como **Pendiente**.
- Se ignoran archivos temporales de Office (`~$…`) y carpetas o archivos que empiezan con `_` o `.`.
  El portal nunca se incluye a sí mismo.

## Versión en Python (para quien tenga Python)

La misma herramienta en Python, con una ventaja: si la PC tiene **Microsoft Office o LibreOffice**, convierte
Word, PowerPoint (y Excel con `--excel pdf`) a PDF con el formato exacto.

```
python generar_portal.py "C:\ruta\carpeta" --abrir
python generar_portal.py "C:\ruta\carpeta" --plantilla
```

En Windows también: doble clic en `generar_portal.bat` (o arrastrar la carpeta encima). Complementos opcionales:
`instalar_opcionales.bat` (openpyxl, pypdf, xlrd).

## Mantenimiento

| Archivo | Qué es |
|---|---|
| `Generador de portal.html` | **Entregable** para usuarios. Se arma con `python construir_generador.py` |
| `web/generador.js` · `web/generador_base.html` | Código del generador en el navegador (JavaScript) |
| `web/motor_drawio.js` | Motor de drawio: traducción fiel de `motor_drawio.py` (mismo dibujo: carriles con color, decisiones en ámbar, paso a paso) |
| `web/pdf_html.js` · `web/vendor/` | PDF → HTML. Usa PDF.js 3.11.174 (Apache-2.0, `web/vendor/PDFJS_LICENSE.txt`) solo para leer el PDF; la reconstrucción (párrafos, tablas, imágenes) la hace `pdf_html.js`; si una página no se puede reconstruir, queda dibujada como SVG |
| `web/office.js` | Word y PowerPoint: tema, estilos, numeración, tablas, páginas, cuadros de texto, formas, imágenes, patrón y diseño |
| `generar_portal.py` | Versión Python y **plantilla del visor** compartida por ambas versiones |
| `motor_drawio.py` · `conversores_office.py` | Conversores de la versión Python |
| `fuentes/` | Figtree (licencia SIL OFL, ver `fuentes/OFL.txt`) |

Después de cambiar `web/`, `motor_drawio.py` (mantener igual a `web/motor_drawio.js`) o la plantilla del visor en `generar_portal.py`, vuelve a ejecutar
`python construir_generador.py` y sube el `Generador de portal.html` actualizado.

**Por qué JavaScript para el generador:** los usuarios no tienen Python y la empresa bloquea los `.exe`;
Edge y Chrome ya están en todas las PCs y ejecutan JavaScript sin instalar nada.
