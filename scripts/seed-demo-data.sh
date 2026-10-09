#!/bin/sh
# Add current example Epics, Sprints, planned tasks, and Backlog tasks.
set -eu

demo_script_directory=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
. "$demo_script_directory/demo-data-common.sh"
kanbanodon_demo_data Seed "$demo_script_directory" "$@"
