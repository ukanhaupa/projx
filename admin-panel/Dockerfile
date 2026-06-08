FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /admin ./cmd/admin

FROM gcr.io/distroless/static:nonroot
COPY --from=build /admin /admin
EXPOSE 8055
USER nonroot:nonroot
ENTRYPOINT ["/admin"]
