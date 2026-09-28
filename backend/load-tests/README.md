# Load Tests

k6-based load testing for the AI Harness API.

## Prerequisites

Install k6: https://k6.io/docs/get-started/installation/

## Running

```bash
# Health endpoint baseline
k6 run backend/load-tests/smoke.js

# Full mixed-traffic scenario
k6 run backend/load-tests/scenarios.js

# Auth flow focused
k6 run backend/load-tests/scenarios.js --env SCENARIO=auth

# Custom target
k6 run backend/load-tests/scenarios.js --env BASE_URL=https://api.example.com
```

## Scenarios

| Script | Description |
|--------|-------------|
| `smoke.js` | Quick sanity check — low VU count, short duration |
| `scenarios.js` | Full load test with warm-up, sustained load, spike, and cooldown stages |
| `scenarios.js` (`SCENARIO=auth`) | Auth-focused: signup + login flows under load |
| `scenarios.js` (`SCENARIO=mixed`) | Mixed traffic: health, auth, and protected endpoints |

## Thresholds

- p95 latency < 500ms
- p99 latency < 1000ms
- Error rate < 10%
