"""Build deterministic, non-destructive Home Design Ver.1.4 asset variants."""

from __future__ import annotations

import base64
import json
import re
from io import BytesIO
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "supplier-nyan" / "assets" / "home-v1"
OUTPUT = ROOT / "supplier-nyan" / "assets" / "home-v1-optimized"
CANDIDATES = OUTPUT / "candidates"
ADOPTED = OUTPUT / "adopted"
LANCZOS = Image.Resampling.LANCZOS


def resized(image: Image.Image, width: int) -> Image.Image:
    height = round(image.height * width / image.width)
    return image.resize((width, height), LANCZOS)


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True, compress_level=9)


def save_webp(image: Image.Image, path: Path, quality: int = 90) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6, exact=True)


def save_pair(image: Image.Image, stem: str, quality: int = 90) -> None:
    save_png(image, CANDIDATES / f"{stem}.png")
    save_webp(image, CANDIDATES / f"{stem}-q{quality}.webp", quality)


def extract_app_icon() -> Image.Image:
    source = (ROOT / "supplier-nyan" / "supplier-nyan-cat-assets.html").read_text(
        encoding="utf-8"
    )
    match = re.search(r"Object\.freeze\((\{.*\})\)", source)
    if not match:
        raise RuntimeError("supplier cat asset manifest was not found")
    manifest = json.loads(match.group(1))
    payload = manifest["appIcon"].split(",", 1)[1]
    return Image.open(BytesIO(base64.b64decode(payload))).convert("RGBA")


def main() -> None:
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    ADOPTED.mkdir(parents=True, exist_ok=True)

    wood = Image.open(MASTER / "cards" / "AST-003_v1.0.png").convert("RGBA")
    for width in (1024, 960, 768):
        save_pair(resized(wood, width), f"wood-a-{width}", 90)

    forest = Image.open(MASTER / "backgrounds" / "AST-002_v1.0.png").convert("RGB")
    save_pair(resized(forest, 800), "forest-full-800", 88)
    # The Home hero uses the upper 1000px, including the canopy, lantern and path.
    forest_crop = forest.crop((0, 100, forest.width, 1100))
    save_pair(resized(forest_crop, 800), "forest-hero-crop-800", 88)

    explorer = Image.open(MASTER / "characters" / "AST-001_v1.0.png").convert("RGBA")
    for width in (700, 600):
        save_pair(resized(explorer, width), f"explorer-cat-{width}", 92)

    for side in ("Left", "Right"):
        grass = Image.open(
            MASTER / "decorations" / f"AST-011-{side}_v1.0.png"
        ).convert("RGBA")
        for width in (96, 84):
            save_pair(resized(grass, width), f"grass-{side.lower()}-{width}", 90)

    app_icon = extract_app_icon().resize((180, 180), LANCZOS)
    save_png(app_icon, CANDIDATES / "app-icon-180.png")

    adopted = {
        "card-wood-a.webp": CANDIDATES / "wood-a-960-q90.webp",
        "home-forest.webp": CANDIDATES / "forest-hero-crop-800-q88.webp",
        "explorer-cat.webp": CANDIDATES / "explorer-cat-700-q92.webp",
        "grass-left.webp": CANDIDATES / "grass-left-96-q90.webp",
        "grass-right.webp": CANDIDATES / "grass-right-96-q90.webp",
        "app-icon.png": CANDIDATES / "app-icon-180.png",
    }
    for name, source in adopted.items():
        (ADOPTED / name).write_bytes(source.read_bytes())


if __name__ == "__main__":
    main()
