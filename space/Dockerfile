FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2
WORKDIR /home/user/app

# CPU-only PyTorch, then the owner's IndicPhotoOCR fork (YOLO11n default detector).
RUN pip install --no-cache-dir --user --index-url https://download.pytorch.org/whl/cpu torch==2.5.0 torchvision==0.20.0
# Editable install from a clone: the fork's setup.py (find_packages) skips
# folders without __init__.py, so a plain pip install misses modules.
ARG OCR_COMMIT=37db485
RUN git clone https://github.com/Asadalk/IndicPhotoOCR.git /home/user/IndicPhotoOCR && cd /home/user/IndicPhotoOCR \
 && git checkout ${OCR_COMMIT} && pip install --no-cache-dir --user -e . ultralytics==8.3.227
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# semantic-hire at a pinned commit; build its FAISS index the way the repo does.
ARG SH_COMMIT=50d4049
RUN git clone https://github.com/Asadalk/semantic-hire.git semantic-hire && cd semantic-hire && git checkout ${SH_COMMIT} \
 && python scripts/build_index.py

COPY --chown=user prefetch.py server.py embeddings.json ./
# Download every OCR weight at build time so no visitor waits for it.
RUN python prefetch.py

EXPOSE 7860
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
