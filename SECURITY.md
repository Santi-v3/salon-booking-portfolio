# Security policy

## Supported status

This repository is a portfolio prototype. It is not currently supported for production use or the processing of real customer data.

## Reporting a vulnerability

Please do not publish suspected vulnerabilities in a public issue. Contact the repository owner through the profile links and include the affected component, reproduction steps and potential impact. Do not include real customer data, credentials or active API keys.

## Deployment expectations

- Replace every value marked as a placeholder in `.env.example`.
- Keep `.env`, databases and customer exports out of version control.
- Use HTTPS in production and set `NODE_ENV=production`.
- Store `RESEND_API_KEY` only in the server environment.
- Restrict network access until a full security and privacy review has been completed.
