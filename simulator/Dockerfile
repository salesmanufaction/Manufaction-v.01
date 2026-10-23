FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY simulator.py .

RUN useradd --create-home --uid 10001 sim
USER sim

ENV PYTHONUNBUFFERED=1
CMD ["python", "simulator.py"]
