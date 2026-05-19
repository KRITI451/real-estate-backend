# Real Estate Backend – Local Setup

This repo contains the backend for a real-estate rental platform (Node.js/Express/TypeScript + Prisma + Postgres/PostGIS).

## Quick Start (Docker PostGIS + API)

1. Start the database + API:

   ```bash
   cd /Users/kriti/Desktop/my-projects/real-estate-prod
   docker compose up -d
   ```

2. Configure the server env:

   ```bash
   # /Users/kriti/Desktop/my-projects/real-estate-prod/server/.env
   PORT=3002
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/realestate?schema=public
   AWS_REGION=us-east-1
   S3_BUCKET_NAME=your-bucket-name
   ```

3. Run migrations and seed data:

   ```bash
   cd /Users/kriti/Desktop/my-projects/real-estate-prod/server
   npx prisma migrate deploy
   npm run seed
   ```

4. Start the server:

   ```bash
   npm run dev
   ```

5. Test:

   ```bash
   curl http://localhost:3002/properties
   ```

## Faster Dev Workflow (No Rebuild on Every Code Change)

Right now `/Users/kriti/Desktop/my-projects/real-estate-prod/docker-compose.yml` builds the API like a production image, so source edits do not appear until you rebuild the container.

For day-to-day backend development, use the new Docker override file instead:

```bash
cd /Users/kriti/Desktop/my-projects/real-estate-prod
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

What this does:

- Mounts `/Users/kriti/Desktop/my-projects/real-estate-prod/server` directly into the container
- Keeps `node_modules` in a Docker volume so the bind mount does not wipe dependencies
- Runs `npm run dev` inside the container so TypeScript changes reload without rebuilding the image

When you only change application code, you can now just save the file and let the dev process restart automatically.

You only need to rebuild if one of these changes:

- `server/package.json` or dependencies
- `server/Dockerfile`
- OS-level packages inside the image

Useful commands:

```bash
# View API logs / watcher output
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api

# Restart only the API container if needed
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart api

# Stop the dev stack
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

## Common Issue: Postgres Port Conflict

If you have local Homebrew Postgres running, it can grab port 5432 and Prisma will connect to it instead of Docker. This causes PostGIS errors like:

```
ERROR: could not open extension control file ".../postgis.control"
```

### Fix Option A (Recommended)

Stop local Postgres so Docker owns 5432:

```bash
brew services stop postgresql@14
# or
brew services stop postgresql
```

Then re-run migrations:

```bash
cd /Users/kriti/Desktop/my-projects/real-estate-prod/server
npx prisma migrate reset --force
npm run seed
```

### Fix Option B (Keep local Postgres running)

Run Docker on a different port and update `DATABASE_URL`:

1. Edit `/Users/kriti/Desktop/my-projects/real-estate-prod/docker-compose.yml`:

```yaml
ports:
  - "5433:5432"
```

2. Update `/Users/kriti/Desktop/my-projects/real-estate-prod/server/.env`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/realestate?schema=public
```

3. Restart Docker and apply migrations:

```bash
cd /Users/kriti/Desktop/my-projects/real-estate-prod
docker compose down -v
docker compose up -d

cd /Users/kriti/Desktop/my-projects/real-estate-prod/server
npx prisma migrate deploy
npm run seed
```

## Notes

- AWS settings are only required for the property photo upload endpoint.
- Seed data is optional; without it, list endpoints will return empty arrays.

## ECS Fargate (Minimal, No Load Balancer)

Template:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/infra/cloudformation/ecs-fargate.yml`

Deploy script:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/scripts/deploy-ecs-fargate.sh`

Required env vars:

```
AWS_REGION=us-east-1
VPC_ID=vpc-xxxxxxx
PUBLIC_SUBNET_IDS=subnet-aaa,subnet-bbb
ECR_IMAGE=123456789012.dkr.ecr.us-east-1.amazonaws.com/real-estate:latest
```

Then run:

```bash
bash /Users/kriti/Desktop/my-projects/real-estate-prod/scripts/deploy-ecs-fargate.sh
```

Note: This service is publicly accessible on the container port because it uses public subnets and assigns a public IP.

## RDS Postgres + PostGIS (via CloudFormation)

Template:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/infra/cloudformation/rds-postgis.yml`

Deploy script:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/scripts/deploy-rds-postgis.sh`

Required env vars:

```
AWS_REGION=us-east-1
VPC_ID=vpc-xxxxxxx
DB_SUBNET_IDS=subnet-aaa,subnet-bbb
DB_PASSWORD=your-strong-password
# Optional overrides:
DB_NAME=realestate
DB_USERNAME=postgres
DB_INSTANCE_CLASS=db.t3.micro
ALLOCATED_STORAGE=20
ECS_SG_ID=sg-xxxxxxx
# Deprecated (kept for compatibility):
DB_ALLOWED_CIDR=0.0.0.0/32
```

Then run:

```bash
bash /Users/kriti/Desktop/my-projects/real-estate-prod/scripts/deploy-rds-postgis.sh
```

Use the output `DbEndpoint` to build your `DATABASE_URL`:

`postgresql://DB_USERNAME:DB_PASSWORD@DbEndpoint:5432/DB_NAME?schema=public`

PostGIS is enabled by Prisma migrations (`CREATE EXTENSION postgis`).

For production, `ECS_SG_ID` is required and is the only allowed access to Postgres.

## ECR (Repository via CloudFormation)

Template:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/infra/cloudformation/ecr.yml`

Deploy script:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/scripts/deploy-ecr.sh`

Required env vars:

```
AWS_REGION=us-east-1
# Optional override:
REPOSITORY_NAME=real-estate
```

Then run:

```bash
bash /Users/kriti/Desktop/my-projects/real-estate-prod/scripts/deploy-ecr.sh
```

After the repo exists, build and push your image with Docker and use the resulting ECR URI as `ECR_IMAGE` for the ECS template.

## Dockerize the Server

Dockerfile:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/server/Dockerfile`

Build and push script:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/scripts/build-and-push-ecr.sh`

Required env vars:

```
AWS_REGION=us-east-1
AWS_ACCOUNT_ID=123456789012
ECR_REPO=real-estate
# Optional override:
IMAGE_TAG=latest
```

Then run:

```bash
bash /Users/kriti/Desktop/my-projects/real-estate-prod/scripts/build-and-push-ecr.sh
```

## Cognito Auth (Optional but Recommended)

This project now includes optional auth endpoints backed by AWS Cognito, and JWTs are verified against Cognito JWKS (no dummy tokens):

- `POST /auth/register` (creates Cognito user + tenant/manager in DB)
- `POST /auth/login` (returns Cognito tokens)

### Required Env Vars

Add these to `/Users/kriti/Desktop/my-projects/real-estate-prod/server/.env`:

```
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_XXXXXXX
COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
# Optional, only if your App Client has a secret:
COGNITO_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

Note: Auth middleware now verifies JWTs against Cognito. Tokens must be real Cognito ID or access tokens.

### Cognito Setup Checklist

- Create a **User Pool**
- Add custom attribute: `custom:role` (String)
- Create an **App Client** and enable `USER_PASSWORD_AUTH`
- If you enable a client secret, add `COGNITO_APP_CLIENT_SECRET` to `.env`
- Ensure your AWS credentials are available (env vars or AWS config)

## Postman Collection

Import these files into Postman:

- `/Users/kriti/Desktop/my-projects/real-estate-prod/docs/postman/RealEstate.postman_collection.json`
- `/Users/kriti/Desktop/my-projects/real-estate-prod/docs/postman/RealEstate.postman_environment.json`

Set values for:

- `tenantToken` and `managerToken` (JWTs)
- Tokens must be issued by Cognito (dummy tokens won't work)
- `tenantCognitoId` and `managerCognitoId`
- `propertyId` and `leaseId` if you want to test specific records

## Auth Map (At a Glance)

No Auth:
- `GET /`
- `GET /properties`
- `GET /properties/:id`

Tenant Auth Required:
- `POST /tenants`
- `GET /tenants/:cognitoId`
- `PUT /tenants/:cognitoId`
- `GET /tenants/:cognitoId/current-residences`
- `POST /tenants/:cognitoId/favorites/:propertyId`
- `DELETE /tenants/:cognitoId/favorites/:propertyId`
- `POST /applications`

Manager Auth Required:
- `POST /managers`
- `GET /managers/:cognitoId`
- `PUT /managers/:cognitoId`
- `GET /managers/:cognitoId/properties`
- `POST /properties`
- `PUT /applications/:id/status`

Tenant or Manager Auth Required:
- `GET /applications`
- `GET /leases`
- `GET /leases/:id/payments`




docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker exec -it real_estate_api npx prisma migrate dev
npx prisma generate
