# baseline workspace

This directory is copied into a fresh tmpdir before each task runs, so
anything a runner writes here only lives for one trial. The
`echo-basic` suite uses it as an empty starting state — the fake runner
writes `greeting.txt` into the snapshot, and the checks verify it.
