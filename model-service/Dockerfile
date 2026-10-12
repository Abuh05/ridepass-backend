# GPU image with vLLM (includes torch + CUDA). Build: docker build -t ridepass-models .
# Same vLLM version as requirements-gpu.txt (the bare-metal install), so both paths behave alike.
FROM vllm/vllm-openai:v0.11.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py start.sh llama3_chat_template.jinja ./
ENV KEEP_FOREGROUND=1 LOG_DIR=/srv/logs
EXPOSE 8000 9000
ENTRYPOINT ["/srv/start.sh"]
