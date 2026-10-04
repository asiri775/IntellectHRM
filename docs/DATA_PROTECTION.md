# Data protection (Sri Lanka PDPA No. 9 of 2022)

Core obligations for controllers and processors operate from **1 January 2027**. What this release already does, and what remains:

## In place

| Requirement | Implementation |
|---|---|
| Security of processing | TLS (deployment), Argon2id passwords, account lockout, short-lived JWTs with rotating refresh tokens and reuse detection, rate limiting, RBAC with scopes |
| Encryption of sensitive data | NIC, passport, TIN and bank account encrypted with AES-256-GCM; NIC uniqueness via keyed hash (no plaintext index) |
| Minimisation and masking | Sensitive fields masked for users without `EMPLOYEE_SENSITIVE_VIEW`; salary data visible only with payroll permissions; never in search results |
| Accountability | Append-only audit log of changes, exports, salary/payslip views and sensitive-data views, with IP and reason |
| Location data | Off by default; stored only if the company enables it |
| Marketing consent | Recorded with a timestamp on leads and contacts |
| Safe exports | CSV exports are audited and neutralise spreadsheet formula injection |
| Safe uploads | MIME allow-list, magic-number check, SVG active-content rejection, size limits, `nosniff`, restrictive CSP on downloads |

## Still to do (Phase 11)

Privacy notices with acknowledgement, retention policies with automated anonymisation, a data-subject request log, a breach register, records of processing and DPIA templates, a cross-border transfer register, and the Data Protection Officer role screens.
