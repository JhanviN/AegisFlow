FROM python:3.11-slim

WORKDIR /app

ENV PIP_DEFAULT_TIMEOUT=300 \
    PIP_RETRIES=5 \
    TRANSFORMERS_CACHE=/models \
    HF_HOME=/models

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip

# CPU-only PyTorch (~200 MB vs ~2 GB CUDA bundle) — PRD runs inference on container CPU
RUN pip install --no-cache-dir \
    torch==2.1.2+cpu \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Presidio dependency — install model separately for clearer build caching
RUN pip install --no-cache-dir \
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.7.1/en_core_web_sm-3.7.1-py3-none-any.whl

# Pre-download NER model at build time (retry on flaky networks)
RUN for i in 1 2 3; do \
      python -c "from transformers import pipeline; pipeline('ner', model='distilbert-base-uncased-finetuned-conll03-ner', aggregation_strategy='simple')" \
      && break || sleep 10; \
    done

COPY app/ ./app/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=120s \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
