# Security Policy

## Supported version

Security fixes currently target the latest `0.2.x` Early Access release and the default branch.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or exposed credential. Use
[GitHub private vulnerability reporting](https://github.com/dctongsheng/dougoos/security/advisories/new)
and include:

- affected version and platform;
- a minimal reproduction;
- expected and actual impact;
- any suggested remediation;
- whether credentials or user data may have been exposed.

Please avoid accessing data that is not yours, disrupting services, or publishing exploit details
before a fix is available.

## High-priority areas

Reports involving update-signature verification, arbitrary code execution, path traversal,
credential exposure, approval bypass, unsafe Provider process execution, or cross-project data
access receive priority.

DougoOS 0.2.x uses ad-hoc macOS bundle signing and is not Apple-notarized. Gatekeeper's first-launch
warning is a documented Early Access limitation, not by itself a security vulnerability.
