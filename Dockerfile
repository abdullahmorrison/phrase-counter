FROM python:3.13-alpine
WORKDIR /app
COPY server.py .
COPY public public
ENV DATA_FILE=/data/counts.json PORT=3020
EXPOSE 3020
CMD ["python", "-u", "server.py"]
