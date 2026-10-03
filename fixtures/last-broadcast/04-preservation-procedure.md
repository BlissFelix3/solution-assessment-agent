# Operating procedure — preservation and playout

ARCHIVE_MASTER is a relocation procedure. It copies a selected master into a vault destination, verifies the copied object against the recorded digest, and removes the original production path only after verification succeeds. A successfully preserved master is retained, not erased.

A preservation request must be approved by a producer account. Engineers may propose a job, but an engineering account cannot approve it. The approving account appears in the production-console audit. Staff-account ownership appears in the directory.

The playout queue stores a literal production file path. Moving a master does not rewrite queued items. Before preserving a master that is scheduled to play, an operator must either update the queue to the verified archive path or defer the preservation job until playback finishes.

A SOURCE_NOT_FOUND result places the programme channel in silent hold. The archive is not searched for a replacement automatically. An operator can resolve the condition by loading a verified retained object and updating the queue. A missing source path is therefore not equivalent to a lost recording.

This procedure does not state why request R-409 was approved. Its rules describe how the operation works, not the operator's motive.
