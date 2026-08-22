# Gateway

`gateway/` contains the nginx container which is the single entry point to the app in production.
It terminates TLS, redirects HTTP to HTTPS, and reverse-proxies every request to either the backend or the frontend container over the internal Docker network.

Local dev does not run this container, the Vite dev server proxies `/api` to the backend directly.
