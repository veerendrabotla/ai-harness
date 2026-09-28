-- Creates the shadow database used by Prisma Migrate during development.
SELECT 'CREATE DATABASE ai_harness_shadow OWNER ai_harness'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_harness_shadow')\gexec
