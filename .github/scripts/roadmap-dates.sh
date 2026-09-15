#!/usr/bin/env bash
# Keeps the project's Start and End dates in step with the work, so the roadmap
# view can place each issue's card:
#   Start  the day the card entered In Progress, read from when its Status last
#          changed; for an issue closed without passing through In Progress, its
#          closing day; cleared while the card is back in Todo
#   End    the day the issue was closed; cleared while it is open
#
# GitHub triggers no workflow when a card moves in a project owned by a personal
# account, hence a full scan: the Status timestamp keeps the right day however
# late the scan runs. Only values that differ are written, so any run is safe.
#
# Usage: OWNER=<login> PROJECT_NUMBER=<n> roadmap-dates.sh
set -euo pipefail

fields=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        fields(first: 50) { nodes { ... on ProjectV2Field { id name } } }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUMBER")
project_id=$(jq -r '.data.user.projectV2.id' <<<"$fields")
field_id() {
  jq -r --arg name "$1" '.data.user.projectV2.fields.nodes[] | select(.name == $name) | .id' <<<"$fields"
}
start_field=$(field_id Start)
end_field=$(field_id End)

# One line per issue card: item|wanted start|wanted end|current start|current end.
# "|" rather than tabs: read collapses consecutive tabs, losing empty fields.
cards=$(gh api graphql --paginate -f query='
  query($owner: String!, $number: Int!, $endCursor: String) {
    user(login: $owner) {
      projectV2(number: $number) {
        items(first: 100, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content { __typename ... on Issue { closedAt } }
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt }
            }
            start: fieldValueByName(name: "Start") { ... on ProjectV2ItemFieldDateValue { date } }
            end: fieldValueByName(name: "End") { ... on ProjectV2ItemFieldDateValue { date } }
          }
        }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUMBER" --jq '
  .data.user.projectV2.items.nodes[]
  | select(.content.__typename == "Issue")
  | (.content.closedAt // "" | .[0:10]) as $end
  | (.start.date // "") as $current_start
  | (.status.name // "") as $status
  | (if $end != "" then (if $current_start != "" then $current_start else $end end)
     elif $status == "In Progress" then (if $current_start != "" then $current_start else .status.updatedAt[0:10] end)
     elif $status == "Todo" or $status == "" then ""
     else $current_start end) as $start
  | [.id, $start, $end, $current_start, (.end.date // "")] | join("|")')

set_date() {
  gh api graphql --silent -f query='
    mutation($project: ID!, $item: ID!, $field: ID!, $date: Date!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field, value: {date: $date}
      }) { projectV2Item { id } }
    }' -f project="$project_id" -f item="$1" -f field="$2" -f date="$3"
}

clear_date() {
  gh api graphql --silent -f query='
    mutation($project: ID!, $item: ID!, $field: ID!) {
      clearProjectV2ItemFieldValue(input: {
        projectId: $project, itemId: $item, fieldId: $field
      }) { projectV2Item { id } }
    }' -f project="$project_id" -f item="$1" -f field="$2"
}

# sync <item> <field name> <field id> <wanted> <current>
sync() {
  [[ $4 == "$5" ]] && return
  if [[ -n $4 ]]; then
    set_date "$1" "$3" "$4"
  else
    clear_date "$1" "$3"
  fi
  echo "$1 $2: ${5:-empty} -> ${4:-empty}"
}

while IFS='|' read -r item start end current_start current_end; do
  sync "$item" Start "$start_field" "$start" "$current_start"
  sync "$item" End "$end_field" "$end" "$current_end"
done <<<"$cards"
