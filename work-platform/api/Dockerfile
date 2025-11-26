# Phase 0: Claude Agent SDK Infrastructure
# This Dockerfile adds Node.js + Claude Code CLI to support Claude Agent SDK Python wrapper

FROM python:3.10-slim

# Install Node.js 18.x (REQUIRED for Claude Code CLI)
# The Python SDK wraps the Claude Code CLI which is a Node.js application
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify Node.js and npm installed
RUN node --version && npm --version

# Install Claude Code CLI globally
# The Python SDK (claude-agent-sdk) wraps this CLI, so it must be installed
RUN npm install -g @anthropic-ai/claude-code

# Verify Claude Code CLI is accessible
RUN which claude-code && claude-code --version

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Add /app/src to PYTHONPATH so yarnnn_agents can be imported
ENV PYTHONPATH="/app/src:${PYTHONPATH}"

# Expose port (Render will set PORT env var)
EXPOSE 10000

# Start application
# Use PORT env var from Render, fallback to 10000 for local dev
CMD uvicorn src.app.agent_server:app --host 0.0.0.0 --port ${PORT:-10000} --log-level debug
