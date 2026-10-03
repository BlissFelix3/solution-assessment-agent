# Clock inspection — reconciling the timestamps

At 23:30 UTC, the engineer compared the presentation booth's wall display with the authenticated server clock. The wall display was exactly three minutes fast. The server and access-controller clocks agreed within one second.

To compare a displayed booth time with UTC, subtract three minutes. A booth display reading of 23:17 corresponds to approximately 23:14 UTC. This is the display Mara described in her interview.

The inspection log notes that the booth display's offset had been present since an unsuccessful synchronization at 22:40. It was corrected at 23:31. There is no recorded change between Mara's observation and the inspection.

The production-console audit, archive inventory, and access log already use UTC. Do not subtract the display offset from those server records. The clock check can reconcile a witness's apparent chronology; it does not identify a person or a file operation.
