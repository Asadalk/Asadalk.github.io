# YOLO11n browser parity

The browser demo must find the same text boxes as Python Ultralytics. This folder holds the scripts and the latest results.

## Result (2026-10-16): PASS

9 photos, 322 boxes. Every box on each side has a partner on the other with IoU ≥ 0.95. Worst case 0.984; all other photos ≥ 0.9994. Backend: WebAssembly (onnxruntime-web 1.30.0) in Chrome, against Python Ultralytics 8.3.227 running the same ONNX file.

| Photo | Python | Browser | Worst IoU |
| --- | ---: | ---: | ---: |
| chandni-chowk-ghantewala | 18 | 18 | 0.9998 |
| chennai-steel-shops | 2 | 2 | 0.9839 |
| chennai-tnagar-diwali | 16 | 16 | 0.9999 |
| jodhpur-market | 6 | 6 | 0.9997 |
| kodak-fuji-shop | 118 | 118 | 0.9996 |
| kolkata-college-street | 0 | 0 | — |
| paharganj-evening | 52 | 52 | 0.9996 |
| paharganj-main-bazaar | 48 | 48 | 0.9994 |
| sample-paharganj (the site's sample) | 44 | 44 | 0.9994 |

Photos are from Wikimedia Commons under CC BY / CC BY-SA licences (`image-sources.json`). Only the sample is published on the site, with attribution.

## What the first run caught

The first version resized images with ordinary floating-point bilinear interpolation. It failed: two borderline boxes (scores 0.254 and 0.251, just over the 0.25 threshold) vanished, and two NMS ties resolved differently.

- `decode-check.mjs` showed Chrome and OpenCV decode the JPEGs to identical pixels.
- Feeding the TypeScript tensor into Python's own ONNX Runtime reproduced the exact failures, so the runtime was not at fault.
- The cause was the resize: OpenCV computes coordinates in float32 and weights in 11-bit fixed point, then rounds with `((s0>>4)·b0 >> 16) + ((s1>>4)·b1 >> 16) + 2 >> 2`. The float version was one grey level off on about 10% of pixels.

`src/lib/yolo.ts` now ports that arithmetic exactly: 0 differing values out of 3.3 million on the tested photos. It is the same class of bug as the TextBPN++ normalization mismatch in the research.

## Why the `.pt` column differs

`python.json` also has results from the original PyTorch checkpoint. Those differ by design: for `.pt` models Ultralytics pads only to a multiple of 32 (rectangular inference), while a fixed-shape ONNX model is padded to the full 1280 × 1280 square. The browser uses the ONNX model, so ONNX is the reference.

## Re-running

```sh
# Python reference (venv with ultralytics==8.3.227, onnx==1.19.1, onnxruntime)
YOLO_AUTOINSTALL=false python python_reference.py model.onnx model.pt <images> python.json
npm run build
node run-browser.mjs <images> browser-wasm.json wasm
python compare.py python.json browser-wasm.json onnx
```

WebGPU was not part of this run: headless Chrome on the test machine has no stable WebGPU adapter. The WebGPU path runs the same pre- and post-processing code, so only GPU float arithmetic can differ.
