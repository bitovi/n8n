# Bitovi N8N Fork: Publishing & Drift Management Plan

> **Date:** 2026-03-18
> **Branch:** `antigravity-startup` (2 commits ahead of `master`)
> **Upstream:** [n8n-io/n8n](https://github.com/n8n-io/n8n) · Current fork base: v1.113.0
> **License:** Sustainable Use License (non-commercial distribution is permitted; see [Licensing Considerations](#6-licensing-considerations))

---

## Table of Contents

1. [Overview & Goals](#1-overview--goals)
2. [NPM Publishing Strategy](#2-npm-publishing-strategy)
3. [Docker Image & Registry Strategy](#3-docker-image--registry-strategy)
4. [Automated Content Exclusion (What NOT to Publish)](#4-automated-content-exclusion-what-not-to-publish)
5. [CI/CD Pipeline — GitHub Actions](#5-cicd-pipeline--github-actions)
6. [Upstream Sync & Drift Management](#6-upstream-sync--drift-management)
7. [Licensing Considerations](#7-licensing-considerations)
8. [Required Secrets & Credentials](#8-required-secrets--credentials)
9. [Versioning Scheme](#9-versioning-scheme)
10. [Rollback & Incident Response](#10-rollback--incident-response)
11. [Implementation Checklist](#11-implementation-checklist)

---

## 1. Overview & Goals

Bitovi maintains a fork of n8n (`bitovi/n8n`) with custom features such as the **Workflow Onboarding Wizard** (workflow import + wizard mode for large workflows). The goals are:

| Goal | Detail |
|------|--------|
| **Publish to NPM** | Publish the main `n8n` CLI package (and any modified sub-packages) under Bitovi's NPM organization scope |
| **Publish to Docker Hub** | Push multi-arch Docker images to `bitovi/n8n` on Docker Hub |
| **Stay current with upstream** | Regularly sync `n8n-io/n8n` into our fork while preserving Bitovi-specific changes |
| **Minimize merge pain** | Keep custom changes isolated, well-documented, and rebased cleanly |

---

## 2. NPM Publishing Strategy

### 2.1 Package Naming

The upstream n8n monorepo publishes packages under their own names (e.g. `n8n`, `n8n-core`, `n8n-workflow`, `n8n-nodes-base`). To avoid collisions with the official packages, Bitovi's fork **must** publish under a scoped name.

| Upstream Package | Bitovi Scoped Package |
|------------------|-----------------------|
| `n8n` | `@bitovi/n8n` |
| `n8n-core` | `@bitovi/n8n-core` |
| `n8n-workflow` | `@bitovi/n8n-workflow` |
| `n8n-nodes-base` | `@bitovi/n8n-nodes-base` |

> [!IMPORTANT]
> Only packages that Bitovi has actually modified need to be published. Currently, the changes are in the **editor-ui** and **cli** packages. Start by publishing `@bitovi/n8n` (the CLI package). Expand scope only when custom changes touch other packages.

### 2.2 Concrete Steps

1. **Create the `@bitovi` NPM organization** (if it doesn't already exist) at [npmjs.com/org/bitovi](https://www.npmjs.com/org/bitovi).
2. **Rename the `name` field** in `packages/cli/package.json` from `"n8n"` to `"@bitovi/n8n"` on the Bitovi release branch.
3. **Generate an NPM automation token** scoped to the `@bitovi` org and store it as a GitHub Actions secret (`BITOVI_NPM_TOKEN`).
4. **Add a custom publish workflow** (see [Section 4](#4-cicd-pipeline--github-actions)).
5. **Version the package** using Bitovi's own versioning scheme (see [Section 8](#8-versioning-scheme)).

### 2.3 What NOT to Publish

- **Enterprise Edition (`*.ee.*`) files** — these are under a separate commercial license and must not be redistributed.
- **Internal testing packages** (`@n8n/benchmark`, `n8n-playwright`, etc.).

---

## 3. Docker Image & Registry Strategy

Since Bitovi **will customize the Docker image**, we need our own Dockerfile and base image rather than relying solely on upstream's.

### 3.1 Image Naming

| Registry | Image Name | Tags |
|----------|-----------|------|
| **Docker Hub** | `bitovi/n8n` | `latest`, `<version>`, `nightly` |
| **Docker Hub** | `bitovi/n8n-runners` | `latest`, `<version>` |
| **GHCR** (backup) | `ghcr.io/bitovi/n8n` | Same as above |

### 3.2 Custom Base Image: `bitovi/n8n-base`

Upstream uses `n8nio/base:${NODE_VERSION}` — a simple Alpine + Node image with fonts, git, graphicsmagick, and tini. **We will build our own base** so we can add Bitovi-specific system dependencies.

Create `docker/images/bitovi-base/Dockerfile`:

```dockerfile
ARG NODE_VERSION=22

# Stage 1: Build dependencies
FROM node:${NODE_VERSION}-alpine AS builder

# Upstream base dependencies (mirrors n8nio/base)
RUN \
  apk --no-cache add --virtual .build-deps-fonts msttcorefonts-installer fontconfig && \
  update-ms-fonts && fc-cache -f && \
  apk del .build-deps-fonts && \
  find /usr/share/fonts/truetype/msttcorefonts/ -type l -exec unlink {} \;

RUN apk add --no-cache \
    git openssh openssl graphicsmagick tini tzdata \
    ca-certificates libc6-compat jq \
    # --- Bitovi additions ---
    aws-cli \
    curl \
    python3

RUN npm install -g full-icu@1.5.0
RUN rm -rf /tmp/* /root/.npm /root/.cache/node

# Stage 2: Final base
FROM node:${NODE_VERSION}-alpine
COPY --from=builder / /
WORKDIR /home/node
ENV NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu
EXPOSE 5678/tcp
```

> [!IMPORTANT]
> **Why a custom base?** Bitovi deployments often need `aws-cli` for interacting with AWS services from within n8n workflows. The upstream base image does not include this. Building our own base also insulates us from upstream base image changes.

**Build & push the base image** via a separate workflow (see Section 5).

### 3.3 Customized Application Dockerfile

Create `docker/images/bitovi-n8n/Dockerfile` — a **Bitovi-specific copy** of the upstream Dockerfile with these modifications:

```dockerfile
ARG NODE_VERSION=22
ARG N8N_VERSION=snapshot
ARG LAUNCHER_VERSION=1.3.1
ARG TARGETPLATFORM

# --- Use Bitovi base instead of n8nio/base ---
FROM bitovi/n8n-base:${NODE_VERSION} AS system-deps

# --- Artifact processor (unchanged) ---
FROM alpine:3.22.0 AS app-artifact-processor
COPY ./compiled /app/

# --- Task Runner Launcher (unchanged) ---
FROM alpine:3.22.0 AS launcher-downloader
ARG TARGETPLATFORM
ARG LAUNCHER_VERSION
RUN set -e; \
    case "$TARGETPLATFORM" in \
        "linux/amd64") ARCH_NAME="amd64" ;; \
        "linux/arm64") ARCH_NAME="arm64" ;; \
        *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
    esac; \
    mkdir /launcher-temp && cd /launcher-temp; \
    wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz"; \
    wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256"; \
    echo "$(cat task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256) task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz" > checksum.sha256; \
    sha256sum -c checksum.sha256; \
    mkdir -p /launcher-bin; \
    tar xzf task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz -C /launcher-bin; \
    cd / && rm -rf /launcher-temp

# --- Final Runtime ---
FROM system-deps AS runtime
ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}
ENV NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu
ENV SHELL=/bin/sh

WORKDIR /home/node

COPY --from=app-artifact-processor /app /usr/local/lib/node_modules/n8n
COPY --from=launcher-downloader /launcher-bin/* /usr/local/bin/
COPY docker/images/bitovi-n8n/docker-entrypoint.sh /
COPY docker/images/n8n/n8n-task-runners.json /etc/n8n-task-runners.json

RUN cd /usr/local/lib/node_modules/n8n && \
    npm rebuild sqlite3 && \
    ln -s /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n && \
    mkdir -p /home/node/.n8n && \
    chown -R node:node /home/node

RUN cd /usr/local/lib/node_modules/n8n/node_modules/pdfjs-dist && npm install @napi-rs/canvas

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

# --- Bitovi-specific labels ---
LABEL org.opencontainers.image.title="n8n (Bitovi Fork)" \
      org.opencontainers.image.description="Bitovi's fork of n8n Workflow Automation Tool" \
      org.opencontainers.image.source="https://github.com/bitovi/n8n" \
      org.opencontainers.image.url="https://github.com/bitovi/n8n" \
      org.opencontainers.image.vendor="Bitovi" \
      org.opencontainers.image.version=${N8N_VERSION}
```

#### Key Differences from Upstream Dockerfile

| Change | Reason |
|--------|--------|
| `FROM bitovi/n8n-base` instead of `n8nio/base` | Custom base with AWS CLI and other tools |
| Labels point to `bitovi/n8n` | Correct source attribution |
| `org.opencontainers.image.vendor="Bitovi"` | Identify the fork publisher |
| Separate entrypoint at `docker/images/bitovi-n8n/` | Allows custom entrypoint logic without modifying upstream files |
| File lives in `docker/images/bitovi-n8n/` | Avoids merge conflicts with upstream's `docker/images/n8n/Dockerfile` |

### 3.4 Custom Entrypoint

Create `docker/images/bitovi-n8n/docker-entrypoint.sh` — extends upstream with Bitovi-specific env defaults:

```bash
#!/bin/sh
# Custom certificates support (from upstream)
if [ -d /opt/custom-certificates ]; then
  echo "Trusting custom certificates from /opt/custom-certificates."
  export NODE_OPTIONS="--use-openssl-ca $NODE_OPTIONS"
  export SSL_CERT_DIR=/opt/custom-certificates
  c_rehash /opt/custom-certificates
fi

# --- Bitovi: enable onboarding wizard by default ---
export N8N_BITOVI_ONBOARDING=${N8N_BITOVI_ONBOARDING:-true}

if [ "$#" -gt 0 ]; then
  exec n8n "$@"
else
  exec n8n
fi
```

### 3.5 Build Process Summary

```
pnpm build:n8n                    →  ./compiled/
scripts/bitovi-strip-ee.sh        →  removes .ee. files from ./compiled/  (see Section 4)
Docker build bitovi-n8n/Dockerfile →  bitovi/n8n:<tag>
```

### 3.6 Multi-Arch Build

Use `docker buildx` with the same `linux/amd64` + `linux/arm64` matrix as upstream. The CI workflow handles this (see Section 5).

---

## 4. Automated Content Exclusion (What NOT to Publish)

This section defines **exactly what must be excluded** from both NPM and Docker artifacts, and how the CI/CD pipeline enforces it automatically.

### 4.1 Content That Must Be Excluded

| Category | Pattern / Location | Reason |
|----------|-------------------|--------|
| **Enterprise Edition source** | `*.ee.*` files (143 source files across `cli`, `core`, `editor-ui`, `@n8n/db`, `@n8n/permissions`) | Licensed under `LICENSE_EE.md` — requires a paid n8n Enterprise License |
| **Enterprise Edition directories** | `src/environments.ee/`, `src/evaluation.ee/`, `src/ldap.ee/`, `src/sso.ee/`, `src/modules/external-secrets.ee/` | Same as above |
| **Compiled EE artifacts** | `*.ee.js`, `*.ee.d.ts`, `*.ee.js.map` in `dist/` directories | Build outputs of EE source |
| **Internal test packages** | `@n8n/benchmark`, `n8n-playwright`, `packages/testing/` | Not for distribution |
| **Cypress / E2E tests** | `cypress/` directory | Test infrastructure only |
| **Development config** | `.devcontainer/`, `.vscode/`, `lefthook.yml`, `biome.jsonc` | Dev tooling |
| **Upstream CI workflows** | `.github/workflows/` (upstream files) | Not relevant to Bitovi releases |

### 4.2 Automated EE Stripping Script

Create `scripts/bitovi-strip-ee.sh` — runs after `pnpm build:n8n` and before Docker build:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Strip Enterprise Edition files from the compiled output
# This runs AFTER build-n8n.mjs creates the ./compiled/ directory

COMPILED_DIR="${1:-./compiled}"

echo "🔒 Stripping Enterprise Edition files from $COMPILED_DIR..."

# Count before
EE_COUNT=$(find "$COMPILED_DIR" -name '*.ee.*' | wc -l | tr -d ' ')
EE_DIR_COUNT=$(find "$COMPILED_DIR" -type d -name '*.ee' -o -type d -name '*.ee.*' | wc -l | tr -d ' ')

# Remove .ee. files (source + compiled)
find "$COMPILED_DIR" -name '*.ee.*' -type f -delete

# Remove .ee directories
find "$COMPILED_DIR" -type d -name '*.ee' -exec rm -rf {} + 2>/dev/null || true
find "$COMPILED_DIR" -type d -name '*.ee.*' -exec rm -rf {} + 2>/dev/null || true

echo "✅ Removed $EE_COUNT EE files and $EE_DIR_COUNT EE directories"

# Verification: fail if any .ee. files remain
REMAINING=$(find "$COMPILED_DIR" -name '*.ee.*' | wc -l | tr -d ' ')
if [ "$REMAINING" -gt 0 ]; then
  echo "❌ ERROR: $REMAINING .ee. files still present after stripping!"
  find "$COMPILED_DIR" -name '*.ee.*'
  exit 1
fi

echo "✅ Verified: zero .ee. files in $COMPILED_DIR"
```

### 4.3 NPM `.npmignore` Additions

Add to the root `.npmignore` (and `packages/cli/.npmignore` if it exists):

```
# Enterprise Edition - not licensed for redistribution
**/*.ee.*
**/*.ee/**
**/environments.ee/**
**/evaluation.ee/**
**/ldap.ee/**
**/sso.ee/**
**/external-secrets.ee/**

# Test infrastructure
cypress/
packages/testing/
**/__tests__/**
**/*.test.*
**/*.spec.*

# Dev tooling
.devcontainer/
.vscode/
lefthook.yml
biome.jsonc
.prettierrc.js
```

### 4.4 Docker-Layer Exclusion

The Docker build copies from `./compiled/` which is already stripped by the script above. As a defense-in-depth measure, also add to `.dockerignore`:

```
# EE files should never enter the Docker context
**/*.ee.*
**/environments.ee
**/evaluation.ee
**/ldap.ee
**/sso.ee
**/external-secrets.ee

# Test / dev files
cypress
packages/testing
.devcontainer
.vscode
.github
```

### 4.5 CI Verification Gate

Add a dedicated CI job that **fails the pipeline** if excluded content leaks through:

```yaml
  verify-exclusions:
    name: Verify No EE Content in Artifacts
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Check compiled output for EE files
        run: |
          EE_FILES=$(find ./compiled -name '*.ee.*' 2>/dev/null | head -20)
          if [ -n "$EE_FILES" ]; then
            echo "❌ FATAL: Enterprise Edition files found in compiled output!"
            echo "$EE_FILES"
            exit 1
          fi
          echo "✅ No EE files in compiled output"

      - name: Check compiled output for test packages
        run: |
          for pkg in "@n8n/benchmark" "n8n-playwright"; do
            if find ./compiled -path "*${pkg}*" | grep -q .; then
              echo "❌ FATAL: Test package $pkg found in compiled output!"
              exit 1
            fi
          done
          echo "✅ No test packages in compiled output"

      - name: Scan Docker image for EE files
        run: |
          # Create a temporary container from the built image
          CID=$(docker create bitovi/n8n:${{ env.VERSION }})
          EE_IN_IMAGE=$(docker export $CID | tar -t | grep '\.ee\.' | head -20)
          docker rm $CID
          if [ -n "$EE_IN_IMAGE" ]; then
            echo "❌ FATAL: EE files found inside Docker image!"
            echo "$EE_IN_IMAGE"
            exit 1
          fi
          echo "✅ No EE files in Docker image"
```

### 4.6 Exclusion Pipeline Flow

```
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────────┐
│  pnpm build │───►│ build:n8n    │───►│ bitovi-strip-ee │───►│ verify-      │
│  (monorepo) │    │ (→ compiled/)│    │ (remove .ee.)   │    │ exclusions   │
└─────────────┘    └──────────────┘    └────────┬────────┘    └──────┬───────┘
                                                │                    │
                                    ┌───────────┴──────┐    ┌───────┴───────┐
                                    │ Docker build     │    │ NPM publish   │
                                    │ (.dockerignore   │    │ (.npmignore   │
                                    │  as 2nd layer)   │    │  as 2nd layer)│
                                    └──────────────────┘    └───────────────┘
```

Each artifact has **two layers of protection**:
1. **Active removal** — the `bitovi-strip-ee.sh` script deletes EE files from `./compiled/`
2. **Passive filter** — `.npmignore` / `.dockerignore` prevent anything missed from leaking into the published artifact
3. **Verification gate** — the `verify-exclusions` CI job fails the pipeline if anything slips through

---

## 5. CI/CD Pipeline — GitHub Actions

### 5.1 New Workflow: `bitovi-release.yml`

Create a **new** workflow rather than modifying the existing upstream workflows (this minimizes merge conflicts during syncs).

```yaml
# .github/workflows/bitovi-release.yml
name: 'Bitovi: Build & Publish'

on:
  push:
    tags:
      - 'bitovi-v*'    # e.g. bitovi-v1.113.0-bitovi.1
  workflow_dispatch:
    inputs:
      publish_npm:
        description: 'Publish to NPM'
        type: boolean
        default: true
      publish_docker:
        description: 'Publish to Docker Hub'
        type: boolean
        default: true

env:
  NODE_OPTIONS: '--max-old-space-size=6144'

jobs:
  build:
    name: Build & Strip
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install & Build
        run: |
          pnpm install --frozen-lockfile
          pnpm build:n8n

      - name: Strip EE Content
        run: bash scripts/bitovi-strip-ee.sh ./compiled

      - name: Upload compiled artifact
        uses: actions/upload-artifact@v4
        with:
          name: compiled-app
          path: ./compiled/
          retention-days: 1

  verify-exclusions:
    name: Verify No Excluded Content
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: compiled-app
          path: ./compiled/

      - name: Check for EE files
        run: |
          EE_FILES=$(find ./compiled -name '*.ee.*' 2>/dev/null | head -20)
          if [ -n "$EE_FILES" ]; then
            echo "❌ FATAL: Enterprise Edition files found!"
            echo "$EE_FILES"
            exit 1
          fi
          echo "✅ No EE files in compiled output"

      - name: Check for test packages
        run: |
          for pkg in benchmark playwright; do
            if find ./compiled -ipath "*${pkg}*" -not -path '*/node_modules/.package-lock.json' | grep -q .; then
              echo "❌ FATAL: Test package '$pkg' found!"
              exit 1
            fi
          done
          echo "✅ No test packages in compiled output"

  publish-npm:
    name: Publish to NPM
    needs: [build, verify-exclusions]
    if: ${{ github.event.inputs.publish_npm != 'false' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'

      - name: Install, Build & Publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.BITOVI_NPM_TOKEN }}
        run: |
          pnpm install --frozen-lockfile
          pnpm build
          node .github/scripts/trim-fe-packageJson.js
          bash scripts/bitovi-strip-ee.sh ./compiled
          pnpm --filter @bitovi/n8n publish --access public --no-git-checks

  publish-docker:
    name: Publish to Docker Hub
    needs: [build, verify-exclusions]
    runs-on: ubuntu-latest
    if: ${{ github.event.inputs.publish_docker != 'false' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: compiled-app
          path: ./compiled/

      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.BITOVI_DOCKER_USERNAME }}
          password: ${{ secrets.BITOVI_DOCKER_PASSWORD }}

      - name: Build & Push Docker Image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./docker/images/bitovi-n8n/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            bitovi/n8n:latest
            bitovi/n8n:${{ github.ref_name }}
```

> [!NOTE]
> This workflow is intentionally a **separate file** from the upstream workflows. It will not conflict during merges.

### 5.2 Base Image Workflow: `bitovi-base-image.yml`

A separate workflow to build and push the custom base image (runs infrequently — only when base dependencies change):

```yaml
# .github/workflows/bitovi-base-image.yml
name: 'Bitovi: Build Base Image'
on:
  push:
    paths:
      - 'docker/images/bitovi-base/**'
  workflow_dispatch:

jobs:
  build-base:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          username: ${{ secrets.BITOVI_DOCKER_USERNAME }}
          password: ${{ secrets.BITOVI_DOCKER_PASSWORD }}
      - uses: docker/build-push-action@v6
        with:
          context: ./docker/images/bitovi-base
          file: ./docker/images/bitovi-base/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: bitovi/n8n-base:22
```

### 5.3 Trigger Strategy

| Trigger | Behavior |
|---------|----------|
| **Git tag `bitovi-v*`** | Full release: build → strip EE → verify → NPM publish → Docker push |
| **`workflow_dispatch`** | Manual release with toggles for NPM/Docker |
| **Push to `docker/images/bitovi-base/`** | Rebuild base image only |
| **Nightly (optional)** | Build-only smoke test, no publish |

---

## 6. Upstream Sync & Drift Management

This is the most critical long-term concern. Here is the strategy:

### 5.1 Git Remote Setup

```bash
# Add upstream remote (one-time)
git remote add upstream https://github.com/n8n-io/n8n.git
git fetch upstream
```

### 5.2 Branch Strategy

```
upstream/master ──────────────────────────────────────►
                     ↓ periodic merge
master (bitovi) ──────────────────────────────────────►
                     ↓ merge
antigravity-startup ──────────────────────────────────►
                     ↓ tag
                  bitovi-v1.113.0-bitovi.1
```

| Branch | Purpose |
|--------|---------|
| `master` | Tracks upstream. Periodically synced via `git merge upstream/master`. |
| `antigravity-startup` | Bitovi feature branch. Contains custom features (workflow onboarding). |
| `release/bitovi-*` | (Optional) Created for stabilization before tagging a release. |

### 5.3 Sync Cadence & Process

#### Recommended: Bi-weekly upstream sync

```bash
# 1. Fetch upstream
git fetch upstream

# 2. Merge upstream/master into our master
git checkout master
git merge upstream/master
git push origin master

# 3. Rebase or merge feature branch onto updated master
git checkout antigravity-startup
git merge master    # or: git rebase master (depends on team preference)

# 4. Resolve any conflicts
#    - Conflicts will almost always be in:
#      packages/editor-ui/  (where the onboarding wizard lives)
#      packages/cli/         (if CLI changes were made)

# 5. Run full test suite
pnpm test
pnpm build:docker   # verify Docker build still works

# 6. Push
git push origin antigravity-startup
```

### 5.4 Minimizing Drift — Isolation Principles

Follow these rules to keep merge conflicts manageable:

| Principle | How |
|-----------|-----|
| **New files over modified files** | Put custom features in **new** files/components whenever possible. Don't modify existing upstream files unless absolutely necessary. |
| **Feature flags** | Gate Bitovi features behind environment variables (e.g., `N8N_BITOVI_ONBOARDING=true`). This way the feature can be toggled off, and the code stays inert during upstream merges. |
| **Separate workflows** | Never modify upstream `.github/workflows/` files. Create new `bitovi-*.yml` files instead (see [Section 4](#4-cicd-pipeline--github-actions)). |
| **Scoped package names** | Only change the `name` field on a Bitovi release branch, not on `master`. This prevents recurring merge conflicts. |
| **Changeset tracking** | Maintain a `Plans/BITOVI_CHANGES.md` file that documents every file Bitovi has modified from upstream, with the reason why. This is the "drift manifest." |

### 5.5 Handling Merge Conflicts

When upstream updates a file that Bitovi has also changed:

1. **Check the drift manifest** (`Plans/BITOVI_CHANGES.md`) to understand why the file was modified.
2. **Prefer upstream's version** for any change that doesn't conflict with a Bitovi feature.
3. **Re-apply Bitovi changes on top** of the upstream version.
4. **Update the drift manifest** with the new upstream version that was merged.

### 5.6 Automated Drift Detection (Future Enhancement)

Create a scheduled GitHub Action that:

1. Fetches `upstream/master` weekly.
2. Runs `git diff --name-only master..upstream/master`.
3. Cross-references changed files with `Plans/BITOVI_CHANGES.md`.
4. Opens a GitHub Issue if any Bitovi-modified file has upstream changes (potential conflict).

```yaml
# .github/workflows/bitovi-drift-check.yml
name: 'Bitovi: Drift Detection'
on:
  schedule:
    - cron: '0 9 * * 1'  # Every Monday at 9am UTC
  workflow_dispatch:

jobs:
  check-drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Add upstream remote
        run: |
          git remote add upstream https://github.com/n8n-io/n8n.git
          git fetch upstream
      - name: Check for conflicting changes
        run: |
          UPSTREAM_CHANGES=$(git diff --name-only origin/master..upstream/master)
          BITOVI_FILES=$(grep '^\-' Plans/BITOVI_CHANGES.md | sed 's/^- //' | sed 's/ .*//')

          CONFLICTS=""
          for file in $BITOVI_FILES; do
            if echo "$UPSTREAM_CHANGES" | grep -q "$file"; then
              CONFLICTS="${CONFLICTS}\n- ${file}"
            fi
          done

          if [ -n "$CONFLICTS" ]; then
            echo "⚠️  Potential merge conflicts detected:"
            echo -e "$CONFLICTS"
            echo "conflicts_found=true" >> $GITHUB_OUTPUT
          else
            echo "✅ No conflicting changes detected."
          fi
```

---

## 7. Licensing Considerations

> [!CAUTION]
> n8n is **NOT** MIT/Apache-licensed. It uses the **Sustainable Use License** which permits:
> - ✅ **Internal business use** (Bitovi using it internally — fully allowed)
> - ✅ **Non-commercial distribution** (distributing free of charge — allowed)
> - ❌ **Commercial redistribution** (selling the software — NOT allowed)
> - ✅ **Derivative works** (modifications — allowed, with notice requirements)
>
> **The plan assumes Bitovi is distributing the fork free of charge for internal/client use and not reselling n8n as a product.** If the intent is to sell or commercially distribute this fork, a commercial license from n8n GmbH is required.

**Required actions:**
1. Include a **prominent modification notice** in the README (required by the license).
2. Retain all original license files (`LICENSE.md`, `LICENSE_EE.md`).
3. Do **not** distribute any `*.ee.*` files without an enterprise license agreement.

---

## 8. Required Secrets & Credentials

Add these to `bitovi/n8n` → Settings → Secrets and Variables → Actions:

| Secret Name | Purpose | Where to Get |
|-------------|---------|-------------|
| `BITOVI_NPM_TOKEN` | NPM automation token for `@bitovi` org | [npmjs.com → Access Tokens](https://www.npmjs.com/settings/~/tokens) |
| `BITOVI_DOCKER_USERNAME` | Docker Hub username | Docker Hub account |
| `BITOVI_DOCKER_PASSWORD` | Docker Hub access token | [Docker Hub → Security](https://hub.docker.com/settings/security) |

---

## 9. Versioning Scheme

Use a versioning scheme that tracks the upstream version while distinguishing Bitovi releases:

```
<upstream-version>-bitovi.<bitovi-patch>
```

**Examples:**
| Version | Meaning |
|---------|---------|
| `1.113.0-bitovi.1` | Based on upstream 1.113.0, first Bitovi release |
| `1.113.0-bitovi.2` | Same upstream base, second Bitovi release (bug fix or feature addition) |
| `1.114.0-bitovi.1` | Synced to upstream 1.114.0, first Bitovi release on that base |

**Docker tags follow the same convention:**
- `bitovi/n8n:1.113.0-bitovi.1`
- `bitovi/n8n:latest`

**To set the version:**
```bash
# In the root package.json, before tagging:
npm version 1.113.0-bitovi.1 --no-git-tag-version --workspaces=false

# Then tag and push:
git tag bitovi-v1.113.0-bitovi.1
git push origin bitovi-v1.113.0-bitovi.1
```

---

## 10. Rollback & Incident Response

| Scenario | Action |
|----------|--------|
| **Bad NPM publish** | `npm unpublish @bitovi/n8n@<version>` (within 72 hours) or `npm deprecate` |
| **Bad Docker image** | `docker tag bitovi/n8n:<previous-good> bitovi/n8n:latest && docker push bitovi/n8n:latest` |
| **Upstream introduces breaking change** | Pin `master` to the last known-good upstream tag, skip the breaking release, wait for fix |
| **Merge conflict too large to resolve** | Cherry-pick Bitovi commits onto a fresh branch from the new upstream tag instead of merging |

---

## 11. Implementation Checklist

- [ ] **NPM Setup**
  - [ ] Confirm `@bitovi` NPM org exists and has publish permissions
  - [ ] Generate NPM automation token
  - [ ] Add `BITOVI_NPM_TOKEN` to GitHub Actions secrets
- [ ] **Docker Hub Setup**
  - [ ] Create `bitovi/n8n` and `bitovi/n8n-base` repositories on Docker Hub
  - [ ] Generate Docker Hub access token
  - [ ] Add `BITOVI_DOCKER_USERNAME` and `BITOVI_DOCKER_PASSWORD` to GitHub Actions secrets
- [ ] **Docker Image Customization**
  - [ ] Create `docker/images/bitovi-base/Dockerfile` (custom base with AWS CLI)
  - [ ] Create `docker/images/bitovi-n8n/Dockerfile` (Bitovi-specific app image)
  - [ ] Create `docker/images/bitovi-n8n/docker-entrypoint.sh` (custom entrypoint)
  - [ ] Build and push `bitovi/n8n-base:22` to Docker Hub
- [ ] **Content Exclusion**
  - [ ] Create `scripts/bitovi-strip-ee.sh` (EE file removal script)
  - [ ] Update `.npmignore` with EE and test exclusion patterns
  - [ ] Update `.dockerignore` with EE and test exclusion patterns
  - [ ] Add `verify-exclusions` CI gate to release workflow
- [ ] **Repository Setup**
  - [ ] Add `upstream` remote: `git remote add upstream https://github.com/n8n-io/n8n.git`
  - [ ] Create `Plans/BITOVI_CHANGES.md` drift manifest documenting all modified files
- [ ] **CI/CD**
  - [ ] Create `.github/workflows/bitovi-release.yml`
  - [ ] Create `.github/workflows/bitovi-base-image.yml`
  - [ ] Create `.github/workflows/bitovi-drift-check.yml`
  - [ ] Test workflow with `workflow_dispatch` (dry-run, no publish)
- [ ] **Package Changes** (on a release branch, not `master`)
  - [ ] Rename `packages/cli/package.json` → `"name": "@bitovi/n8n"`
  - [ ] Update Dockerfile labels for Bitovi
  - [ ] Add modification notice to README
- [ ] **First Release**
  - [ ] Set version: `1.113.0-bitovi.1`
  - [ ] Tag: `bitovi-v1.113.0-bitovi.1`
  - [ ] Verify NPM package: `npm info @bitovi/n8n`
  - [ ] Verify Docker image: `docker pull bitovi/n8n:1.113.0-bitovi.1`
  - [ ] Verify no `.ee.` files in NPM tarball: `npm pack @bitovi/n8n && tar -tzf *.tgz | grep '.ee.'`
  - [ ] Verify no `.ee.` files in Docker image
- [ ] **Documentation**
  - [ ] Document the sync process in this Plans directory
  - [ ] Document how to create a new Bitovi release
