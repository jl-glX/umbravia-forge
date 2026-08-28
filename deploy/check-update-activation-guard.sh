#!/bin/sh
set -eu

fail() {
  printf 'ERR update activation guard: %s\n' "$1" >&2
  exit 1
}

testing=${UMBRAVIA_UPDATE_GUARD_TESTING:-0}
test_root=${UMBRAVIA_UPDATE_GUARD_TEST_ROOT:-}

if [ "$testing" = "1" ]; then
  [ -n "$test_root" ] || fail "test root is missing"
  [ "$(id -u)" -ne 0 ] || fail "test mode is unavailable to root"
  case "$test_root" in
    /*) ;;
    *) fail "test root must be absolute" ;;
  esac
  state_directory="$test_root/opt/umbravia-forge/.update-state"
  runtime_directory="$test_root/run/umbravia-forge-updater"
  systemctl_command=${UMBRAVIA_UPDATE_GUARD_SYSTEMCTL:-systemctl}
  expected_uid=$(id -u)
else
  [ "$testing" = "0" ] || fail "invalid testing mode"
  [ -z "$test_root" ] || fail "test root is forbidden in production mode"
  [ "$(id -u)" -eq 0 ] || fail "root privileges are required"
  [ -z "${UMBRAVIA_UPDATE_GUARD_SYSTEMCTL:-}" ] ||
    fail "systemctl override is forbidden in production mode"
  state_directory=/opt/umbravia-forge/.update-state
  runtime_directory=/run/umbravia-forge-updater
  systemctl_command=systemctl
  expected_uid=0
fi

pending_marker="$state_directory/activation-pending"
start_permit="$runtime_directory/start.permit"
update_service=umbravia-forge-update.service
app_service=umbravia-forge.service

path_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

require_secure_directory() {
  directory=$1
  expected_mode=$2
  [ -d "$directory" ] && [ ! -L "$directory" ] ||
    fail "required directory is unavailable"
  metadata=$(stat -c '%u:%a' "$directory") ||
    fail "directory metadata is unavailable"
  [ "$metadata" = "$expected_uid:$expected_mode" ] ||
    fail "directory ownership or mode is unsafe"
}

require_secure_file() {
  file=$1
  expected_mode=$2
  [ -f "$file" ] && [ ! -L "$file" ] ||
    fail "required state file is unavailable"
  metadata=$(stat -c '%u:%a' "$file") ||
    fail "state file metadata is unavailable"
  [ "$metadata" = "$expected_uid:$expected_mode" ] ||
    fail "state file ownership or mode is unsafe"
}

require_pending_marker() {
  require_secure_directory "$state_directory" 700
  require_secure_file "$pending_marker" 600
}

read_service_property() {
  service=$1
  property=$2
  "$systemctl_command" show "$service" --property="$property" --value
}

clear_start_permit() {
  if ! path_exists "$runtime_directory"; then
    return 0
  fi
  require_secure_directory "$runtime_directory" 700
  if [ -d "$start_permit" ] && [ ! -L "$start_permit" ]; then
    fail "start permit path is a directory"
  fi
  rm -f -- "$start_permit"
}

issue_start_permit() {
  [ "$#" -eq 2 ] || fail "issue-start-permit requires pid and invocation id"
  updater_pid=$1
  updater_invocation=$2
  case "$updater_pid" in
    ''|*[!0-9]*) fail "invalid updater pid" ;;
  esac
  [ "$updater_pid" -gt 0 ] || fail "invalid updater pid"
  [ -n "$updater_invocation" ] || fail "missing updater invocation id"

  require_pending_marker
  require_secure_directory "$runtime_directory" 700
  path_exists "$start_permit" && fail "a start permit already exists"

  active_state=$(read_service_property "$update_service" ActiveState) ||
    fail "updater state is unavailable"
  case "$active_state" in
    active|activating) ;;
    *) fail "updater service is not active" ;;
  esac
  main_pid=$(read_service_property "$update_service" MainPID) ||
    fail "updater pid is unavailable"
  invocation_id=$(read_service_property "$update_service" InvocationID) ||
    fail "updater invocation is unavailable"
  [ "$main_pid" = "$updater_pid" ] || fail "updater pid does not match systemd"
  [ "$invocation_id" = "$updater_invocation" ] ||
    fail "updater invocation does not match systemd"

  temporary_permit=$(mktemp "$runtime_directory/start.permit.XXXXXX") ||
    fail "cannot create a temporary start permit"
  trap 'rm -f -- "$temporary_permit"' EXIT HUP INT TERM
  printf 'version=1\npid=%s\ninvocation_id=%s\n' \
    "$updater_pid" "$updater_invocation" >"$temporary_permit"
  chmod 0600 "$temporary_permit"
  mv -f -- "$temporary_permit" "$start_permit"
  trap - EXIT HUP INT TERM
}

check_start() {
  if ! path_exists "$pending_marker"; then
    return 0
  fi
  require_pending_marker
  require_secure_directory "$runtime_directory" 700
  require_secure_file "$start_permit" 600

  permit_content=$(cat "$start_permit") || fail "start permit is unreadable"
  permit_pid=$(sed -n 's/^pid=//p' "$start_permit")
  permit_invocation=$(sed -n 's/^invocation_id=//p' "$start_permit")
  expected_content=$(printf 'version=1\npid=%s\ninvocation_id=%s' \
    "$permit_pid" "$permit_invocation")
  [ "$permit_content" = "$expected_content" ] || fail "start permit is malformed"
  case "$permit_pid" in
    ''|*[!0-9]*) fail "start permit pid is invalid" ;;
  esac
  [ "$permit_pid" -gt 0 ] || fail "start permit pid is invalid"
  [ -n "$permit_invocation" ] || fail "start permit invocation is missing"

  active_state=$(read_service_property "$update_service" ActiveState) ||
    fail "updater state is unavailable"
  case "$active_state" in
    active|activating) ;;
    *) fail "updater service is not active" ;;
  esac
  main_pid=$(read_service_property "$update_service" MainPID) ||
    fail "updater pid is unavailable"
  invocation_id=$(read_service_property "$update_service" InvocationID) ||
    fail "updater invocation is unavailable"
  [ "$main_pid" = "$permit_pid" ] || fail "start permit pid is stale"
  [ "$invocation_id" = "$permit_invocation" ] ||
    fail "start permit invocation is stale"

  rm -f -- "$start_permit"
  path_exists "$start_permit" && fail "start permit was not consumed"
}

stop_if_pending() {
  clear_start_permit
  if ! path_exists "$pending_marker"; then
    return 0
  fi
  require_pending_marker
  "$systemctl_command" stop "$app_service" ||
    fail "application service could not be stopped"
  active_state=$(read_service_property "$app_service" ActiveState) ||
    fail "application state is unavailable"
  [ "$active_state" = "inactive" ] ||
    fail "application service remains active"
}

mode=${1:-}
[ "$#" -gt 0 ] && shift
case "$mode" in
  check-start)
    [ "$#" -eq 0 ] || fail "check-start does not accept arguments"
    check_start
    ;;
  issue-start-permit)
    issue_start_permit "$@"
    ;;
  clear-start-permit)
    [ "$#" -eq 0 ] || fail "clear-start-permit does not accept arguments"
    clear_start_permit
    ;;
  stop-if-pending)
    [ "$#" -eq 0 ] || fail "stop-if-pending does not accept arguments"
    stop_if_pending
    ;;
  *) fail "unsupported mode" ;;
esac
