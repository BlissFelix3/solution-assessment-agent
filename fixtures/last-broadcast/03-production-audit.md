# Production console — immutable action audit

The following records are server timestamps in UTC. The console can submit preservation jobs from the producer desk across the studio network; the control-room door need not be opened.

At 23:15:48 UTC, request R-409 invoked ARCHIVE_MASTER from console session S-88. The approving account was p-04. The request named master_id glasshouse-final and archive destination vault/session-14. The audit identifies an authenticated account and a session, not a human face or fingerprint.

At 23:16:02 UTC, job R-409 completed with operation FILE_MOVED. The source was production/glasshouse-final.wav and the destination was vault/session-14/glasshouse-final.wav. The source path was removed after the archive object was verified. The archive object retained the master_id glasshouse-final.

At 23:17:00 UTC, playout item Q-221 attempted to open production/glasshouse-final.wav. It returned SOURCE_NOT_FOUND. Q-221 did not follow the archive destination automatically. At 23:17:01, the programme channel entered its silent hold state.

No DELETE_MASTER operation appears in this audit between 23:05 and 23:20 UTC. This does not, by itself, prove the archived file was playable; the archive inventory and integrity check provide that separate evidence.
