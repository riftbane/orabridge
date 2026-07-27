# --- build frontend ---
FROM node:22-alpine AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

# --- runtime ---
# Debian (non Alpine): Oracle Instant Client richiede glibc. Il client abilita la
# modalità thick del driver: supporta i password verifier 10G (NJS-116) e i server
# Oracle dalla 11.2 in su. Client 19c: massima compatibilità con server datati.
FROM node:22-slim
RUN apt-get update \
 && (apt-get install -y --no-install-recommends libaio1 \
     || apt-get install -y --no-install-recommends libaio1t64) \
 && apt-get install -y --no-install-recommends unzip curl ca-certificates \
 && curl -fL -o /tmp/ic.zip \
      https://download.oracle.com/otn_software/linux/instantclient/1923000/instantclient-basiclite-linux.x64-19.23.0.0.0dbru.zip \
 && unzip -q /tmp/ic.zip -d /opt/oracle && rm /tmp/ic.zip \
 && ln -s /opt/oracle/instantclient_* /opt/oracle/instantclient \
 && echo /opt/oracle/instantclient > /etc/ld.so.conf.d/oracle-instantclient.conf \
 && ldconfig \
 && apt-get purge -y unzip curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 ORACLE_THICK_MODE=1
COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=client-build /build/client/dist ./public
VOLUME /data
EXPOSE 3000
CMD ["node", "src/index.js"]
