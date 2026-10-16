"""Deploy the portfolio API (server.py) on Modal.

    modal deploy space/modal_app.py

CPU only, scales to zero when idle. The image bakes in every OCR weight so a
cold start only loads models from disk.
"""
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
OCR_COMMIT = "37db485"  # Asadalk/IndicPhotoOCR (YOLO11n default detector)
SH_COMMIT = "50d4049"  # Asadalk/semantic-hire

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.5.0", "torchvision==0.20.0", index_url="https://download.pytorch.org/whl/cpu")
    # Editable install from a clone: the fork's setup.py (find_packages) skips
    # folders without __init__.py, so a plain pip install misses modules.
    .run_commands(
        f"git clone https://github.com/Asadalk/IndicPhotoOCR.git /opt/IndicPhotoOCR && cd /opt/IndicPhotoOCR && git checkout {OCR_COMMIT}",
        "pip install -e /opt/IndicPhotoOCR ultralytics==8.3.227",
        f"git clone https://github.com/Asadalk/semantic-hire.git /opt/semantic-hire && cd /opt/semantic-hire && git checkout {SH_COMMIT}",
    )
    .pip_install_from_requirements(str(HERE / "requirements.txt"))
    .run_commands("cd /opt/semantic-hire && python scripts/build_index.py")
    .add_local_file(HERE / "prefetch.py", "/opt/app/prefetch.py", copy=True)
    .run_commands("cd /opt/app && python prefetch.py")
    .env({"SEMANTIC_HIRE_DIR": "/opt/semantic-hire", "OMP_NUM_THREADS": "2", "PYTHONUNBUFFERED": "1"})
    .add_local_file(HERE / "server.py", "/opt/app/server.py")
    .add_local_file(HERE / "embeddings.json", "/opt/app/embeddings.json")
)

app = modal.App("portfolio-api")


@app.function(image=image, cpu=2.0, memory=6144, timeout=300, scaledown_window=300)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def api():
    import sys

    sys.path.insert(0, "/opt/app")
    from server import app as fastapi_app

    return fastapi_app
