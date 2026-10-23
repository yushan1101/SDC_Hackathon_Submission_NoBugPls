from pathlib import Path
import pymupdf
source = Path('attached_assets/Domain_1_1792732071274.pdf')
out = Path('.agents/outputs/domain1_brief')
out.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open(source)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
    pix.save(out / f'page-{i+1:02d}.png')
print(f'Rendered {len(doc)} pages to {out}')
