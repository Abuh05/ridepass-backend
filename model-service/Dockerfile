# GPU image with vLLM (includes torch + CUDA). Build: docker build -t ridepass-models .
FROM vllm/vllm-openai:v0.6.6
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py start.sh llama3_chat_template.jinja ./
EXPOSE 8000 9000
ENTRYPOINT ["/srv/start.sh"]
