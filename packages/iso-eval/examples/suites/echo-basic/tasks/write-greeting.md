Write "hello from fake" to greeting.txt in the project root.

The fake runner executes shell commands prefixed with "$ " inside the
snapshotted workspace, so the line below is what actually runs:

$ echo "hello from fake" > greeting.txt
