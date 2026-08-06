# Home Design Ver.1.4 optimized assets

`../home-v1/` is the immutable master. Run
`scripts/optimize-supplier-nyan-home-assets.py` to rebuild this directory.

## Adopted assets

| Asset | Master | Adopted | Master bytes | Adopted bytes | Reduction |
| --- | --- | --- | ---: | ---: | ---: |
| WoodA | PNG 1536x1024 | WebP 960x640 q90 | 2,414,233 | 60,754 | 97.5% |
| Home forest | PNG 852x1846 | cropped WebP 800x939 q88 | 2,143,935 | 108,218 | 95.0% |
| Explorer cat | PNG 1131x1391 | transparent WebP 700x861 q92 | 1,267,959 | 94,782 | 92.5% |
| Left grass | PNG 552x516 | transparent WebP 96x90 q90 | 198,191 | 7,494 | 96.2% |
| Right grass | PNG 552x474 | transparent WebP 96x82 q90 | 192,297 | 6,880 | 96.4% |
| App icon | embedded PNG 512x512 | PNG 180x180 | 211,713 | 33,698 | 84.1% |

The `candidates/` directory retains the PNG and WebP comparison outputs.
WebP alpha is encoded with `exact=True`; validation found no alpha-channel
difference from the corresponding resized PNG source.
