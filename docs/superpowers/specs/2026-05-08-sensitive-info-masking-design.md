# Sensitive Information Masking Design

## Goal

Prevent customer and personal information from leaving the system or being stored in routine AI artifacts. The first implementation will store and expose only masked text in the AI answer flow.

This applies regardless of the configured LLM provider. Gemini is the current provider, but the masking boundary must sit before the shared answer-generation interface so future providers inherit the same protection.

## Approved Policy

Use masked text only for:

- External LLM requests
- RAG query text passed from the answer flow
- RAG context passed into the LLM
- API request logging
- `data/queue.json`
- generated answer markdown under `data/answers/`

Do not store raw customer questions in the answer queue or generated answer files.

## Sensitive Data Scope

Mask these categories:

- Email addresses
- Phone numbers
- IP addresses
- Non-public URLs
- Author/requester/customer names when introduced by labels such as Korean or English equivalents of author, requester, assignee, or customer name
- Company/project fields such as Korean or English equivalents of company name, project name, customer company, or client
- Attachment and engine filenames such as `.zip`, `.xml`, `.xlsx`, `.pdf`, `.docx`, `.png`
- Credentials and secret-like values near keys such as `apiKey`, `token`, `password`, `clientSecret`

Keep technical terms that are needed for support quality, such as `GridView`, `spanAll`, `rowIndex`, `expression`, and WebSquare version families when they are not embedded in a sensitive filename.

## Architecture

Extend `src/utils/masking.js` into the shared masking boundary. Keep the existing `maskPersonalInfo` export for compatibility, and add a clearer `maskSensitiveInfo` export used by new code.

Apply masking in the answer path:

- `src/api/server.js`: mask POST body before logging.
- `src/generator/pipeline.js`: derive `safeQuestion` at the start of `process()` and `safeFollowUp` in `processFollowUp()`.
- Use safe text for classification, RAG search, LLM generation, answer file saving, and queue insertion.
- Mask `ragResult.context` before passing it to the LLM.

The answer pipeline result can return the safe question. Raw input should not be returned by this flow.

## Data Flow

`raw request question`

-> `sanitize()`

-> `maskSensitiveInfo()`

-> classification, RAG search, LLM request, queue save, answer file save

RAG context flow:

`searcher.py stdout`

-> `maskSensitiveInfo()`

-> LLM context

The parsed `sources` response can still include source titles and attachments in a later phase, but this first change should not expand source exposure. Attachment filename masking in API sources can be handled in the follow-up sample-file work.

## Error Handling

Masking must be best-effort and non-throwing. If input is empty or not a string, return an empty string. If a pattern fails to match, leave the text unchanged rather than blocking answer generation.

## Tests

Add focused tests for the masking utility using representative strings:

- `[vendor-name] user@example.com websquare_5_0_5_feature_20250916_1128.x86_64_B.zip plugin delivery request`
- `company/project field followed by a customer company and internal project name`
- `author field followed by a Korean personal name and 010-1234-5678`
- `apiKey: abc123 password=secret clientSecret xyz`

Expected behavior:

- Sensitive values are replaced.
- Technical terms remain readable where possible.
- No replacement character or mojibake is introduced.

Run syntax checks for changed JavaScript files after implementation.

## Out Of Scope

- Customer-uploaded attachment analysis
- AI-generated sample file creation
- RAG ranking improvements
- Rewriting historical generated answers
- Secure raw-question archive

Those should be separate changes after this masking layer is in place.
