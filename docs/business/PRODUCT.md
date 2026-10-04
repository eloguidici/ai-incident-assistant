# Business and scope

## Problem and actors

A technical analyst needs to organize incomplete information about an incident. The authenticated user owns their content; the AI proposes an analysis and a human verifies it. The evaluator must be able to reproduce the flow.

## MVP scope

Login, paste text, generate a structured analysis, browse history and detail, and ask follow-up questions about the same content.

No PDF upload or OCR; the assessment accepts text. No voice, scraping, tools with side effects, real monitoring, RAG or multiple agents.

## Rules

- **B01:** every analysis and message belongs to a user; the server derives identity from the session.
- **B02:** only the owner reads, changes or asks about an analysis; lists do not leak other users' data either.
- **B03:** input is validated, and size and context are limited before the model is called.
- **B04:** facts and evidence are separated from hypotheses; insufficient text produces explicit uncertainty.
- **B05:** output must validate against the schema; invalid output is never shown as success.
- **B06:** failures are visible and recoverable; an explicit retry does not delete a previous result.
- **B07:** provider, model and prompt version are recorded per execution; operational logs do not contain the full text.
- **B08:** no actions are executed on external systems.

## Flows

- **F01:** login -> session -> access.
- **F02:** text -> validation -> execution -> persisted result or visible failure.
- **F03:** own history -> detail -> still available after a restart.
- **F04:** question -> bounded context of the user's own analysis -> answer -> history.
- **F05:** provider failure -> safe message -> controlled retry.
- **F06:** another user tries to access -> consistent denial without leaking content.

## Result

`summary`, `category`, `suggestedSeverity`, `evidence`, `hypotheses`, `missingInformation` and `uncertainty`. Quotes must exist in the text. The closed schema is in [MVP](../features/MVP.md).

## Sensitive data

Use synthetic fixtures. Sending data to the provider, retention, deletion and logging are defined in the [data policy](../security/DATA_POLICY.md).

## Success

The evaluator starts the application from the instructions, analyzes content, asks questions, keeps history and checks isolation and errors. Automatic correct diagnosis is not promised.
