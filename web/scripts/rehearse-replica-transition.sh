#!/usr/bin/env bash
set -euo pipefail

suffix="${GITHUB_RUN_ID:-local}-$$"
volume_name="storygraph-rs-transition-${suffix}"
standalone_name="storygraph-standalone-${suffix}"
replica_name="storygraph-replica-${suffix}"
mongo_user="storygraph_transition_admin"
mongo_password="storygraph-transition-password"
replica_key="storygraph-transition-replica-key"

case "${volume_name}" in
  storygraph-rs-transition-*) ;;
  *) echo "unsafe transition rehearsal volume name" >&2; exit 1 ;;
esac

cleanup() {
  docker rm -f "${standalone_name}" "${replica_name}" >/dev/null 2>&1 || true
  docker volume rm "${volume_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "${volume_name}" >/dev/null
docker run -d --name "${standalone_name}" \
  -e MONGO_INITDB_ROOT_USERNAME="${mongo_user}" \
  -e MONGO_INITDB_ROOT_PASSWORD="${mongo_password}" \
  -v "${volume_name}:/data/db" \
  mongo:7 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${standalone_name}" mongosh \
    "mongodb://${mongo_user}:${mongo_password}@127.0.0.1:27017/admin?authSource=admin" \
    --quiet --eval "db.adminCommand('ping').ok" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "${standalone_name}" mongosh \
  "mongodb://${mongo_user}:${mongo_password}@127.0.0.1:27017/character_relationship_chart?authSource=admin" \
  --quiet --eval "db.transitionFixtures.insertOne({_id:'preserved', value:1}).acknowledged" >/dev/null

docker stop "${standalone_name}" >/dev/null
docker rm "${standalone_name}" >/dev/null

docker run -d --name "${replica_name}" \
  -e MONGO_INITDB_ROOT_USERNAME="${mongo_user}" \
  -e MONGO_INITDB_ROOT_PASSWORD="${mongo_password}" \
  -e MONGO_REPLICA_SET_KEY="${replica_key}" \
  -v "${volume_name}:/data/db" \
  --entrypoint /bin/sh \
  mongo:7 -lc '
    set -eu
    key_file=/data/db/mongodb-keyfile
    key_value=$(printf "%s" "$MONGO_REPLICA_SET_KEY" | sha256sum | awk "{print \$1}")
    printf "%s\n" "$key_value" > "$key_file"
    chmod 400 "$key_file"
    chown mongodb:mongodb "$key_file"
    exec docker-entrypoint.sh mongod --replSet rs0 --bind_ip_all --keyFile "$key_file"
  ' >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${replica_name}" mongosh \
    "mongodb://${mongo_user}:${mongo_password}@127.0.0.1:27017/admin?authSource=admin&directConnection=true" \
    --quiet --eval "db.adminCommand('ping').ok" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "${replica_name}" mongosh \
  "mongodb://${mongo_user}:${mongo_password}@127.0.0.1:27017/admin?authSource=admin&directConnection=true" \
  --quiet --eval "rs.initiate({_id:'rs0', members:[{_id:0, host:'127.0.0.1:27017'}]}).ok" >/dev/null

for _ in $(seq 1 60); do
  if [ "$(docker exec "${replica_name}" mongosh \
    "mongodb://${mongo_user}:${mongo_password}@127.0.0.1:27017/admin?authSource=admin&directConnection=true" \
    --quiet --eval "db.hello().isWritablePrimary")" = "true" ]; then
    break
  fi
  sleep 1
done

docker exec "${replica_name}" mongosh \
  "mongodb://${mongo_user}:${mongo_password}@127.0.0.1:27017/character_relationship_chart?authSource=admin&replicaSet=rs0" \
  --quiet --eval '
    if (db.transitionFixtures.countDocuments({_id:"preserved"}) !== 1) throw new Error("seed_not_preserved");
    const session = db.getMongo().startSession();
    const sessionDb = session.getDatabase("character_relationship_chart");
    session.startTransaction();
    sessionDb.transitionFixtures.insertOne({_id:"transaction-committed", value:2});
    session.commitTransaction();
    session.endSession();
    if (db.transitionFixtures.countDocuments({_id:"transaction-committed"}) !== 1) throw new Error("transaction_not_committed");
  ' >/dev/null

echo "[replica-transition] existing standalone volume preserved data and accepted a transaction"
