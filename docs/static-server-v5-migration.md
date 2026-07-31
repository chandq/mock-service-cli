# Static Server v5 Migration

Static server configuration is a v5 breaking change. Configuration files are
self-contained and are started with `mock-service-cli --static-config <file>`.

## Single Directory Mode

Use `-R <directory>` without a static configuration file. Directories render
directory indexes; add `--spa-fallback /index.html` to enable SPA routing.

## Configuration Mode

Move the directory previously supplied with `-R` into a mount. Its `path` is
optional and defaults to `/`. Every application is declared in `mounts`;
top-level application fields are rejected. A mount directory is optional only
when the mount defines at least one proxy route. Do not combine `-R <directory>`, `--proxy-options`,
`--rewrite`, or `--spa-fallback` with `--static-config`.

```json
{
  "mounts": [
    {
      "directory": "./shell-dist",
      "headers": { "Cache-Control": "no-store" }
    },
    {
      "path": "/orders",
      "directory": "./orders-dist",
      "spaFallback": "/index.html",
      "proxy": {
        "/api/orders": { "target": "http://127.0.0.1:3100", "rewrite": true }
      }
    }
  ]
}
```

Mount `path` values define only the browser base URL. Proxy keys are complete
public paths and are not derived from the mount path. `rewrite: true` removes
the matching proxy prefix, retaining the remaining path and query string.
`cors`, `headers`, and `secure` can be configured for every mount. `secure` controls TLS certificate verification for that application's
proxy targets.

SPA mounts can additionally configure request logs:

```json
{
  "accessLog": {
    "success": "./logs/app-success.jsonl",
    "failure": "./logs/app-failure.jsonl"
  }
}
```

`accessLog` requires `spaFallback`. Successful 2xx/3xx requests and failed
4xx/5xx requests are written to separate JSON Lines files. Relative paths are
resolved from the static configuration file.
