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
| `.pdf` | Visor de PDF del navegador |
| `.html` | Aislado, con sus imágenes y estilos incrustados |
| Word `.docx` | Textos, títulos, listas, tablas e imágenes |
| Excel `.xlsx` / `.xlsm` | Tablas por hoja: valores, colores, celdas combinadas (sin formato condicional ni gráficos) |
| PowerPoint `.pptx` | Diapositivas con textos, imágenes y tablas en su posición |
| `.doc` / `.xls` / `.ppt` antiguos | Solo para descargar (guárdalos como `.docx` / `.xlsx` / `.pptx` para verlos) |

Todos los documentos tienen **Descargar original** y **Pantalla completa**; el **buscador** encuentra títulos,
datos de la ficha y el texto de los documentos (excepto dentro de los PDF).

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
| `generar_portal.py` | Versión Python y **plantilla del visor** compartida por ambas versiones |
| `motor_drawio.py` · `conversores_office.py` | Conversores de la versión Python |
| `fuentes/` | Figtree (licencia SIL OFL, ver `fuentes/OFL.txt`) |

Después de cambiar `web/` o la plantilla del visor en `generar_portal.py`, vuelve a ejecutar
`python construir_generador.py` y sube el `Generador de portal.html` actualizado.

**Por qué JavaScript para el generador:** los usuarios no tienen Python y la empresa bloquea los `.exe`;
Edge y Chrome ya están en todas las PCs y ejecutan JavaScript sin instalar nada.
