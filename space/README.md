---
title: Asadullah Faisal portfolio API
emoji: 🔤
colorFrom: gray
colorTo: green
sdk: docker
app_port: 7860
pinned: false
license: mit
---

Backend for <https://asadalk.github.io>. Source: `space/` in the portfolio repo.

- `POST /ocr`: full scene-text OCR with the owner's IndicPhotoOCR fork (fine-tuned YOLO11n detection, EfficientNetV2-L script identification, PARSeq recognition). The toolkit and its models belong to the Bhashini / VL2G lab at IIT Jodhpur. Uploads are deleted right after processing.
- `POST /match`: semantic-hire's ranking (all-MiniLM-L6-v2 + FAISS IndexFlatIP, 0.7 semantic + 0.3 skill overlap), run from the repo at a pinned commit.
- `POST /search`: semantic search over the portfolio's content.
