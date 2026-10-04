# Connection count

Count every connection a block has on Are.na, by the maintainer and by anyone else, and offer
ranking by it as a browse order.

## Decisions

- **Two counts, kept apart.** `connection_count` stays what it was: how many of the maintainer's
  synced channels hold the block. `total_connection_count` is new and counts every connection on
  Are.na. Collapsing them would lose the maintainer's own view, which the `my-` sorts still use.
- **Seven sorts, in this order.** `my-most-connected` (default), `my-least-connected`,
  `my-newest-connected`, `my-oldest-connected`, `most-connected` (the total), `newest-created`,
  `oldest-created`. The four `my-` orders are the four earlier connected orders renamed
  (`most-connected` used to mean the maintainer's channel count). There is no "least connected" over
  the total; nobody asked for one.
- **The default stays the maintainer's own count.** The total was first made the default, then the
  default moved back to `my-most-connected`, so ranking by the total is opt-in.
- **Labels are sentence case**, as every other filter label is: "Most connected", "My most
  connected". The request listed them in title case; the design system's convention wins.
- **Old URLs.** `newest-connected`, `oldest-connected` and `least-connected` are now rejected like
  any unknown value, and `?sort=most-connected` silently means the total. The earlier names were
  three days old and unreleased, so no alias is kept.
- **Colour browse.** Colours lead only the default order, as before. After the colour weights the
  default falls to `connection_count`, then `connected_at`, then `id`. At five colours that is
  exactly Turbopuffer's limit of 8 sort attributes.

## Where the number comes from

The channel contents Are.na returns carry only the connection into that channel (checked against the
live API and the SDK's types), so there is no free total. `GET /v3/blocks/:id/connections?per=1`
returns it as `meta.total_count`: one request per block, 300 reads a minute on the maintainer's
tier, which paces a first run over about 2,500 blocks to roughly nine minutes.

## Cache

`src/lib/server/indexing/connections-cache.jsonl`, committed: `block_id`, `total`, `counted_at`.
It follows the colour cache's rules except for the key. A total changes while the block does not,
so an entry is reused until it is a week old (`CONNECTION_COUNT_MAX_AGE_MS`) rather than until its
content changes. A routine sync therefore counts the blocks added since and the ones gone stale.
`--no-connections` skips the stage and indexes the cache as it stands.

## Indexed value

`toSearchDocument` writes `max(cached total, connection_count)`. The maintainer's channels are
among the connections the total counts, so the total can never truly be lower; clamping means a
block whose request failed, or whose cached total predates a new connection of the maintainer's, is
ordered by what is certainly true and every document has the attribute the Most connected sort needs.

## Rollout

`total_connection_count` is a new attribute, so the namespace takes it in place and needs no
migration ADR. Only the Most connected sort orders on it, so a deploy before the sync would fail that
one option and leave the default browse, which sorts on `connection_count`, working. Sync first
(`bun run sync --no-vision --no-push-arena`) all the same, then deploy.
