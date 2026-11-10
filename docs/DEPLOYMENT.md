# Deploying a personal instance

1. Install Docker with Compose on the server.
2. Copy `.env.example` to `.env`. Set an HTTPS origin and a unique password of at least 16 characters. Keep `APP_ALLOW_SHORT_PASSWORD=false`; the legacy short-code option is not recommended for a public server.
3. Protect `.env` and never commit it.
4. Run `docker compose up -d --build`.
5. Configure an HTTPS reverse proxy to `127.0.0.1:3091`. Check that the port is free before starting.
6. Verify login, card creation, export and the mobile interface.

The `caderno-data` volume persists SQLite. For a complete backup, use a consistent SQLite backup or stop the container while copying its volume. Do not use `docker compose down -v` for a routine update: it deletes the volume.

JSON import adds missing data rather than replacing the entire database. Always test restoration as part of a backup procedure.

This publication excludes production passwords, private server details and user databases.
