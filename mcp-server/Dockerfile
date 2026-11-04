FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8010

# MCP_TRANSPORT=streamable-http (set in docker-compose.uat.yml) is what
# makes this listen on the network instead of the stdio default server.py
# falls back to for local/Claude-Desktop use - see server.py's bottom for
# the full reasoning (including why MCP_API_KEY is mandatory under this
# transport).
CMD ["python", "server.py"]
