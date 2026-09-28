# AI Harness — CLI Guide

## Installation

```bash
npm install -g @ai-harness/cli
```

## Configuration

Set environment variables:

```bash
# API endpoint
export AI_HARNESS_URL="https://api.aiharness.dev"

# Authentication (choose one)
export AI_HARNESS_API_KEY="ah_live_..."
export AI_HARNESS_TOKEN="eyJhbGciOi..."
```

## Commands

### Build
Create and run a task from a goal:

```bash
aiharness build "Add user authentication with OAuth"
aiharness build "Fix the login bug" --project proj_123
```

### Status
Check task status:

```bash
aiharness status task_123
```

### Sessions
List recent sessions:

```bash
aiharness sessions
aiharness sessions --workspace ws_123
```

### Resume
Resume a paused task:

```bash
aiharness resume task_123
```

### Health
Check API health:

```bash
aiharness health
```

### Help
Show usage information:

```bash
aiharness help
aiharness --help
```

## CI Mode

Run the agent in headless CI mode:

### Review
```bash
aiharness review --ci --project proj_123
aiharness review --ci --project proj_123 --json
aiharness review --ci --project proj_123 --github
```

### Test
```bash
aiharness test --ci --project proj_123
```

### Security
```bash
aiharness security --ci --project proj_123
```

## Output Formats

### Text (default)
```
CI Result: PASSED
Summary: review completed: 3 issues found in 1234ms

Issues:
  [WARNING] (src/auth.ts:42) Missing input validation
  [INFO] (src/utils.ts:15) Consider using optional chaining
```

### JSON
```json
{
  "passed": true,
  "issues": [...],
  "summary": "review completed: 3 issues found in 1234ms",
  "duration": 1234
}
```

### GitHub Actions
```
::warning file=src/auth.ts,line=42::Missing input validation
::notice file=src/utils.ts,line=15::Consider using optional chaining
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid arguments, API error) |
| 2 | Task failed |

## Examples

### Create and monitor a task
```bash
# Create task
aiharness build "Add dark mode support"

# Check status
aiharness status <task-id>

# Stream events (if supported)
aiharness events <task-id>
```

### Run CI checks
```bash
# Review code
aiharness review --ci --project proj_123 --github

# Run tests
aiharness test --ci --project proj_123 --json
```

### Manage sessions
```bash
# List recent sessions
aiharness sessions

# Resume a specific session
aiharness resume task_456
```
