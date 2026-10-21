# RunPod Serverless worker image (GPU). Build from the repository root:
#   docker build -f runpod/Dockerfile -t <registry>/aiversepulse-runpod .
FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-runtime
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/runpod-volume/.hf PYTHONPATH=/app/src
WORKDIR /app
COPY . .
RUN pip install -e "./src[ai]" runpod
CMD ["python", "runpod/handler.py"]
