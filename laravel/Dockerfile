FROM public.ecr.aws/docker/library/composer:2 AS deps

WORKDIR /app

COPY composer.json composer.lock* ./

RUN composer install \
    --no-dev \
    --no-interaction \
    --no-progress \
    --no-scripts \
    --prefer-dist \
    --optimize-autoloader


FROM public.ecr.aws/docker/library/composer:2 AS build

WORKDIR /app

COPY --from=deps /app/vendor /app/vendor
COPY . /app

RUN composer dump-autoload --optimize --classmap-authoritative


FROM dunglas/frankenphp:1-php8.3-alpine AS runtime

ENV APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stdout \
    SERVER_NAME=:8000

WORKDIR /app

RUN apk add --no-cache postgresql-client libpq icu-libs \
    && install-php-extensions pdo_pgsql pcntl intl opcache \
    && adduser -D -u 1000 -G www-data app \
    && chown -R app:www-data /app

COPY --from=build --chown=app:www-data /app /app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:8000/api/health || exit 1

CMD ["frankenphp", "php-server", "--listen", ":8000", "--root", "public/"]
