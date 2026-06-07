# Directus

[Directus](https://directus.io) admin panel — an instant data studio and REST/GraphQL API over your Postgres database. It generates a CRUD admin UI for every table, plus the Insights module for dashboards and charts.

## Quick Start

Directus is a service in the project's root `docker-compose.yml`. Configure it, then bring it up with the rest of the stack:

```bash
cp .env.example .env          # set KEY, SECRET, ADMIN_PASSWORD, and DB_* for your Postgres
docker compose up --build directus
```

On first boot Directus creates its own `directus_*` tables in the configured database and seeds the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. It introspects every other table and exposes it through the admin UI and the API automatically.

## Access

The service is internal-only — it is `expose`d on port `8055` to the compose network, not published to the host. Reach the admin UI by routing to it through the frontend proxy, or for local admin work publish the port temporarily:

```bash
docker compose run --service-ports --rm directus
```

## Database

Directus connects to the Postgres pointed at by the `DB_*` vars in `.env`. Point it at the same database your backend uses to administer your application data, or at a dedicated database — Directus namespaces all of its own tables with the `directus_` prefix, so it coexists with application tables.

`.env.example` defaults to `localhost:5432` for the local-on-host workflow. As a container in the root compose, set `DB_HOST` to a host reachable from inside the container.

## Configuration

All settings are environment variables — see the [Directus config reference](https://docs.directus.io/self-hosted/config-options.html). The essentials:

| Variable                       | Purpose                                 |
| ------------------------------ | --------------------------------------- |
| `KEY`, `SECRET`                | Signing keys — required, set to randoms |
| `DB_HOST`/`DB_PORT`/`DB_*`     | Postgres connection                     |
| `ADMIN_EMAIL`/`ADMIN_PASSWORD` | First-boot admin account                |
| `PUBLIC_URL`                   | External URL the panel is served from   |

Custom extensions go in `extensions/`; uploaded files persist in `uploads/`.
