# Topic search

Search stored meetings by meaning rather than by exact words, with a model you choose explicitly.
Nothing is downloaded or sent anywhere until you name the model and, for a remote one, its endpoint.

## Explicit meeting vectors

Choose an already installed local model, or explicitly select a remote endpoint and dimensions:

```sh
zm meetings embeddings --model e5-small --json
zm meetings embeddings --model e5-small --yes --limit 100 --json
zm meetings semantic "example plan" --model e5-small --max-chunks 1000 --json
zm meetings semantic "example plan" --model example-model --base-url http://127.0.0.1:8080/v1 --dims 384 --json
```

The first embedding command previews existing chunk status without opening a model, downloading
files or generating vectors. `--yes` validates and opens the selected model before rebuilding chunks
and embedding one bounded batch. Local models must already be installed; this command never downloads
them. Remote endpoints are explicit; OpenAI endpoints use `OPENAI_API_KEY`. Remote models cannot be
used with `--offline`.

## Generating vectors

Generation uses current transcript revisions and rechecks their hashes before saving results.
`--after-transcript-id` continues rebuilding chunks; `--after-hash` continues missing-vector work.
These are separate cursors. Shared cached vectors remain available to other resources.
A completed generation can emit its acknowledged receipt during a bounded cancellation grace period,
then exit 130. Failed generation and cancelled queries emit no such receipt; a blocked output pipe
can prevent delivery.

## Searching

Semantic search embeds only the query and reads existing vectors; it never rebuilds or generates
stored vectors. Results rank scanned candidates for the selected account and model. Use
`--after-chunk-id` to continue candidate scanning, not to page through globally ranked results.
The report states candidate scan coverage; index completeness and archive completeness are unknown.
`--max-rows` and `--max-text-bytes` bound transcript reads for generation and search.
