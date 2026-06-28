FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download NER model at build time
ENV TRANSFORMERS_CACHE=/models
ENV HF_HOME=/models
RUN python -c "from transformers import pipeline; pipeline('ner', model='distilbert-base-uncased-finetuned-conll03-ner', aggregation_strategy='simple')"

COPY app/ ./app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
