# Topic search

Find a discussion even when it uses different words from your question. Search by meaning compares
numerical representations of text, called embeddings, produced by a component you select. It needs
stored transcripts and an installed local embedding model or an explicitly configured remote service.
Use [word search](search.md) immediately if you have not configured one.

## Choose where text is processed

A local embedding model processes text on this computer; it must already be installed. A remote
endpoint receives transcript text when generating embeddings and your question when searching.
Name that endpoint deliberately and choose its model identifier and vector dimensions. The tool
does not download models. Previewing generation does not load a model or send transcript text.

The examples below use `e5-small` for a local model. Confirm it is installed before applying a
batch; its name alone does not install it. Local and remote results need the same model/dimensions
as their stored vectors to be comparable.

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

Check that generation produced vectors before expecting matches. Open a ranked passage with
[meeting evidence](search.md#read-evidence) and read its context: a similar passage is a candidate,
not proof of a decision. If the query returns no candidates, check selected profile/model, generated
vectors and scan coverage before concluding there is no relevant discussion.
