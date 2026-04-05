# Projx — Requirements

---

## Context

Projx is a production-grade, multi-stack application template system. Not a single template — a family of templates covering the two backend stacks and two frontend stacks we support, sharing a common infrastructure layer, design system, auth architecture, and developer experience.

Every new SaaS product, enterprise application, or client project starts from this template system. The team picks a backend stack and a frontend stack, gets a fully wired application with auth, CRUD, CI/CD, infrastructure, and testing — and starts writing business logic on day one.

**This is not a prototype or a starter kit.** This is the production foundation that ships to clients. Every template must be enterprise-grade: secure, tested, documented, and deployable.

---

## 1. Backend Templates

Each backend template provides the same capabilities — auto-entity CRUD, auth, middleware, testing — implemented idiomatically for its stack.

### 1.1 FastAPI (Python)

- **Use when**: AI/ML projects, data pipelines, Python-heavy integrations
- Auto-entity discovery: drop a model file, get full CRUD API
- SQLAlchemy 2.0 async (asyncpg, aiosqlite, aiomysql)
- Alembic migrations with auto-detection
- Pydantic v2 schema generation from models
- Loguru structured logging with request ID correlation
- UV package manager
- pytest + pytest-asyncio, 80% coverage enforced
- Scaffolding CLI for entities and tests
- **Status**: Built and functional (`fastapi/`)

### 1.2 Fastify (Node.js/TypeScript)

- **Use when**: General web apps, microservices, non-AI projects (default backend)
- Plugin-based architecture with auto-route loading
- Prisma ORM (TypeScript-native, generated types, auto-migrations)
- TypeBox for type-safe JSON Schema validation
- Pino structured logging (Fastify built-in)
- pnpm package manager
- Vitest + `fastify.inject()` for testing
- @fastify/swagger for auto-generated OpenAPI docs
- Entity module pattern mirroring FastAPI's auto-discovery

### 1.3 Shared Backend Capabilities (all templates)

Every backend template must provide:

- **Auto-entity CRUD**: Define a model → GET (list + single), POST, PATCH, DELETE, bulk operations
- **Query engine**: Pagination, full-text search, filtering (exact, range, IN, null), sorting, FK expansion
- **Auth**: Pluggable JWT providers (shared_secret, public_key, JWKS, auto-detect)
- **Authorization**: Permission model `<resource>:<action>.<scope>`
- **Middleware**: CORS, request ID correlation, auth extraction, permission checking
- **Health check**: `/api/health` with DB connectivity verification
- **Metadata endpoint**: `GET /api/v1/_meta` for frontend auto-discovery
- **Soft delete**: Optional per-entity
- **Database**: PostgreSQL primary, with stack-appropriate ORM
- **Migrations**: Automated schema versioning
- **Testing**: 80% coverage minimum, reusable base test class, test scaffolding
- **Logging**: Structured JSON with request ID correlation
- **Error handling**: Standardized error response format across all stacks

---

## 2. Frontend Templates

### 2.1 React (Web — SPA + SSR/SSG)

- **Use when**: Web applications, admin panels, dashboards, internal tools, SEO-critical apps, marketing sites with dynamic content
- React 19 + TypeScript strict + Vite 6
- Auto-entity UI from backend `/_meta` endpoint
- EntityTable, EntityForm, Toast, ConfirmDialog, ErrorBoundary
- React Router v7
- React Router v7 framework mode for SSR/SSG when SEO is needed
- CSS design token system (70+ tokens)
- Light/dark theme with localStorage persistence
- Responsive layout (sidebar, hamburger on mobile)
- Override system for per-entity UI customization
- Vitest + testing-library for unit tests
- Playwright for E2E
- **Status**: Built and functional (`frontend/`)

### 2.2 Flutter (Mobile)

- **Use when**: Mobile apps (iOS + Android), cross-platform requirements
- Material Design 3 with custom theme system
- Riverpod for state management
- GoRouter for navigation
- Dio HTTP client with token refresh interceptor
- Auto-entity screens from backend `/_meta` (same pattern as web)
- Secure token storage (flutter_secure_storage)
- Biometric auth support
- Push notifications (FCM)
- Offline-first with local caching (Hive or Isar)

### 2.3 Shared Frontend Capabilities (all templates)

Every frontend template must provide:

- **Auto-entity UI**: Fetch `/_meta`, generate list/detail/form screens dynamically
- **Design system**: Consistent token-based theming (colors, spacing, typography, shadows)
- **Light/dark theme**: Toggle with persistence
- **Auth integration**: Keycloak OIDC, token refresh, dev mode bypass
- **Error handling**: Error boundaries, toast notifications, error states for every screen
- **Responsive**: Mobile-first, works across breakpoints
- **Override system**: Per-entity customization without modifying core components
- **Accessibility**: WCAG 2.1 AA minimum for web, platform guidelines for mobile

---

## 3. Infrastructure (Shared Across All Stacks)

### 3.1 Docker Compose + Nginx (Simple Mode)

- **Use when**: Small/medium projects, dev/staging environments, cost-conscious deployments
- Single server (EC2 or any VPS)
- Production compose: migrate → backend → frontend (Nginx)
- Dev compose: DB → migrate → backend (hot-reload) → frontend (HMR)
- Nginx reverse proxy with SPA fallback
- SSL: self-signed (dev) or Let's Encrypt with auto-renewal
- Dynamic domain via environment variable
- Health checks and restart policies on all services

### 3.2 Kubernetes (Enterprise Mode)

- **Use when**: Production enterprise deployments, auto-scaling, high availability
- AWS EKS with managed node groups
- Helm charts for Keycloak and application services
- ALB ingress controller
- Horizontal pod autoscaling
- K8s secrets from AWS Secrets Manager
- Namespace isolation per environment
- Rolling deployments with rollback

### 3.3 Shared Infrastructure

- **Terraform IaC**: VPC, subnets (public/private/isolated), security groups, RDS PostgreSQL, ECR
- **Remote state**: S3 + DynamoDB locking, per-environment state files
- **Environment management**: dev/staging/prod via `.tfvars`
- **CLI wrapper**: `bin/tf` with pre-flight checks (version, creds, bucket auto-creation)
- **SSL for both modes**: Self-signed for dev, Let's Encrypt for production; if domain is provided, auto-provisions cert; if not, generates self-signed

### 3.4 CI/CD Pipeline

- AWS CodePipeline + CodeBuild (default)
- Change-aware deploys (SSM-tracked commit SHA, skip unchanged)
- Branch-to-environment mapping (develop → dev, staging → staging, main → prod)
- ECR container registry with image scanning and lifecycle policies
- Separate buildspecs per service (backend, frontend, mobile)

---

## 4. Identity & Access Management (Shared)

- Keycloak OIDC provider (Helm for K8s, Docker Compose for simple mode)
- Pre-configured realm templates per environment
- User seeds for dev/staging
- Permission model: `<resource>:<action>.<scope>` — consistent across all backend stacks
- Dev mode: `AUTH_ENABLED=false` injects superuser
- Support for external providers: Auth0, Azure AD, Okta (via JWKS)

---

## 5. Testing (Per Stack)

| Stack   | Unit Testing                    | E2E Testing               | Coverage |
| ------- | ------------------------------- | ------------------------- | -------- |
| FastAPI | pytest + pytest-asyncio + Faker | Playwright                | 80% min  |
| Fastify | Vitest + fastify.inject()       | Playwright                | 80% min  |
| React   | Vitest + testing-library        | Playwright                | 80% min  |
| Flutter | flutter_test + mockito          | integration_test + patrol | 80% min  |

All stacks:

- Reusable base test class with CRUD test methods
- Test scaffolding CLI
- Auto-entity test discovery
- Safety net ensuring every entity has tests

---

## 6. Developer Experience (Shared)

- **Zero-config CRUD**: Define a model/schema → get API + UI + tests
- **Scaffolding CLI**: Generate entities, tests, controllers/handlers per stack
- **One-command dev setup**: `docker compose -f docker-compose.dev.yml up -d`
- **Hot-reload**: Backend and frontend, all stacks
- **Environment templates**: `.env.example` for every service
- **Project initialization**: Script to clone template, rename project, configure env, wire stack choices

---

## 7. Stack Combinations

The template system supports mix-and-match:

| Project Type         | Backend            | Frontend    | Infra                 |
| -------------------- | ------------------ | ----------- | --------------------- |
| AI/ML SaaS           | FastAPI            | React       | K8s                   |
| Enterprise web app   | Fastify            | React       | K8s                   |
| Marketing + app      | FastAPI or Fastify | React (SSR) | Docker Compose        |
| Mobile-first product | Fastify            | Flutter     | K8s                   |
| Internal tool        | FastAPI            | React       | Docker Compose        |
| Client portal        | Fastify            | React (SSR) | Docker Compose or K8s |

---

## 8. What This Enables

For any new project:

1. Pick a backend stack (FastAPI / Fastify)
2. Pick a frontend stack (React / Flutter)
3. Pick infra mode (Docker Compose / Kubernetes)
4. Run the init script — wires everything together
5. Define entity models (the actual business domain)
6. Deploy

Time from kickoff to first working deployment with auth, CRUD, and CI/CD: **< 2 weeks**.
