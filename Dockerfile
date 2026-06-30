FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kanbanodon ./cmd/server

FROM alpine:3.20
RUN adduser -D -H -u 10001 kanbanodon
WORKDIR /app
COPY --from=build /out/kanbanodon /app/kanbanodon
COPY web /app/web
RUN mkdir -p /data && chown -R kanbanodon:kanbanodon /data /app
USER kanbanodon
ENV KANBANODON_ADDR=:8080
ENV KANBANODON_DATA_DIR=/data
ENV KANBANODON_AUTH_MODE=local
EXPOSE 8080
VOLUME ["/data"]
CMD ["/app/kanbanodon"]
