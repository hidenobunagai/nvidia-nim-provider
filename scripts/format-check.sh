#!/bin/sh
# format-check.sh - CI gate for the fleet-wide format/lint tool mapping.
#
# Runs the same tools as the post-edit dispatcher (agents-env:
# ~/.agents/global/format-file) in check mode over the files given as
# arguments, or over all git-tracked files when called without arguments.
#
# - Path prefixes listed in .formatignore (one per line) are skipped.
# - Markdown is not gated yet: oxfmt's Markdown output still diverges
#   from this repo's Prettier-formatted docs.
# - Lint warnings are printed but do not fail the gate; errors do.
set -u
root=$(git rev-parse --show-toplevel) || exit 1
cd "$root" || exit 1

if [ $# -gt 0 ]; then
  files="$*"
else
  files=$(git ls-files)
fi

ignored() {
  [ -f .formatignore ] || return 1
  while IFS= read -r pat; do
    case "$pat" in
      '' | \#*) continue ;;
    esac
    case "$1" in
      "$pat"*) return 0 ;;
    esac
  done < .formatignore
  return 1
}

fail=0
for f in $files; do
  [ -f "$f" ] || continue
  if ignored "$f"; then continue; fi
  case "$f" in
    *.py | *.pyi)
      inline-sql-toolkit --check -q "$f" || fail=1
      ruff format --check "$f" || fail=1
      ruff check "$f" || fail=1
      ty check "$f" || fail=1
      ;;
    *.js | *.jsx | *.ts | *.tsx | *.mjs | *.cjs | *.mts | *.cts | *.vue | *.svelte)
      oxfmt --check "$f" || fail=1
      oxlint "$f" || fail=1
      ;;
    *.json | *.jsonc | *.json5 | *.yaml | *.yml | *.toml | *.css | *.scss | *.less | *.html | *.graphql | *.gql)
      oxfmt --check "$f" || fail=1
      ;;
    *.sql)
      sql-template-formatter --check "$f" || fail=1
      ;;
  esac
done
exit $fail
