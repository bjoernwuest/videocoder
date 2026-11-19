FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY src src
COPY public public
ENV INPUT_DIR=/input OUTPUT_DIR=/output DATA_DIR=/data PORT=8080
EXPOSE 8080
CMD ["bun", "src/index.ts"]
