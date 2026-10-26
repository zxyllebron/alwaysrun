# Security and privacy

Alwaysrun is intended for a trusted, single-user machine. It listens on `127.0.0.1`, checks the Host and Origin of requests, and requires a random action token for mutations. It has no internet-facing authentication or multi-user isolation. Do not expose its port through a public proxy.

## What stays local

- Indexes, messages, preferences, configuration, reports and logs are written to ignored `data/`.
- Local verification artifacts belong in ignored `artifacts/`.
- The importer opens source databases read-only. It does not intentionally read Codex authentication files or copy login tokens.
- Common credential shapes are redacted, but redaction is not a guarantee against every sensitive string. Do not import credentials or password exports.

## What can leave the machine

Retrieved evidence is sent to the configured Codex model service when a model task runs. Local storage does not imply offline model inference. Optional Feishu synchronization uses the official API and application permissions supplied by the operator.

The project's MIT license applies to this source code. It does not grant rights to a model, waive a provider's terms or give an agent access to someone else's accounts.

## Execution boundary

Read-only and workspace-write modes come from Codex. The supervisor's instructions add workflow constraints; they do not replace operating-system permissions or platform safeguards. Historical chats and third-party documents are evidence, never new authorization. Review project targets and retain backups appropriate to the work.

This release has no payment executor, remote deployment executor, final-submission integration or CAPTCHA bypass. It must not be represented as a way to defeat a provider's security controls.

## Reporting

Use GitHub's private vulnerability reporting for this repository when available. Do not include credentials, private conversations, source databases or full runtime logs in a public issue. A redacted minimal reproducer is sufficient for ordinary bug reports.

Before sharing a source change, run `npm run audit:public` after staging the intended public files. The audit is an additional check, not proof that arbitrary text is safe to publish.
