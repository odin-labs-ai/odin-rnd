FROM python@sha256:2b4f19dae3a777dfc3b76730bda1e82e1f66ab2a2686fa93ca78edbfb4f04ffe
COPY requirements.lock /tmp/requirements.lock
RUN python -m pip install --no-cache-dir --disable-pip-version-check --require-hashes --only-binary=:all: -r /tmp/requirements.lock && python -m pip check
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LANGCHAIN_TRACING_V2=false LANGSMITH_TRACING=false
WORKDIR /work
