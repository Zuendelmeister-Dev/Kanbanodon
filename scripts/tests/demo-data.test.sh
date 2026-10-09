#!/bin/sh
# Uses only temporary files and a fake Docker executable; no containers start.
set -eu

test_script_directory=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
test_repo_directory=$(CDPATH= cd -P "$test_script_directory/../.." && pwd)
test_temp_parent=$(CDPATH= cd -P "${TMPDIR:-/tmp}" && pwd)
test_temp_directory=$(mktemp -d "$test_temp_parent/kanbanodon-demo-script-test.XXXXXX")
# Keep cleanup confined to the exact temporary directory created above.
case "$test_temp_directory" in
    "$test_temp_parent"/kanbanodon-demo-script-test.*) ;;
    *) printf 'Unexpected temporary directory: %s\n' "$test_temp_directory" >&2; exit 1 ;;
esac
cleanup() {
    if [ -d "$test_temp_directory" ]; then
        test_resolved_directory=$(CDPATH= cd -P "$test_temp_directory" && pwd)
        case "$test_resolved_directory" in
            "$test_temp_parent"/kanbanodon-demo-script-test.*)
                if [ "$test_resolved_directory" = "$test_temp_directory" ]; then
                    rm -rf "$test_resolved_directory"
                fi
                ;;
            *) printf 'Refusing to remove unexpected test directory: %s\n' "$test_resolved_directory" >&2 ;;
        esac
    fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

assert_equal() {
    if [ "$1" != "$2" ]; then
        printf 'FAIL: %s\nExpected: %s\nActual: %s\n' "$3" "$2" "$1" >&2
        exit 1
    fi
}
assert_arg() {
    assert_equal "$(cat "$test_log_directory/call.$1/arg.$2")" "$3" "$4"
}
assert_contains() {
    if ! grep -F -e "$2" "$1" >/dev/null; then
        printf 'FAIL: %s\n' "$3" >&2
        exit 1
    fi
}
reset_log() {
    # Old calls stay as evidence and are overwritten by later invocations.
    printf '0\n' > "$test_log_directory/count"
}
assert_run() {
    assert_arg "$1" 1 compose 'Must use Docker Compose.'
    assert_arg "$1" 2 --project-directory 'Must specify the project directory.'
    assert_arg "$1" 3 "$test_copy_directory" 'Project directory must resolve independently of caller CWD.'
    assert_arg "$1" 4 --file 'Must specify the Compose file.'
    assert_arg "$1" 6 run 'Must run one-shot maintenance, never compose up.'
    assert_arg "$1" 7 --rm 'Maintenance container must be removed after it exits.'
    assert_arg "$1" 8 --no-deps 'Maintenance must not start dependencies.'
    assert_arg "$1" 9 --env 'Clear flag must be an explicit environment override.'
    assert_arg "$1" 10 "KANBANODON_CLEAR_TASK_DATA=$2" 'Clear flag must match the requested operation.'
    assert_arg "$1" 11 --env 'Seed flag must be an explicit environment override.'
    assert_arg "$1" 12 "KANBANODON_SEED_DEMO_DATA=$3" 'Seed flag must match the requested operation.'
    assert_arg "$1" 13 --env 'Legacy reset must be explicitly disabled.'
    assert_arg "$1" 14 KANBANODON_RESET_DEMO_DATA=false 'Legacy reset must never run.'
    assert_arg "$1" 15 kanbanodon 'Must target the Kanbanodon service.'
    assert_arg "$1" 16 /app/kanbanodon 'Must invoke the server executable.'
    assert_arg "$1" 17 -prepare-demo-data 'Must invoke the explicit maintenance command.'
    assert_equal "$(cat "$test_log_directory/call.$1/count")" 17 'Arguments with spaces must remain single arguments.'
    assert_equal "$(cat "$test_log_directory/call.$1/msys-exclusions")" "$test_expected_exclusions" 'Only the container executable path must be added to existing MSYS exclusions.'
}

test_copy_directory=$test_temp_directory/workspace\ with\ spaces
test_other_directory=$test_temp_directory/other\ working\ directory
test_log_directory=$test_temp_directory/fake\ docker\ calls
test_docker_path=$test_temp_directory/fake\ docker
test_path_directory=$test_temp_directory/path\ bin
mkdir -p "$test_copy_directory/scripts" "$test_other_directory" "$test_log_directory" "$test_path_directory"
cp "$test_repo_directory/scripts/clear-task-data.sh" "$test_repo_directory/scripts/seed-demo-data.sh" \
    "$test_repo_directory/scripts/demo-data-common.sh" "$test_copy_directory/scripts/"
cp "$test_repo_directory/docker-compose.yml" "$test_copy_directory/docker-compose.yml"
cat > "$test_docker_path" <<'MOCK'
#!/bin/sh
set -eu
mock_call=$(cat "$KANBANODON_DEMO_SCRIPT_TEST_LOG/count")
mock_call=$((mock_call + 1))
printf '%s\n' "$mock_call" > "$KANBANODON_DEMO_SCRIPT_TEST_LOG/count"
mock_directory=$KANBANODON_DEMO_SCRIPT_TEST_LOG/call.$mock_call
mkdir -p "$mock_directory"
printf '%s\n' "$#" > "$mock_directory/count"
printf '%s' "${MSYS2_ARG_CONV_EXCL-<unset>}" > "$mock_directory/msys-exclusions"
mock_index=0
mock_result=0
for mock_argument do
    mock_index=$((mock_index + 1))
    printf '%s' "$mock_argument" > "$mock_directory/arg.$mock_index"
    case "$mock_argument" in
        build) mock_result=${KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD:-0} ;;
        run) mock_result=${KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN:-0} ;;
    esac
done
exit "$mock_result"
MOCK
chmod +x "$test_docker_path"
# A bad PATH command proves an explicit --docker-path takes priority.
printf '#!/bin/sh\nexit 99\n' > "$test_path_directory/docker"
chmod +x "$test_path_directory/docker"
export KANBANODON_DEMO_SCRIPT_TEST_LOG="$test_log_directory"
export KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD=0 KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN=0
export KANBANODON_CLEAR_TASK_DATA=true KANBANODON_SEED_DEMO_DATA=true KANBANODON_RESET_DEMO_DATA=true
export MSYS2_ARG_CONV_EXCL='/existing-container-path;/existing-option='
test_expected_exclusions=$MSYS2_ARG_CONV_EXCL\;/app/kanbanodon
PATH=$test_path_directory:$PATH
export PATH
reset_log
cd "$test_other_directory"
sh "$test_copy_directory/scripts/clear-task-data.sh" --docker-path "$test_docker_path"
sh "$test_copy_directory/scripts/seed-demo-data.sh" --docker-path "$test_docker_path" --skip-build
assert_equal "$(cat "$test_log_directory/count")" 3 'Expected build, clear run, then seed run.'
assert_arg 1 6 build 'Must build first by default.'
assert_arg 1 7 kanbanodon 'Build must target the Kanbanodon service.'
assert_equal "$(cat "$test_log_directory/call.1/msys-exclusions")" '/existing-container-path;/existing-option=' 'Build must not receive additional MSYS exclusions.'
assert_run 2 true false
assert_run 3 false true
for test_call in 1 2 3; do
    assert_arg "$test_call" 5 "$test_copy_directory/docker-compose.yml" 'Default Compose path must be absolute and resolve from the repository.'
done
assert_equal "$KANBANODON_CLEAR_TASK_DATA:$KANBANODON_SEED_DEMO_DATA:$KANBANODON_RESET_DEMO_DATA" true:true:true 'Helpers must not change caller environment flags.'
assert_equal "$MSYS2_ARG_CONV_EXCL" '/existing-container-path;/existing-option=' 'Helpers must retain caller MSYS exclusions unchanged.'

# Use PATH discovery, a relative custom Compose file, and spaces in every path.
cp "$test_docker_path" "$test_path_directory/docker"
mkdir -p 'custom compose dir'
printf 'services: {}\n' > 'custom compose dir/example compose.yml'
reset_log
unset MSYS2_ARG_CONV_EXCL
test_expected_exclusions=/app/kanbanodon
sh "$test_copy_directory/scripts/seed-demo-data.sh" --skip-build --compose-file 'custom compose dir/example compose.yml'
assert_equal "$(cat "$test_log_directory/count")" 1 '--skip-build must issue only the maintenance run.'
assert_run 1 false true
assert_arg 1 5 "$test_other_directory/custom compose dir/example compose.yml" 'Custom Compose path must retain spaces and resolve relative to the caller.'
assert_equal "${MSYS2_ARG_CONV_EXCL-<unset>}" '<unset>' 'Helpers must not create MSYS exclusions in the caller environment.'

reset_log
export KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD=17
if sh "$test_copy_directory/scripts/clear-task-data.sh" --docker-path "$test_docker_path" > "$test_temp_directory/build output" 2>&1; then
    printf 'FAIL: A failed build must fail the helper.\n' >&2; exit 1
else
    test_status=$?
fi
assert_equal "$test_status" 17 'Build failure exit code must be preserved.'
assert_equal "$(cat "$test_log_directory/count")" 1 'A failed build must prevent the maintenance run.'
assert_arg 1 6 build 'Only the failed build may run.'
assert_equal "$(cat "$test_log_directory/call.1/msys-exclusions")" '<unset>' 'Failed build must not receive the maintenance-only MSYS setting.'
assert_contains "$test_temp_directory/build output" 'build failed (exit 17)' 'Build failure must be explained.'

reset_log
export KANBANODON_DEMO_SCRIPT_TEST_FAIL_BUILD=0 KANBANODON_DEMO_SCRIPT_TEST_FAIL_RUN=19
if sh "$test_copy_directory/scripts/seed-demo-data.sh" --docker-path "$test_docker_path" --skip-build > "$test_temp_directory/run output" 2>&1; then
    printf 'FAIL: A failed maintenance run must fail the helper.\n' >&2; exit 1
else
    test_status=$?
fi
assert_equal "$test_status" 19 'Maintenance failure exit code must be preserved.'
assert_equal "$(cat "$test_log_directory/count")" 1 'Failed maintenance must not retry automatically.'
assert_contains "$test_temp_directory/run output" 'preparation failed (exit 19)' 'Maintenance failure must be explained.'
assert_equal "$(cat "$test_log_directory/call.1/msys-exclusions")" /app/kanbanodon 'Failed maintenance must retain the protected container path.'
assert_equal "${MSYS2_ARG_CONV_EXCL-<unset>}" '<unset>' 'Failed maintenance must not mutate caller MSYS exclusions.'
assert_equal "$KANBANODON_CLEAR_TASK_DATA:$KANBANODON_SEED_DEMO_DATA:$KANBANODON_RESET_DEMO_DATA" true:true:true 'Failures must not change caller environment flags.'

reset_log
sh "$test_copy_directory/scripts/clear-task-data.sh" --help > "$test_temp_directory/help output"
assert_equal "$(cat "$test_log_directory/count")" 0 'Help must not invoke Docker.'
assert_contains "$test_temp_directory/help output" --skip-build 'Help must describe the build option.'
if sh "$test_copy_directory/scripts/seed-demo-data.sh" --compose-file > "$test_temp_directory/options output" 2>&1; then
    printf 'FAIL: Missing path must be rejected.\n' >&2; exit 1
else
    test_status=$?
fi
assert_equal "$test_status" 2 'Invalid options must return exit 2.'
assert_equal "$(cat "$test_log_directory/count")" 0 'Invalid options must not invoke Docker.'
printf '%s\n' 'POSIX demo-data script checks passed.'
