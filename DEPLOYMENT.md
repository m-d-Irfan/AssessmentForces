# Production deployment

The API, database migration job, PostgreSQL, and Redis are packaged as separate services. PostgreSQL and Redis are not exposed publicly by the production Compose file.

## Configure

Copy `.env.production.example` to `.env.production` and replace every placeholder. Generate independent random values for the JWT secret, private-data encryption key, PostgreSQL password, and Redis password. URL-encode database and Redis passwords inside `DATABASE_URL` and `REDIS_URL`.

Keep `.env.production` outside version control and back up `SENSITIVE_DATA_ENCRYPTION_KEY` securely. Losing that key makes encrypted reviewer notes unrecoverable.

## Start

```sh
docker compose --env-file .env.production -f docker-compose.production.yml up --build -d
```

The one-shot `migrate` service must complete successfully before the API starts. It runs committed Prisma migrations and never uses development migration commands.

## Verify

```sh
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl --fail https://api.example.com/health
curl --fail https://api.example.com/ready
```

Place the API behind a TLS-terminating reverse proxy or managed load balancer. Forward the original client IP and HTTPS protocol, restrict inbound traffic to HTTPS, and do not expose PostgreSQL or Redis ports.

## Update

```sh
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d
```

Compose reruns the migration job before replacing the API. Back up the PostgreSQL volume before schema changes and periodically test restoration.

## Stop

```sh
docker compose --env-file .env.production -f docker-compose.production.yml down
```

Do not add `--volumes` unless the persistent PostgreSQL and Redis data is intentionally being deleted.
