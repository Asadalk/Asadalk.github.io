"""Reference detections from Python Ultralytics, for the browser parity test.

Usage: python python_reference.py <model.onnx> <model.pt> <images_dir> <out.json>

Runs the exported ONNX model and the original PyTorch checkpoint with the same
settings the fork uses (imgsz=1280, conf=0.25, iou=0.7) and writes boxes in
original-image pixels.
"""
import json
import sys
from pathlib import Path

from ultralytics import YOLO

onnx_path, pt_path, images_dir, out_path = sys.argv[1:5]
images = sorted(Path(images_dir).glob("*.jpg"))
out = {"settings": {"imgsz": 1280, "conf": 0.25, "iou": 0.7}, "onnx": {}, "pt": {}}

for key, path in (("onnx", onnx_path), ("pt", pt_path)):
    model = YOLO(path, task="detect")
    for img in images:
        r = model.predict(str(img), imgsz=1280, conf=0.25, iou=0.7, verbose=False)[0]
        out[key][img.stem] = {
            "shape": list(r.orig_shape),
            "boxes": [[round(v, 2) for v in b] for b in r.boxes.xyxy.tolist()],
            "scores": [round(s, 4) for s in r.boxes.conf.tolist()],
        }
        print(key, img.stem, r.orig_shape, len(r.boxes), flush=True)

Path(out_path).write_text(json.dumps(out))
