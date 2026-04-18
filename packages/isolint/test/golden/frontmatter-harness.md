---
description: Use creative phrasing for responses
model: mistral-7b
tools: [bash, read]
---

# Mode: respond — Respond to user

## Step 1 — Read input

Read `$input.message`.

## Step 2 — Generate response

Return JSON with these fields:

- `text` (string): the reply
- `tone` (enum: formal | casual): match the input tone
