# Security Policy

## Supported versions

Security fixes are provided for the latest published minor release.

## Reporting a vulnerability

Please do not open a public issue for vulnerabilities involving API keys, Host routes, session access, or cross-origin behavior. Use GitHub's private vulnerability reporting for this repository. Include the affected version, reproduction steps, impact, and any suggested mitigation.

Never include a real `DEEPSEEK_API_KEY`, account balance, or private session data in reports or screenshots.

## Trust model

- The API key remains in the DSH Host process; the browser only calls same-origin plugin routes.
- Responses containing usage or balance data are marked `Cache-Control: no-store`.
- Custom upstream endpoints require HTTPS, except HTTP loopback proxies explicitly configured by the operator.
- Installing from GitHub runs the package build script locally. Prefer the prebuilt npm release and pin Git installs to a commit.
