FROM rust:1.83-slim AS builder
WORKDIR /src
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY rust-toolchain.toml ./
RUN mkdir -p src \
    && printf 'fn main() {}\n' > src/main.rs \
    && printf '' > src/lib.rs \
    && cargo build --release --bin projx \
    && rm -rf src target/release/deps/projx*
COPY src ./src
RUN cargo build --release --bin projx --locked

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /src/target/release/projx /app
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app"]
