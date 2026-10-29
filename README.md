# Picktennt

Picktennt is the application repository for tournament creation, registration, match administration, standings, playoffs, and the MCP tournament assistant.

## Project documentation

Start with [project-docs/README.md](project-docs/README.md). It is the compact project map for the product requirements, architecture, modules, authentication, release status, test instructions, implementation plans, specifications, and examples.

Current implementation evidence and security documentation also live in [docs/](docs/).

## Local development

```bash
npm install
npm run dev
```

Useful verification commands:

```bash
npm test
npx tsc --noEmit
npm run build -- --webpack
```

Local environment files, dependencies, build caches, and verification output are intentionally excluded from Git.
