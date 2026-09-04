# Security Policy

## Supported versions

Only the **latest** release is supported. We don't maintain security backports for older versions — please upgrade to the newest release before reporting.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

To report a vulnerability privately:

1. Open the repository on GitHub: <https://github.com/chandq/mock-service-cli>
2. Go to the **Security** tab → **Report a vulnerability** (private advisory).
3. Include:
   - the affected version / edition (`mock-service-cli --version`),
   - a minimal reproduction (CLI options, mock/static config, request),
   - impact and, if known, a suggested fix.

You can also reach the maintainer via their GitHub profile (<https://github.com/chandq>) for a private channel. Reports are acknowledged and handled as soon as possible.

## Security notes for users

The server tools bind to `127.0.0.1` by default:

- Use `--host` only on trusted networks; it exposes the servers on all IPv4 interfaces (an optional allowlist file restricts access to specific IPs/CIDRs). See README "使用示例" for details.
- The file explorer is read-only unless started with `--edit` (create/rename/delete/upload). `--edit` plus `--auth <password>` adds password protection for the explorer UI.
- The Mock/static/proxy/file features serve and proxy content from your local filesystem — only point them at data you trust.

## Scope

This policy covers the `mock-service-cli` source and its published npm packages (`mock-service-cli`, `mock-service-cli-ultra`). Issues in third-party dependencies should be reported to their respective maintainers.
