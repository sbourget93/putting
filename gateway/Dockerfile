# TLS termination + routing. Build context is this directory. Build:
#   docker build -t <app>-gateway gateway/
FROM nginx:alpine
# Substitute only ${DOMAIN} in the template; nginx's own $host/$uri are left alone.
ENV NGINX_ENVSUBST_FILTER=DOMAIN
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
