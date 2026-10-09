#!/bin/sh
# Delete tickets and Sprint plans through an explicit one-shot container.
set -eu

demo_script_directory=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
. "$demo_script_directory/demo-data-common.sh"
kanbanodon_demo_data Clear "$demo_script_directory" "$@"
