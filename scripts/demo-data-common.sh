# Shared POSIX implementation for explicit demo-data maintenance commands.
demo_data_usage() {
    printf 'Usage: sh scripts/%s [options]\n\n' "$demo_command_name"
    printf '%s\n' \
        'Options:' \
        '  --skip-build         Use the existing image instead of building first.' \
        '  --compose-file PATH  Use a different Compose file.' \
        '  --docker-path PATH   Use a specific Docker executable.' \
        '  --help               Show this help without running Docker.'
}

demo_data_absolute_file() {
    demo_file_input=$1
    if [ ! -f "$demo_file_input" ]; then
        printf 'File does not exist: %s\n' "$demo_file_input" >&2
        return 2
    fi
    demo_file_parent=$(CDPATH= cd -P "$(dirname "$demo_file_input")" && pwd) || return 2
    printf '%s/%s\n' "$demo_file_parent" "$(basename "$demo_file_input")"
}

kanbanodon_demo_data() {
    demo_operation=$1
    demo_source_directory=$2
    shift 2
    case "$demo_operation" in
        Clear) demo_command_name=clear-task-data.sh ;;
        Seed) demo_command_name=seed-demo-data.sh ;;
        *) printf 'Unknown demo-data operation: %s\n' "$demo_operation" >&2; return 2 ;;
    esac
    demo_repo_directory=$(CDPATH= cd -P "$demo_source_directory/.." && pwd) || return 2
    demo_compose_file=$demo_repo_directory/docker-compose.yml
    demo_docker_path=
    demo_skip_build=false
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --skip-build) demo_skip_build=true; shift ;;
            --compose-file|--docker-path)
                demo_option=$1
                if [ "$#" -lt 2 ] || [ -z "$2" ]; then
                    printf '%s requires a path.\n' "$demo_option" >&2
                    return 2
                fi
                case "$demo_option" in
                    --compose-file) demo_compose_file=$2 ;;
                    --docker-path) demo_docker_path=$2 ;;
                esac
                shift 2
                ;;
            --help|-h) demo_data_usage; return 0 ;;
            *) printf 'Unknown option: %s\n' "$1" >&2; demo_data_usage >&2; return 2 ;;
        esac
    done
    demo_compose_file=$(demo_data_absolute_file "$demo_compose_file") || return $?
    if [ -z "$demo_docker_path" ]; then
        demo_docker_path=$(command -v docker) || {
            printf '%s\n' 'Docker was not found. Install Docker or pass --docker-path with the executable path.' >&2
            return 127
        }
    fi
    if [ ! -f "$demo_docker_path" ] || [ ! -x "$demo_docker_path" ]; then
        printf 'Docker is not an executable file: %s\n' "$demo_docker_path" >&2
        return 127
    fi
    demo_docker_path=$(demo_data_absolute_file "$demo_docker_path") || return $?
    if [ "$demo_skip_build" = false ]; then
        printf '%s\n' 'Building the current Kanbanodon image...'
        if "$demo_docker_path" compose --project-directory "$demo_repo_directory" --file "$demo_compose_file" build kanbanodon; then
            :
        else
            demo_exit_status=$?
            printf 'Docker Compose build failed (exit %s). No data preparation command was run.\n' "$demo_exit_status" >&2
            return "$demo_exit_status"
        fi
    fi
    demo_clear_value=false
    demo_seed_value=false
    if [ "$demo_operation" = Clear ]; then
        demo_clear_value=true
        printf '%s\n' 'Deleting every ticket and Sprint plan in the Compose database; accounts and boards remain.'
    else
        demo_seed_value=true
        printf '%s\n' 'Adding current demo Epics, Sprints, planned tasks, and Backlog tasks to unseeded boards.'
    fi
    # Git Bash must preserve the container path while still converting host paths.
    # Scope this setting to the command and retain any caller exclusions.
    if MSYS2_ARG_CONV_EXCL="${MSYS2_ARG_CONV_EXCL:+$MSYS2_ARG_CONV_EXCL;}/app/kanbanodon" \
        "$demo_docker_path" compose --project-directory "$demo_repo_directory" --file "$demo_compose_file" \
        run --rm --no-deps \
        --env "KANBANODON_CLEAR_TASK_DATA=$demo_clear_value" \
        --env "KANBANODON_SEED_DEMO_DATA=$demo_seed_value" \
        --env KANBANODON_RESET_DEMO_DATA=false \
        kanbanodon /app/kanbanodon -prepare-demo-data; then
        :
    else
        demo_exit_status=$?
        printf 'Demo data preparation failed (exit %s). Check the server error above before retrying.\n' "$demo_exit_status" >&2
        return "$demo_exit_status"
    fi
    printf '%s\n' \
        'Finished. The one-shot container has exited; the running application keeps its existing startup flags.' \
        'Refresh the browser to load the updated tasks and Sprints.'
}
