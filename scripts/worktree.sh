# Source this file (`. ./scripts/worktree.sh`) from bash or zsh so the final `cd` lands in your
# shell. The work runs in a subshell, so `set -eu` and every variable stay out of the caller.

_archivist_create_worktree() (
  set -eu

  ADJECTIVES="amber ashen azure bleak bold brave brisk calm clear cold cool coral crisp dark dawn deep dense dire draft dry dull dusk eager even fair fast fell fern fierce fine firm flat fond free fresh frost full gilt glad gold good gray green grim hale hazel hazy held high holy iron ivory jade just keen kind lank last lean light lilac live lone long lost lucid lunar main maple mild mint mossy mute near neat next noble north oaken odd olive open pale past pearl pine plain plum prime proud pure quartz quiet rare raw real red rich ripe rosy rough ruby safe sage salt sharp sheer silver slim slow small smoky soft solid south spare stark steep still stone stout strong subtle sure swift tall tame taut teal thick thin tidy tough true umber vast vivid warm west white whole wide wild wiry wise woven young"
  NOUNS="acre alder apex arc ash atlas axle bark basin bay beam birch blade bloom bluff bolt bone bow brace bridge brook briar cairn cape cedar chill chord cleft cliff cloud coast coral core cove crane crest croft cross crown curve dale dew dock dome dove draft drift drum dune dust echo edge elm ember end fall fault fawn fen fern field flare fleet flint flora ford forge fox frame frost gale gate gem glade glen glow gorge grain grove gust harbor haven hawk haze heath hedge helm hill hold hollow horn hub husk inlet iron isle ivy jar jest keel kelp knoll knot lake larch lark latch lea ledge lilac linen loch lodge loom lore marsh mast maze mead mesa mill mint mist moor moss mount muse nest node notch oak opal orbit ore owl palm pass patch path peak pearl pine pitch plain plume point pond porch post prime prism pulse quay quill raft rail rain range reach reed reef ridge rift rim ring rise road rock root rose roost rune rush sage salt sand seal seed shade shard shaw shell shore shrub silt slate slope smoke snag spar spark spire spoke spring spruce spur staff stage stake star steep stem still stone strand stream stump surge swale swift tarn teal thaw thorn tide timber trail trove trunk vale vault veil vine wade wake wall ward wash wave weld well wharf wheat wick wield wilt wind wing wood wren yard yew"

  # zsh and bash disagree on array indexing and word splitting, and a subshell's $RANDOM repeats
  # in zsh, so the choice is made by awk from fresh bytes.
  pick() {
    printf '%s\n' "$1" | awk -v r="$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')" \
      '{ n = split($0, words, " "); print words[r % n + 1] }'
  }

  # The common git dir belongs to the main checkout, so this works from inside a worktree too.
  root="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
  worktrees="$root/.worktrees"

  name="$(pick "$ADJECTIVES")-$(pick "$NOUNS")"
  while [ -e "$worktrees/$name" ]; do
    name="$(pick "$ADJECTIVES")-$(pick "$NOUNS")"
  done

  mkdir -p "$worktrees"
  git -C "$root" worktree add -b "$name" "$worktrees/$name" HEAD >&2

  if [ -f "$root/.env" ]; then
    cp "$root/.env" "$worktrees/$name/.env"
    echo "Copied .env to worktree" >&2
  fi

  echo "Worktree ready at $worktrees/$name" >&2
  printf '%s\n' "$worktrees/$name"
)

if _archivist_worktree_path="$(_archivist_create_worktree)"; then
  cd "$_archivist_worktree_path"
fi
unset -f _archivist_create_worktree
unset _archivist_worktree_path
