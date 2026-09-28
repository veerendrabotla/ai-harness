// Runtime API URL — overwritten by docker-entrypoint.sh in Docker deploys.
// This default is used during local `npm run dev` (no Docker).
window.__ENV__ = window.__ENV__ || {};
