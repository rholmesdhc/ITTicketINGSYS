FROM python:3.12-slim

WORKDIR /app

# System deps for psycopg2-binary's runtime libpq needs
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8005

# Schema is provisioned by Alembic, not by the app itself (see main.py's
# comment on why models.Base.metadata.create_all() was retired) - so it
# has to run somewhere before the app starts serving traffic. Shell form
# (not the usual JSON-array CMD) specifically so `&&` works; `exec` hands
# off PID 1 to uvicorn afterward so it still receives signals correctly
# (SIGTERM on `docker stop`) instead of a lingering shell process eating them.
CMD alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8005
