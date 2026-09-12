FROM python:3.11-slim

WORKDIR /app

# Install FastAPI + uvicorn (only deps not already in stdlib)
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the full backend directory (engine src/ lives inside it)
COPY . ./

# Set GEMINI_API_KEY at runtime (injected via docker-compose env / .env)
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Run from /app so `from src.xxx import yyy` resolves correctly
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
