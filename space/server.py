"""Portfolio API: full OCR, semantic search and the semantic-hire matcher.

Runs on a Hugging Face Space (CPU). Everything here calls the owner's real
code: the IndicPhotoOCR fork for OCR and the semantic-hire repo for matching.
Uploaded images are processed in memory/temp files and deleted immediately.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
SEMANTIC_HIRE = Path(os.getenv("SEMANTIC_HIRE_DIR", HERE / "semantic-hire"))
sys.path.insert(0, str(SEMANTIC_HIRE))

from app.ranking import combine_scores  # noqa: E402  (semantic-hire repo)
from app.retrieval import JobRetriever  # noqa: E402
from app.skills import extract_skills  # noqa: E402
from app.preprocess import clean_text  # noqa: E402

log = logging.getLogger("portfolio-api")
logging.basicConfig(level=logging.INFO)

MAX_UPLOAD = 12 * 1024 * 1024
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", "https://asadalk.github.io,http://localhost:4321,http://localhost:4336"
).split(",")

app = FastAPI(title="Asadullah Faisal portfolio API", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])

# ---------------------------------------------------------------- models ----
_lock = threading.Lock()
_ocr = None
_retriever: JobRetriever | None = None
_items: list[dict] | None = None
_item_matrix: np.ndarray | None = None


def ocr_engine():
    """The fork's end-to-end pipeline: YOLO11n → EfficientNetV2-L script ID → PARSeq."""
    global _ocr
    with _lock:
        if _ocr is None:
            from IndicPhotoOCR.ocr import OCR

            _ocr = OCR(device="cpu", detector="yolo", identifier_lang="auto", identifier_type="efficientnet")
            _warm_recognisers(_ocr)
    return _ocr


def _warm_recognisers(engine) -> None:
    """Load every PARSeq language model now (the fork loads them lazily, which
    added ~17 s to the first busy photo). Same calls as its recognise()."""
    import torch
    from IndicPhotoOCR.recognition.parseq_recogniser import model_info

    rec = engine.recogniser
    for lang in model_info:
        if lang not in rec._model_cache:
            rec._model_cache[lang] = rec.load_model(engine._torch_device, rec.ensure_model(lang))
    if "english" not in rec._model_cache:
        rec._model_cache["english"] = torch.hub.load("baudm/parseq", "parseq", pretrained=True, verbose=False).eval().to(engine._torch_device)


def retriever() -> JobRetriever:
    global _retriever
    with _lock:
        if _retriever is None:
            cwd = os.getcwd()
            os.chdir(SEMANTIC_HIRE)
            try:
                _retriever = JobRetriever()
            finally:
                os.chdir(cwd)
    return _retriever


def items() -> tuple[list[dict], np.ndarray]:
    """Site content vectors, embedded at build time with the same MiniLM model."""
    global _items, _item_matrix
    if _items is None:
        data = json.loads((HERE / "embeddings.json").read_text())
        _items = [{"id": i["id"], "type": i["type"], "title": i["title"]} for i in data["items"]]
        m = np.asarray([i["vector"] for i in data["items"]], dtype="float32")
        _item_matrix = m / np.linalg.norm(m, axis=1, keepdims=True)
    return _items, _item_matrix


# ---------------------------------------------------------------- routes ----
@app.get("/health")
def health() -> dict:
    return {"ok": True, "ocr_loaded": _ocr is not None, "matcher_loaded": _retriever is not None}


class SearchIn(BaseModel):
    query: str = Field(min_length=2, max_length=300)


@app.post("/search")
def search(body: SearchIn) -> dict:
    t0 = time.perf_counter()
    its, mat = items()
    q = retriever().model.encode([clean_text(body.query)], convert_to_numpy=True, normalize_embeddings=True)[0]
    scores = mat @ q.astype("float32")
    order = np.argsort(-scores)[:5]
    return {
        "results": [{**its[i], "score": round(float(scores[i]), 4)} for i in order],
        "ms": round((time.perf_counter() - t0) * 1000),
    }


class MatchIn(BaseModel):
    resume: str = Field(min_length=20, max_length=20000)
    top_k: int = Field(default=5, ge=1, le=20)


@app.post("/match")
def match(body: MatchIn) -> dict:
    """Same steps as semantic-hire's POST /match, without the optional Gemini explanation."""
    t0 = time.perf_counter()
    resume = clean_text(body.resume)
    resume_skills = extract_skills(resume)
    try:
        candidates = retriever().search(resume, body.top_k)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    ranked = []
    for job, cosine_score in candidates:
        semantic = max(0.0, min(1.0, cosine_score))
        job_skills = set(job["skills"]) | extract_skills(job["description"])
        score = combine_scores(semantic, resume_skills, job_skills)
        ranked.append({
            "job_id": job["job_id"],
            "title": job["title"],
            "company": job["company"],
            "location": job.get("location", ""),
            "semantic_score": round(score.semantic_score, 4),
            "skill_overlap_score": round(score.skill_overlap_score, 4),
            "final_score": round(score.final_score, 4),
            "matched_skills": sorted(resume_skills & job_skills, key=str.casefold),
            "missing_skills": sorted(job_skills - resume_skills, key=str.casefold),
        })
    ranked.sort(key=lambda r: (r["final_score"], r["semantic_score"]), reverse=True)
    return {"results": ranked, "resume_skills": sorted(resume_skills, key=str.casefold), "ms": round((time.perf_counter() - t0) * 1000)}


@app.post("/ocr")
async def ocr(image: UploadFile = File(...)) -> dict:
    data = await image.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="Image too large (max 12 MB).")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")
    t0 = time.perf_counter()
    engine = ocr_engine()
    t1 = time.perf_counter()
    suffix = Path(image.filename or "x.jpg").suffix.lower() or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(data)
        path = f.name
    crops: list[str] = []
    try:
        import cv2
        from IndicPhotoOCR.utils.helper import detect_para

        img = cv2.imread(path)
        if img is None:
            raise HTTPException(status_code=400, detail="Could not read that image.")
        h, w = img.shape[:2]
        detections = engine.detect(path)
        t2 = time.perf_counter()

        # The fork's own batched path (OCR.ocr with batch_size > 0), kept word-level.
        boxes, paths = [], []
        for bbox in detections:
            crop = engine.crop_bbox(img, bbox)
            if crop is None:
                continue
            xs = [p[0] for p in bbox]
            ys = [p[1] for p in bbox]
            boxes.append([float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))])
            paths.append(crop)
        crops = paths
        words = []
        if paths:
            langs = engine.identifier.identify_batch(paths, "auto", engine._pipeline_device, batch_size=16)
            t3 = time.perf_counter()
            by_lang: dict[str, list[int]] = {}
            for i, lang in enumerate(langs):
                by_lang.setdefault(lang, []).append(i)
            out: dict[int, tuple[str, float]] = {}
            for lang, idx in by_lang.items():
                res = engine.recogniser.recognise_batch(
                    lang, [paths[i] for i in idx], lang, False, engine._torch_device, return_confidence=True, batch_size=16
                )
                for i, (text, conf) in zip(idx, res):
                    out[i] = (text, float(conf))
            for i, box in enumerate(boxes):
                text, conf = out.get(i, ("", 0.0))
                words.append({"box": [round(v, 1) for v in box], "text": text, "script": langs[i], "confidence": round(conf, 3)})
        else:
            t3 = t2
        t4 = time.perf_counter()
        lines = detect_para({f"img_{i}": {"txt": wd["text"], "bbox": wd["box"]} for i, wd in enumerate(words)}) if words else []
        return {
            "width": w,
            "height": h,
            "words": words,
            "lines": lines,
            "timings_ms": {
                "model_load": round((t1 - t0) * 1000),
                "detect": round((t2 - t1) * 1000),
                "script_id": round((t3 - t2) * 1000),
                "recognise": round((t4 - t3) * 1000),
            },
        }
    finally:
        for p in [path, *crops]:
            try:
                os.remove(p)
            except OSError:
                pass


@app.on_event("startup")
def warm() -> None:
    """Load the light models at boot and the OCR stack in the background."""
    retriever()
    items()
    threading.Thread(target=ocr_engine, daemon=True).start()
