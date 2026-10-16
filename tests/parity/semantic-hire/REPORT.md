# semantic-hire parity: Python service vs. the in-browser port

**Result: identical top-5 rankings for all 8 evaluation queries**, both in Node and through the real page in Chrome. Largest score difference: 0.0002 (final score, 4-decimal values).

Run on 2026-10-16.

## What is compared

| Side | Code | Model | Output |
|---|---|---|---|
| Python (reference) | The repo's own `/match` handler (`app/main.py`), `JobRetriever.search`, `combine_scores`, `extract_skills`, at commit `50d4049` | `sentence-transformers/all-MiniLM-L6-v2` (PyTorch, fp32), exact FAISS `IndexFlatIP` | `python.json` |
| Browser port, in Node | `src/lib/matcher.ts`, `src/lib/embed-math.ts`, the committed job vectors in `src/content/generated/jobs.json` | Self-hosted `Xenova/all-MiniLM-L6-v2`: `onnx/model_fp16.onnx` for the query (what visitors download); jobs embedded at build time with `onnx/model.onnx` (fp32) | `browser.json` |
| Browser port, real page | The built site in Chrome 154 via Playwright, clicking "Try an example resume" through all 8 queries | Same files, onnxruntime-web WASM | `page.json` |

The 8 queries are the repo's `evaluation/queries.json` (copied to `src/content/data/semantic-hire/queries.json`). The ranking path is the API's: retrieve the 5 jobs with the highest cosine, re-rank them by 0.7 × semantic + 0.3 × skill overlap, ties by semantic score.

The only change to the Python path: the FAISS index is built in memory, exactly as `scripts/build_index.py` builds it, instead of being written into the repo.

## Results

| Query | Top 5 (Python = Node = page) |
|---|---|
| q1_nlp_search | job-001 job-023 job-003 job-012 job-020 |
| q2_recommendations | job-002 job-015 job-006 job-001 job-003 |
| q3_backend_python | job-007 job-022 job-014 job-010 job-024 |
| q4_frontend | job-009 job-024 job-010 job-017 job-004 |
| q5_vision | job-005 job-019 job-015 job-012 job-002 |
| q6_data_engineering | job-008 job-007 job-011 job-006 job-018 |
| q7_llm_rag | job-004 job-022 job-021 job-012 job-001 |
| q8_cloud | job-016 job-011 job-008 job-007 job-002 |

Matched and missing skills are identical too (checked by `compare.mjs`).

| Comparison | Identical rankings | Max \|Δ\| final (top 5) | Max \|Δ\| cosine (all 24 jobs) |
|---|---|---|---|
| Python vs. Node, fp16 query model (shipped) | 8/8 | 0.0002 | 0.00021 |
| Python vs. real page in Chrome (shipped) | 8/8 | 0.0002 | n/a |
| Python vs. Node, fp32 query model | 8/8 | 0.0000 | 0.000001 |
| Python vs. Node, 8-bit (`model_quantized.onnx`) | **6/8** | 0.0211 | 0.037 |

## Choosing the model file

- **8-bit (23 MB) fails.** It swaps job-012/job-020 in q1 and job-002/job-015 in q2.
- **fp16 (45 MB) passes**, with drift around 0.0002. This is what the site ships.
- **fp32 (90 MB) is exact** (drift 1e-6) but twice the download. The build scripts use it for the stored vectors, so only the visitor's query goes through fp16. It is git-ignored and never deployed.

Margin to watch: in q1, job-012 and job-020 score 0.6420 vs. 0.6419 in Python, a gap of 0.0001. fp16 keeps the order (in Node and in Chrome), but another resume could produce a near-tie that fp16 flips. The e2e test re-checks all 8 queries on every CI run.

## Faithful quirks

The port copies the repo's behaviour even where it is odd, because the goal is the same ranking:

- A skill followed directly by a full stop is not matched (`"Kubernetes."`), because the repo's regex treats `.` as part of a token so that `Node.js` works.
- Python's `\w` is Unicode-aware; JavaScript's is ASCII-only even with the `u` flag, so the port spells it out as `[\p{L}\p{N}_]`.
- Inputs are cut at 256 word pieces (sentence-transformers' `max_seq_length` for this model), not the tokenizer's 512.
- Ties are broken on the 4-decimal scores the API returns.

## Reproduce

```sh
# Python side (sentence-transformers, faiss-cpu, fastapi, python-dotenv; Python 3.11 used)
python tests/parity/semantic-hire/run_python.py /path/to/semantic-hire > tests/parity/semantic-hire/python.json

# Node side and comparison (needs the fp32 weights: npm run download-model)
npm run test:parity
node tests/parity/semantic-hire/run_browser.mjs --dtype q8 --out /tmp/q8.json   # 8-bit check
node tests/parity/semantic-hire/compare.mjs tests/parity/semantic-hire/python.json /tmp/q8.json

# Real page (also part of the normal e2e suite)
npm run build
PARITY_OUT=tests/parity/semantic-hire/page.json npx playwright test tests/e2e/ask.spec.ts -g semantic-hire --project=desktop --workers=1
```

Versions: Python 3.11.16, sentence-transformers 6.1.0, faiss-cpu 1.15.1, numpy 2.4.6, torch 2.14.1 (CPU); `@huggingface/transformers` 4.3.0 with onnxruntime-node 1.30.0 (Node 22.23) and onnxruntime-web 1.31.0-dev.20260914 (Chrome 154).
