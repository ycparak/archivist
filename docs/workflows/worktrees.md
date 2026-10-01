# Worktrees

Use git worktrees to work on parallel tasks without stashing or switching branches. Each worktree gets its own directory under `.worktrees/` with a random two-word name.

## Creating a worktree

Source the script from bash or zsh so the `cd` takes effect in your shell. It leaves your shell's options and variables untouched, and works from inside another worktree too:

```bash
. ./scripts/worktree.sh
```

This will:

1. Generate a random name (e.g. `wild-reef`)
2. Create a new branch and worktree at `.worktrees/<name>/` in the main checkout
3. Copy the main checkout's `.env` into the worktree
4. `cd` into the worktree

## Listing worktrees

```bash
git worktree list
```

## Removing a worktree

```bash
git worktree remove .worktrees/<name>
```

To also delete the branch:

```bash
git branch -d <name>
```

## Notes

- `.worktrees/` is gitignored — worktrees are local-only.
- Each worktree shares the same git history but has its own working tree and index.
- Run `bun install` inside a new worktree before developing.
