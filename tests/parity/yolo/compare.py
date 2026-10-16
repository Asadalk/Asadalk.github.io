"""Compare browser detections with Python Ultralytics.

Usage: python compare.py python.json browser.json [onnx|pt]
Pass: every box on each side has a partner with IoU >= 0.95 on the other side.
"""
import json
import sys


def iou(a, b):
    iw = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    ih = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = iw * ih
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def best(boxes, others):
    return [max((iou(b, o) for o in others), default=0.0) for b in boxes]


py = json.load(open(sys.argv[1]))
br = json.load(open(sys.argv[2]))
ref = sys.argv[3] if len(sys.argv) > 3 else "onnx"
ok = True
print(f"reference: python {ref} · browser backend: {br['backend']}")
print(f"{'image':28} {'py':>4} {'web':>4} {'min IoU py→web':>15} {'min IoU web→py':>15} {'<0.95':>6}")
for name, r in sorted(py[ref].items()):
    if name not in br["results"]:
        continue
    pb = r["boxes"]
    wb = [d["box"] for d in br["results"][name]["detections"]]
    a, b = best(pb, wb), best(wb, pb)
    bad = sum(x < 0.95 for x in a) + sum(x < 0.95 for x in b)
    ok &= bad == 0
    fmt = lambda xs: f"{min(xs):.4f}" if xs else "—"
    print(f"{name:28} {len(pb):4} {len(wb):4} {fmt(a):>15} {fmt(b):>15} {bad:6}")
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
