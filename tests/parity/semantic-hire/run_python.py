"""Reference side of the parity test: semantic-hire's own Python code.

Runs the repo's real /match handler (app/main.py) on the 8 evaluation
queries, with its real JobRetriever.search, combine_scores and
extract_skills. The only difference from the deployed service is that the
FAISS index is built in memory (exactly as scripts/build_index.py builds it)
instead of being written into the repo, which stays read-only.

    python run_python.py /path/to/semantic-hire > python.json

Needs: sentence-transformers, faiss-cpu, fastapi, python-dotenv.
"""
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
repo = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(repo))

import faiss  # noqa: E402
import numpy as np  # noqa: E402
import sentence_transformers  # noqa: E402

from app import main  # noqa: E402
from app.retrieval import DEFAULT_MODEL, JobRetriever, _job_text, _model, load_jobs  # noqa: E402

jobs = load_jobs(repo / "data" / "jobs.json")
model = _model(DEFAULT_MODEL)

# scripts/build_index.py → app.retrieval.build_index, minus the file writes.
vectors = model.encode([_job_text(j) for j in jobs], convert_to_numpy=True, normalize_embeddings=True)
index = faiss.IndexFlatIP(vectors.shape[1])
index.add(np.asarray(vectors, dtype="float32"))

retriever = JobRetriever.__new__(JobRetriever)
retriever.jobs, retriever.index, retriever.model = jobs, index, model
retriever.metadata = {"model": DEFAULT_MODEL}
main.app.state.retriever = retriever

queries = json.loads((repo / "evaluation" / "queries.json").read_text(encoding="utf-8"))
out = []
for q in queries:
    response = main.match(main.MatchRequest(resume_text=q["resume_text"], top_k=5))
    cosines = {job["job_id"]: round(score, 6) for job, score in retriever.search(q["resume_text"], len(jobs))}
    out.append({
        "query_id": q["query_id"],
        "top5": [
            {
                "job_id": r.job_id,
                "semantic": r.semantic_score,
                "skill": r.skill_overlap_score,
                "final": r.final_score,
                "matched": r.matched_skills,
                "missing": r.missing_skills,
            }
            for r in response.results
        ],
        "cosines": cosines,
    })

json.dump({
    "side": "python",
    "model": DEFAULT_MODEL,
    "versions": {
        "python": sys.version.split()[0],
        "sentence_transformers": sentence_transformers.__version__,
        "faiss": faiss.__version__,
        "numpy": np.__version__,
    },
    "queries": out,
}, sys.stdout, indent=1)
print()
