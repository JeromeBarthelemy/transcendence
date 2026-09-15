#!/usr/bin/env bash
# Sets one issue's Start and End dates on the project, so the roadmap view can
# place its card: Start is the creation date, End the closing date, cleared
# while the issue is open. Safe to run again on the same issue.
#
# Usage: OWNER=<login> PROJECT_NUMBER=<n> roadmap-dates.sh <issue-node-id> <created-at> [closed-at]
set -euo pipefail

issue_id=$1
start=${2:0:10}
end=${3:+${3:0:10}}

project=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        fields(first: 50) { nodes { ... on ProjectV2Field { id name } } }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUMBER")
project_id=$(jq -r '.data.user.projectV2.id' <<<"$project")
field_id() {
  jq -r --arg name "$1" '.data.user.projectV2.fields.nodes[] | select(.name == $name) | .id' <<<"$project"
}
start_field=$(field_id Start)
end_field=$(field_id End)

# Adding an issue that is already in the project returns its existing item, so
# this does not race the project's built-in auto-add workflow.
item_id=$(gh api graphql -f query='
  mutation($project: ID!, $content: ID!) {
    addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } }
  }' -f project="$project_id" -f content="$issue_id" --jq '.data.addProjectV2ItemById.item.id')

set_date() {
  gh api graphql --silent -f query='
    mutation($project: ID!, $item: ID!, $field: ID!, $date: Date!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field, value: {date: $date}
      }) { projectV2Item { id } }
    }' -f project="$project_id" -f item="$item_id" -f field="$1" -f date="$2"
}

clear_date() {
  gh api graphql --silent -f query='
    mutation($project: ID!, $item: ID!, $field: ID!) {
      clearProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field
      }) { projectV2Item { id } }
    }' -f project="$project_id" -f item="$item_id" -f field="$1"
}

set_date "$start_field" "$start"
if [[ -n $end ]]; then
  set_date "$end_field" "$end"
else
  clear_date "$end_field"
fi
