# Implementation log

## 2026-10-03 — An investigation visitors can use

The chosen experience is an original mystery, **The Last Broadcast**, alongside the existing Northstar solution review. Visitors ask questions or test theories, read the full source archive, and inspect the same request's retrieval and n8n execution. The question composer remains the primary action.

Twelve original documents distinguish access readers, account ownership, physical operators, clock offsets, production paths, archive preservation, and cue versus public audio. Eight independently labeled questions identify thirteen decisive passages, including contradictions and unresolved motive. The labels were written from the documents before testing retrieval.

## Retrieval experiments

The first implementation indexes exact overlapping source spans with a pinned local MiniLM embedding model. PostgreSQL performs English full-text search and exact cosine search over a bounded corpus; reciprocal rank fusion combines their ranks. This deployment does not use pgvector or an approximate nearest-neighbor service.

Initial passage recall at five was **5/13 for keyword search** and **6/13 for hybrid rank fusion**. All thirteen decisive passages existed in the candidate union, so missing evidence was a ranking problem. A real pinned cross-encoder improved hybrid recall to **7/13**. Scoring isolated sentences made it worse (**5/13**) and was rejected. These results justify investigating scoped query planning for questions with multiple parts; they do not justify changing the labels or claiming the existing retrieval is sufficient.

Local embedding vectors matched the reference pipeline within **3.153 × 10⁻⁸** per coordinate. PostgreSQL integration checks passed for concurrent publication, sealed evidence, model revision isolation, independent cosine values, and rejected partial indexes. Published indexes remain immutable; collection activation follows complete publication.

## Execution evidence

The n8n canvas reads actual saved workflow snapshots and node runs from the pinned n8n 2.39.10 execution schema. API receipts remain a separate evidence source. Inputs are labeled as upstream item projections; headers, credentials, endpoint URLs and transport errors are excluded. Preview budgets protect the public reader from oversized or cyclic data. Observer failure must not interrupt assessment work.

A complete three-question mystery run returned HTTP 202, pinned the mystery collection, saved thirty-one API events, and completed eleven n8n nodes. Reviewing its actual prose exposed a verdict error: the model explained that the recording survived but marked the destruction question supported. Prompt version `evidence-review-v2` now distinguishes yes/no claims, open questions, and unresolved parts of compound questions. The revised prompt still needs the answer evaluation against the completed retrieval change.

## Verification still in progress

The reading-room interface has a clear composer, source archive page, original recorder illustration, RAG panel, n8n canvas, and inspectable API receipts. Strict web checks and its production build passed. Browser inspection was rejected twice by a saved Block permission for the local preview, including after the user reported changing it. No alternative browser surface or indirect rendering workaround was used.

Final retrieval/answer evaluation, end-to-end progress checks, visual interaction review, and the full final diff review remain in progress. Later entries record their actual outcomes.

## 2026-10-03 — Grounded planning and bounded source windows

The first planner inferred dates that the question did not supply. The revised planner receives at most three real initial search passages, rejects unfamiliar numeric identifiers, and makes at most three scoped follow-up searches. Each query receives real cross-encoder scores; interleaving gives separate parts of a question a context opportunity. Source windows expand each selected child by up to 300 characters on either side, without modifying the indexed child. Both retrieval modes use the same window and context limits.

The final keyword baseline found **7/13** decisive passages. The final grounded hybrid and answer comparisons are **NOT RUN**: automatic approval review requires explicit authorization to send demo excerpts to Groq. A permission question is pending; no alternative execution method has bypassed that rejection.

**PASS:** all 94 backend checks with the real test database and both pinned native models, no skipped checks. The subsequent database regression also proves that a mystery run's collection, retrieval mode, source revision, and question cannot change. Cached readiness completed in 178 ms; deployment must warm model files before serving requests.

The user subsequently authorized sending the original demo excerpts and questions to Groq. The final grounded retrieval comparison resumed; its outcome will be recorded after completion.
