#!/usr/bin/env bash
# Moves an issue's card when someone opens the branch for it, because nothing
# in GitHub does: the built-in project workflows fire on an item being added,
# reopened, closed, reviewed or merged, and branch creation is not among them.
# Opening a branch is the moment work actually starts, so it is the honest
# trigger for In Progress — the one transition the board never made by itself.
#
# The branch names the issue: the convention is `<issue>-<topic>`, README
# "Contributing". A branch that does not start with digits is not about an
# issue, and is ignored rather than guessed at.
#
# Only Todo is moved. A card already In Progress has nothing to gain, and one
# in Done must never be dragged backwards by a branch opened to fix a detail.
#
# Usage: OWNER=<login> PROJECT_NUMBER=<n> BRANCH=<name> STATUS=<option> branch-status.sh
set -euo pipefail

: "${OWNER:?}" "${PROJECT_NUMBER:?}" "${BRANCH:?}"
# The target is a variable, not a constant, so that changing which column a
# branch means is one word here rather than a rewrite.
STATUS="${STATUS:-In Progress}"
MOVE_FROM="${MOVE_FROM:-Todo}"

issue="${BRANCH%%-*}"
if [[ ! "$issue" =~ ^[0-9]+$ ]]; then
  echo "Branch \"$BRANCH\" does not start with an issue number: nothing to do."
  exit 0
fi

project=$(gh api graphql -f query='
  query($owner: String!, $number: Int!) {
    user(login: $owner) {
      projectV2(number: $number) {
        id
        field(name: "Status") {
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUMBER")

project_id=$(jq -r '.data.user.projectV2.id' <<<"$project")
field_id=$(jq -r '.data.user.projectV2.field.id' <<<"$project")
option_id=$(jq -r --arg name "$STATUS" \
  '.data.user.projectV2.field.options[] | select(.name == $name) | .id' <<<"$project")

if [[ -z "$option_id" || "$option_id" == "null" ]]; then
  echo "The Status field has no \"$STATUS\" option." >&2
  exit 1
fi

# --paginate: a season's worth of cards outgrows one page, and the card we want
# is as likely to be on the last as the first.
card=$(gh api graphql --paginate -f query='
  query($owner: String!, $number: Int!, $endCursor: String) {
    user(login: $owner) {
      projectV2(number: $number) {
        items(first: 100, after: $endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content { __typename ... on Issue { number } }
            status: fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }' -f owner="$OWNER" -F number="$PROJECT_NUMBER" --jq '
  .data.user.projectV2.items.nodes[]
  | select(.content.__typename == "Issue")
  | "\(.content.number)|\(.id)|\(.status.name // "")"' | grep "^${issue}|" || true)

if [[ -z "$card" ]]; then
  echo "Issue #$issue has no card in the project: nothing to do."
  exit 0
fi

IFS='|' read -r _ item_id current <<<"$card"

if [[ "$current" != "$MOVE_FROM" ]]; then
  # Not a failure: reopening a branch on finished work is ordinary, and
  # silently rewinding its card would be the bug.
  echo "#$issue is in \"${current:-no status}\", not \"$MOVE_FROM\": left as is."
  exit 0
fi

gh api graphql -f query='
  mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $project, itemId: $item, fieldId: $field,
      value: { singleSelectOptionId: $option }
    }) { projectV2Item { id } }
  }' -f project="$project_id" -f item="$item_id" -f field="$field_id" \
     -f option="$option_id" >/dev/null

echo "#$issue: \"$MOVE_FROM\" → \"$STATUS\" (branch $BRANCH)."
