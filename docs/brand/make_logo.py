# ロゴの SVG を作る（文字は M PLUS Rounded 1c ExtraBold をアウトライン化）
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

font_path, out_dir = sys.argv[1], sys.argv[2]
font = TTFont(font_path)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font["head"].unitsPerEm

def text_path(text, x, baseline, size, track=0):
    s = size / upm
    pen = SVGPathPen(gs)
    bp = BoundsPen(gs)
    cx = 0
    for ch in text:
        g = cmap[ord(ch)]
        t = (s, 0, 0, -s, x + cx * s, baseline)
        gs[g].draw(TransformPen(pen, t))
        gs[g].draw(TransformPen(bp, t))
        cx += font["hmtx"][g][0] + track
    return pen.getCommands(), bp.bounds

THEMES = {
    "": dict(arc="#c8553d", track="#e8b9ac", dot="#3a2a25", text="#3a2a25"),
    "-dark": dict(arc="#e2735a", track="#6b3a2f", dot="#f5ebe7", text="#f5ebe7"),
}

def mark(c):
    return (f'<circle cx="50" cy="54" r="22" fill="none" stroke="{c["track"]}" stroke-width="10"/>'
            f'<path d="M50 32A22 22 0 1 1 28 54" fill="none" stroke="{c["arc"]}" stroke-width="10" stroke-linecap="round"/>'
            f'<path d="M47 20H53" stroke="{c["arc"]}" stroke-width="8" stroke-linecap="round"/>'
            f'<circle cx="50" cy="54" r="5" fill="{c["dot"]}"/>')

# 輪の下端（y=81）を文字の並ぶ線に揃え、O を頭文字の大文字として読ませる
d, (x0, y0, x1, y1) = text_path("tosazu", 84, 80, 62, track=-30)
pad = 8
vb_x, vb_y = 23 - pad, 16 - pad
vb_w, vb_h = x1 + pad - vb_x, 81 + pad - vb_y
for suffix, c in THEMES.items():
    logo = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb_x} {vb_y} {vb_w:.1f} {vb_h}">'
            f'<title>Otosazu</title>{mark(c)}<path d="{d}" fill="{c["text"]}"/></svg>\n')
    open(os.path.join(out_dir, f"otosazu-logo{suffix}.svg"), "w", encoding="utf-8").write(logo)
    m = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 8.5 80 80">'
         f'<title>Otosazu</title>{mark(c)}</svg>\n')
    open(os.path.join(out_dir, f"otosazu-mark{suffix}.svg"), "w", encoding="utf-8").write(m)
print("text bounds", x0, y0, x1, y1)
