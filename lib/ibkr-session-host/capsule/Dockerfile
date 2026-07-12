FROM debian:bookworm-slim@sha256:1def178129dfb5f24db43afbf2fcac04530012e3264ba4ff81c71184e17a9ee4 AS cpg

ARG CPG_SHA256=2f2d380b2f9424520ff5f9c11fe45e82ef39459329ac056258a3274bea6f76f9

# ADD verifies the official-source bytes before they enter a layer; the second
# check makes the pinned value visible to simple build and source audits.
ADD --checksum=sha256:2f2d380b2f9424520ff5f9c11fe45e82ef39459329ac056258a3274bea6f76f9 \
  https://download2.interactivebrokers.com/portal/clientportal.gw.zip \
  /tmp/clientportal.gw.zip
RUN printf '%s  %s\n' "${CPG_SHA256}" /tmp/clientportal.gw.zip | sha256sum --check --strict - \
  && apt-get update \
  && apt-get install --yes --no-install-recommends unzip=6.0-28 \
  && mkdir -p /opt/ibkr/clientportal \
  && unzip -q /tmp/clientportal.gw.zip -d /opt/ibkr/clientportal \
  && rm -rf /var/lib/apt/lists/* /tmp/clientportal.gw.zip \
  && sed -i \
    -e 's/<root level=.DEBUG.>/<root level="INFO">/' \
    -e '/<appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">/a\        <file>logs/gw.current.log</file>' \
    -e '/^[[:space:]]*- 192\.\*/d' \
    -e '/^[[:space:]]*- 131\.216\.\*/d' \
    /opt/ibkr/clientportal/root/logback.xml \
    /opt/ibkr/clientportal/root/conf.yaml \
  && grep -Fq '<root level="INFO">' /opt/ibkr/clientportal/root/logback.xml \
  && grep -Fq '<file>logs/gw.current.log</file>' /opt/ibkr/clientportal/root/logback.xml \
  && ! grep -Eq 'level=.DEBUG.' /opt/ibkr/clientportal/root/logback.xml \
  && grep -Fq 'listenSsl: true' /opt/ibkr/clientportal/root/conf.yaml \
  && test "$(awk '/^[[:space:]]*allow:[[:space:]]*$/ { in_allow=1; next } in_allow && /^[[:space:]]*deny:[[:space:]]*$/ { exit } in_allow && /^[[:space:]]*-/ { sub(/^[[:space:]]*-[[:space:]]*/, ""); print }' /opt/ibkr/clientportal/root/conf.yaml)" = '127.0.0.1'

FROM debian:bookworm-slim@sha256:1def178129dfb5f24db43afbf2fcac04530012e3264ba4ff81c71184e17a9ee4

ENV DISPLAY=:99 \
  HOME=/run/pyrus/home \
  XDG_RUNTIME_DIR=/run/pyrus/xdg

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    chromium=150.0.7871.100-1~deb12u1 \
    chromium-common=150.0.7871.100-1~deb12u1 \
    chromium-sandbox=150.0.7871.100-1~deb12u1 \
    fonts-liberation=1:1.07.4-11 \
    novnc=1:1.3.0-1 \
    openjdk-17-jre-headless=17.0.19+10-1~deb12u2 \
    websockify=0.10.0+dfsg1-4+b1 \
    x11vnc=0.9.16-9 \
    xvfb=2:21.1.7-3+deb12u12 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 pyrus \
  && useradd \
    --uid 10001 \
    --gid 10001 \
    --home-dir /run/pyrus/home \
    --no-create-home \
    --shell /usr/sbin/nologin \
    pyrus

COPY --from=cpg --chown=10001:10001 /opt/ibkr/clientportal /opt/ibkr/clientportal
COPY --chown=10001:10001 paper-only-extension /opt/pyrus/paper-only-extension
COPY --chmod=0444 chromium-managed-policy.json /etc/chromium/policies/managed/pyrus.json
COPY --chmod=0555 pyrus-capsule-entrypoint /usr/local/bin/pyrus-capsule-entrypoint
COPY --chmod=0555 pyrus-capsule-health /usr/local/bin/pyrus-capsule-health
COPY --chmod=0555 pyrus-capsule-relay.py /usr/local/bin/pyrus-capsule-relay

USER 10001:10001
WORKDIR /run/pyrus

ENTRYPOINT ["/usr/local/bin/pyrus-capsule-entrypoint"]
